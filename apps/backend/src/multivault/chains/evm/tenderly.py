"""Tenderly Simulation API client for Safe transaction simulation."""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import httpx
import structlog

logger = structlog.get_logger(__name__)

TENDERLY_API_BASE = "https://api.tenderly.co/api/v1"

# Safe v1.4.1 storage layout
# https://github.com/safe-global/safe-contracts/blob/main/contracts/libraries/SafeStorage.sol
THRESHOLD_STORAGE_SLOT = "0x" + "0" * 63 + "4"  # slot 4, 32 bytes
NONCE_STORAGE_SLOT = "0x" + "0" * 63 + "5"      # slot 5, 32 bytes
# keccak256("guard_manager.guard.address")
GUARD_STORAGE_SLOT = (
    "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8"
)

ZERO_ADDRESS = "0x" + "0" * 40

# Platform-configured native symbols per chain ID
EVM_NATIVE_SYMBOLS: dict[int, str] = {
    1: "ETH", 5: "ETH", 11155111: "ETH",
    56: "BNB", 97: "tBNB",
    137: "POL", 80001: "POL",
    42161: "ETH", 421614: "ETH",
    8453: "ETH", 84532: "ETH",
    10: "ETH", 11155420: "ETH",
    43114: "AVAX", 43113: "AVAX",
    250: "FTM", 4002: "FTM",
    61: "ETC",
}


@dataclass
class AssetChange:
    """A single asset change from simulation."""

    from_address: str
    to_address: str
    token_symbol: str
    token_address: str
    token_decimals: int
    change_type: str  # "Transfer" | "Approve"
    direction: str    # "Sent" | "Received"
    raw_amount: str
    formatted_amount: str
    dollar_value: str  # USD value from Tenderly, e.g. "100.05"


@dataclass
class BalanceChange:
    """ETH balance change for an address."""

    address: str
    before: str
    after: str
    diff: str


@dataclass
class SimulationResult:
    """Parsed Tenderly simulation result."""

    success: bool
    gas_used: int
    revert_reason: str | None = None
    asset_changes: list[AssetChange] = field(default_factory=list)
    eth_balance_changes: list[BalanceChange] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Serialize to JSON-compatible dict for DB storage."""
        return {
            "asset_changes": [
                {
                    "from_address": ac.from_address,
                    "to_address": ac.to_address,
                    "token_symbol": ac.token_symbol,
                    "token_address": ac.token_address,
                    "token_decimals": ac.token_decimals,
                    "type": ac.change_type,
                    "direction": ac.direction,
                    "raw_amount": ac.raw_amount,
                    "formatted_amount": ac.formatted_amount,
                    "dollar_value": ac.dollar_value,
                }
                for ac in self.asset_changes
            ],
            "eth_balance_changes": [
                {
                    "address": bc.address,
                    "before": bc.before,
                    "after": bc.after,
                    "diff": bc.diff,
                }
                for bc in self.eth_balance_changes
            ],
            "gas_estimate": self.gas_used,
            "revert_reason": self.revert_reason,
        }


class TenderlyError(Exception):
    """Tenderly API error."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _safe_int(value) -> int:
    """Convert a value from Tenderly to int, handling str, hex str, and int."""
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return 0
        return int(value, 16) if value.startswith("0x") else int(value)
    return int(value)


def _to_hex_32(value: int) -> str:
    """Convert integer to 32-byte zero-padded hex string."""
    return "0x" + hex(value)[2:].zfill(64)


def build_state_overrides(
    safe_address: str,
    *,
    override_threshold: bool = False,
    nonce_override: int | None = None,
    guard_override: bool = False,
) -> dict | None:
    """Build Tenderly state_objects for Safe contract storage overrides.

    Following Safe Wallet Web's official approach:
    - Threshold slot 0x04: set to 1 when signatures insufficient
    - Nonce slot 0x05: set to tx nonce when tx nonce > on-chain nonce
    - Guard slot: set to zero address when Safe has a guard
    """
    storage: dict[str, str] = {}

    if override_threshold:
        storage[THRESHOLD_STORAGE_SLOT] = _to_hex_32(1)

    if nonce_override is not None:
        storage[NONCE_STORAGE_SLOT] = _to_hex_32(nonce_override)

    if guard_override:
        storage[GUARD_STORAGE_SLOT] = "0x" + "0" * 64

    if not storage:
        return None

    return {
        safe_address: {
            "storage": storage,
        },
    }


def parse_simulation_response(data: dict, *, chain_id: int | None = None) -> SimulationResult:
    """Parse Tenderly API response into SimulationResult.

    Handles both top-level simulation status and inner Safe execTransaction
    revert (where Tenderly reports success but call_trace has errors).
    """
    simulation = data.get("simulation", {})
    transaction = data.get("transaction", {})
    tx_info = transaction.get("transaction_info", {})

    top_level_success = simulation.get("status", False)
    gas_used = transaction.get("gas_used", 0)

    # Check for inner revert in call_trace
    call_trace = transaction.get("call_trace", [])
    call_trace_errors = []
    if isinstance(call_trace, list):
        call_trace_errors = [c for c in call_trace if c.get("error")]
    elif isinstance(call_trace, dict):
        # Single call trace object — check its own error and nested calls
        if call_trace.get("error"):
            call_trace_errors.append(call_trace)
        calls = call_trace.get("calls", [])
        if isinstance(calls, list):
            call_trace_errors.extend(c for c in calls if c.get("error"))

    has_inner_revert = len(call_trace_errors) > 0

    # Determine actual success
    success = top_level_success and not has_inner_revert

    # Extract revert reason
    revert_reason = None
    if not top_level_success:
        error_info = transaction.get("error_info", {})
        revert_reason = error_info.get("error_message") or transaction.get(
            "error_message",
        )
    elif has_inner_revert:
        revert_reason = call_trace_errors[0].get("error", "Inner transaction reverted")

    # Parse asset changes from transaction_info
    asset_changes: list[AssetChange] = []
    raw_changes = tx_info.get("asset_changes", [])
    if raw_changes:
        for change in raw_changes:
            token_info = change.get("token_info", {})
            # Use platform native symbol when Tenderly reports NativeCurrency
            symbol = token_info.get("symbol", "")
            if token_info.get("standard") == "NativeCurrency" and chain_id is not None:
                symbol = EVM_NATIVE_SYMBOLS.get(chain_id, symbol)
            asset_changes.append(
                AssetChange(
                    from_address=change.get("from", ""),
                    to_address=change.get("to", ""),
                    token_symbol=symbol,
                    token_address=token_info.get("contract_address", ZERO_ADDRESS),
                    token_decimals=token_info.get("decimals", 18),
                    change_type=change.get("type", "Transfer"),
                    direction="Sent" if change.get("from") else "Received",
                    raw_amount=str(change.get("raw_amount", "0")),
                    formatted_amount=str(change.get("amount", "0")),
                    dollar_value=str(change.get("dollar_value", "")),
                ),
            )

    # Parse balance changes from state_diff
    eth_balance_changes: list[BalanceChange] = []
    state_diffs = tx_info.get("balance_diff", [])
    if state_diffs:
        for diff in state_diffs:
            original = _safe_int(diff.get("original", 0))
            dirty = _safe_int(diff.get("dirty", 0))
            eth_balance_changes.append(
                BalanceChange(
                    address=diff.get("address", ""),
                    before=str(original),
                    after=str(dirty),
                    diff=str(dirty - original),
                ),
            )

    return SimulationResult(
        success=success,
        gas_used=gas_used,
        revert_reason=revert_reason,
        asset_changes=asset_changes,
        eth_balance_changes=eth_balance_changes,
    )


class TenderlySimulator:
    """Tenderly Simulation API client."""

    def __init__(
        self,
        access_key: str,
        account_slug: str,
        project_slug: str,
        timeout: float = 30.0,
    ):
        self._access_key = access_key
        self._account = account_slug
        self._project = project_slug
        self._timeout = timeout

    @property
    def _simulate_url(self) -> str:
        return (
            f"{TENDERLY_API_BASE}/account/{self._account}"
            f"/project/{self._project}/simulate"
        )

    async def simulate(
        self,
        *,
        chain_id: int,
        from_address: str,
        to_address: str,
        input_data: str,
        state_objects: dict | None = None,
    ) -> SimulationResult:
        """Execute a simulation via Tenderly API."""
        payload: dict = {
            "network_id": str(chain_id),
            "from": from_address,
            "to": to_address,
            "input": input_data,
            "value": "0",
            "gas_price": "0",
            "save": False,
            "save_if_fails": False,
            "simulation_type": "full",
        }

        if state_objects:
            payload["state_objects"] = state_objects

        logger.info(
            "tenderly_simulate_request",
            chain_id=chain_id,
            safe_address=to_address,
            from_address=from_address,
        )

        # TODO: Consider reusing httpx.AsyncClient across calls for connection
        # pooling if simulation frequency increases.
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                self._simulate_url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Access-Key": self._access_key,
                },
            )

        if response.status_code == 429:
            raise TenderlyError(
                "Tenderly rate limit exceeded. Please try again later.",
                status_code=429,
            )

        if response.status_code >= 400:
            error_body = ""
            try:
                error_data = response.json()
                error_body = error_data.get("error", {}).get("message", response.text)
            except Exception:
                error_body = response.text
            raise TenderlyError(
                f"Tenderly API error ({response.status_code}): {error_body}",
                status_code=response.status_code,
            )

        data = response.json()
        return parse_simulation_response(data, chain_id=chain_id)
