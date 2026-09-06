"""
EVM chain adapter implementation.

Provides Safe-based multisig wallet functionality for EVM-compatible chains.
Implements the ChainAdapter interface with EVM-specific operations.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

from ..base import (
    Balance,
    BroadcastResult,
    ChainAdapter,
    UnsignedTransaction,
    WalletConfig,
)
from .multicall import BalanceQuery, Multicall3
from .safe import (
    Operation,
    SafeDeploymentInfo,
    SafeManager,
    SafeSignature,
    SafeTransaction,
)
from .web3_client import EVMNetwork, Web3Client, Web3ClientError

logger = logging.getLogger(__name__)


class EVMAdapterError(Exception):
    """Base exception for EVM adapter errors."""

    pass


class EVMConnectionError(EVMAdapterError):
    """Raised when connection to RPC fails."""

    pass


class EVMTransactionError(EVMAdapterError):
    """Raised when transaction building/execution fails."""

    pass


@dataclass
class SafeWalletConfig:
    """Extended wallet config for Safe wallets."""

    address: str
    owners: list[str]
    threshold: int
    salt_nonce: int
    is_deployed: bool
    factory_address: str
    singleton_address: str


class EVMAdapter(ChainAdapter[SafeTransaction]):
    """
    EVM chain adapter with Safe multisig support.

    Provides a unified interface for:
    - Creating Safe multisig wallets (counterfactual)
    - Building Safe transactions
    - Verifying signatures
    - Broadcasting transactions
    - Querying balances (native + ERC20)
    """

    def __init__(
        self,
        rpc_url: str | None = None,
        network: EVMNetwork = EVMNetwork.LOCAL,
        factory_address: str | None = None,
        singleton_address: str | None = None,
    ):
        """
        Initialize EVM adapter.

        Args:
            rpc_url: Custom RPC endpoint URL.
            network: Target EVM network.
            factory_address: Custom Safe factory address.
            singleton_address: Custom Safe singleton address.
        """
        self._network = network
        self._client = Web3Client(rpc_url=rpc_url, network=network)
        self._safe_manager: SafeManager | None = None
        self._multicall: Multicall3 | None = None
        self._connected = False
        self._factory_address = factory_address
        self._singleton_address = singleton_address

        # Cache wallet configs
        self._wallet_configs: dict[str, SafeWalletConfig] = {}

    # -------------------------------------------------------------------------
    # ChainAdapter Interface
    # -------------------------------------------------------------------------

    @property
    def chain_name(self) -> str:
        """Return the chain identifier."""
        return f"EVM:{self._network.value}"

    @property
    def is_connected(self) -> bool:
        """Check if adapter is connected."""
        return self._connected and self._client.is_connected

    async def connect(self) -> None:
        """
        Establish connection to the EVM network.

        Raises:
            EVMConnectionError: If connection fails.
        """
        if self._connected:
            return

        try:
            await self._client.connect()
            self._safe_manager = SafeManager(
                self._client,
                factory_address=self._factory_address,
                singleton_address=self._singleton_address,
            )
            self._multicall = Multicall3(self._client)
            self._connected = True
            logger.info(
                f"Connected to {self.chain_name} (chain_id={self._client.chain_id})"
            )
        except Web3ClientError as e:
            raise EVMConnectionError(f"Failed to connect: {e}")

    async def disconnect(self) -> None:
        """Close the connection."""
        await self._client.disconnect()
        self._safe_manager = None
        self._multicall = None
        self._connected = False
        self._wallet_configs.clear()

    async def __aenter__(self) -> EVMAdapter:
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        await self.disconnect()

    async def create_multisig(
        self,
        addresses: list[str],
        threshold: int,
        salt_nonce: int = 0,
        **kwargs,
    ) -> WalletConfig:
        """
        Create a Safe multisig wallet configuration.

        The wallet address is computed counterfactually using CREATE2.
        Actual deployment happens on first transaction.

        Args:
            addresses: List of owner addresses.
            threshold: Number of signatures required.
            salt_nonce: Salt for deterministic address derivation.

        Returns:
            WalletConfig with predicted address and metadata.

        Raises:
            ValueError: If threshold > len(addresses).
            EVMAdapterError: If not connected.
        """
        self._ensure_connected()

        if threshold > len(addresses):
            raise ValueError(
                f"Threshold ({threshold}) cannot exceed owner count ({len(addresses)})"
            )

        if threshold < 1:
            raise ValueError("Threshold must be at least 1")

        # Get deployment info from Safe manager
        deployment_info = await self._safe_manager.get_deployment_info(
            owners=addresses,
            threshold=threshold,
            salt_nonce=salt_nonce,
        )

        # Cache config
        config = SafeWalletConfig(
            address=deployment_info.address,
            owners=deployment_info.owners,
            threshold=deployment_info.threshold,
            salt_nonce=deployment_info.salt_nonce,
            is_deployed=deployment_info.is_deployed,
            factory_address=deployment_info.factory_address,
            singleton_address=deployment_info.singleton_address,
        )
        self._wallet_configs[deployment_info.address.lower()] = config

        return WalletConfig(
            address=deployment_info.address,
            status="ACTIVE" if deployment_info.is_deployed else "PENDING_DEPLOY",
            extra_data={
                "owners": deployment_info.owners,
                "threshold": deployment_info.threshold,
                "salt_nonce": deployment_info.salt_nonce,
                "factory": deployment_info.factory_address,
                "singleton": deployment_info.singleton_address,
                "is_deployed": deployment_info.is_deployed,
            },
        )

    async def get_balance(self, address: str) -> Balance:
        """
        Get native token balance for an address.

        Args:
            address: Ethereum address.

        Returns:
            Balance with confirmed amount (EVM has no mempool visibility).
        """
        self._ensure_connected()

        try:
            balance = await self._client.get_balance(address)
            return Balance(confirmed=balance, unconfirmed=0)
        except Web3ClientError as e:
            raise EVMAdapterError(f"Failed to get balance: {e}")

    async def get_token_balances(
        self,
        address: str,
        tokens: list[str],
    ) -> dict[str, int]:
        """
        Get ERC20 token balances for an address.

        Args:
            address: Wallet address.
            tokens: List of token contract addresses.

        Returns:
            Dict mapping token address to balance.
        """
        self._ensure_connected()

        if not tokens:
            return {}

        queries = [BalanceQuery(address=address, token=token) for token in tokens]
        results = await self._multicall.get_balances(queries)

        return {
            r.token: r.balance
            for r in results
            if r.success and r.token is not None
        }

    async def build_transaction(
        self,
        from_address: str,
        to_address: str,
        amount: int,
        data: bytes = b"",
        operation: Operation = Operation.CALL,
        **kwargs,
    ) -> UnsignedTransaction:
        """
        Build a Safe transaction.

        Args:
            from_address: Safe wallet address.
            to_address: Recipient address.
            amount: Value in wei.
            data: Optional call data.
            operation: CALL or DELEGATE_CALL.

        Returns:
            UnsignedTransaction with Safe transaction payload.

        Raises:
            EVMTransactionError: If building fails.
        """
        self._ensure_connected()

        try:
            # Build Safe transaction
            safe_tx = await self._safe_manager.build_safe_transaction(
                safe_address=from_address,
                to=to_address,
                value=amount,
                data=data,
                operation=operation,
            )

            # Get wallet config if cached
            config = self._wallet_configs.get(from_address.lower())

            return UnsignedTransaction(
                payload=safe_tx.tx_hash.hex(),  # Transaction hash for signing
                fee=0,  # Safe doesn't pre-calculate gas
                metadata={
                    "safe_address": safe_tx.safe_address,
                    "to": safe_tx.to,
                    "value": safe_tx.value,
                    "data": safe_tx.data.hex() if safe_tx.data else "",
                    "operation": safe_tx.operation,
                    "nonce": safe_tx.nonce,
                    "chain_id": safe_tx.chain_id,
                    "typed_data": safe_tx.get_typed_data(),
                    "threshold": config.threshold if config else None,
                    "is_deployed": config.is_deployed if config else None,
                },
            )
        except Exception as e:
            raise EVMTransactionError(f"Failed to build transaction: {e}")

    async def verify_signature(
        self,
        message: bytes,
        signature: bytes,
        public_key: str,
    ) -> bool:
        """
        Verify an Ethereum signature.

        Args:
            message: The Safe transaction hash (32 bytes).
            signature: The 65-byte signature (r, s, v).
            public_key: The expected signer address.

        Returns:
            True if signature is valid.
        """
        try:
            # For Safe transactions, message is the tx hash
            # Use personal_sign format
            encoded = encode_defunct(primitive=message)
            recovered = Account.recover_message(encoded, signature=signature)
            return recovered.lower() == public_key.lower()
        except Exception:
            return False

    async def broadcast(
        self,
        signed_tx: bytes | str,
    ) -> BroadcastResult:
        """
        Broadcast a signed Safe transaction.

        For Safe transactions, this means:
        1. Deploying the Safe if not yet deployed
        2. Calling execTransaction with collected signatures

        Args:
            signed_tx: Serialized transaction with signatures.

        Returns:
            BroadcastResult with transaction hash.
        """
        self._ensure_connected()

        try:
            tx_hash = await self._client.send_raw_transaction(signed_tx)
            return BroadcastResult(tx_hash=tx_hash, success=True)
        except Web3ClientError as e:
            return BroadcastResult(
                tx_hash="",
                success=False,
                error=str(e),
            )

    # -------------------------------------------------------------------------
    # Safe-Specific Methods
    # -------------------------------------------------------------------------

    async def get_safe_info(self, safe_address: str) -> dict[str, Any]:
        """
        Get information about a deployed Safe.

        Args:
            safe_address: Safe contract address.

        Returns:
            Dict with owners, threshold, nonce, etc.
        """
        self._ensure_connected()

        try:
            nonce = await self._safe_manager.get_nonce(safe_address)

            # Get owners and threshold via direct calls
            # getOwners()
            owners_data = Web3.keccak(text="getOwners()")[:4]
            owners_result = await self._client.call(safe_address, owners_data)
            from eth_abi import decode

            (owners,) = decode(["address[]"], owners_result)

            # getThreshold()
            threshold_data = Web3.keccak(text="getThreshold()")[:4]
            threshold_result = await self._client.call(safe_address, threshold_data)
            (threshold,) = decode(["uint256"], threshold_result)

            return {
                "address": Web3.to_checksum_address(safe_address),
                "owners": list(owners),
                "threshold": threshold,
                "nonce": nonce,
            }
        except Exception as e:
            raise EVMAdapterError(f"Failed to get Safe info: {e}")

    async def build_policy_change_transaction(
        self,
        wallet_address: str,
        action: str,
        params: dict,
        safe_nonce: int,
        safe_info: dict | None = None,
    ) -> SafeTransaction:
        """Build a Safe policy change transaction.

        Args:
            wallet_address: Safe contract address.
            action: add_owner | remove_owner | swap_owner | change_threshold.
            params: Action-specific parameters.
            safe_nonce: Allocated Safe nonce.
            safe_info: Pre-fetched Safe info (owners/threshold/nonce).
                       If None, will be fetched via get_safe_info().

        Returns:
            SafeTransaction ready for signing.
        """
        self._ensure_connected()

        if safe_info is None:
            safe_info = await self.get_safe_info(wallet_address)
        owners = safe_info["owners"]
        current_threshold = safe_info["threshold"]
        owner_count = len(owners)

        # ── Validation ──
        new_owner = params.get("new_owner")
        removed_owner = params.get("removed_owner")
        new_threshold = params.get("new_threshold")

        if action == "add_owner":
            if new_owner and new_owner.lower() in [o.lower() for o in owners]:
                raise ValueError(f"{new_owner} is already an owner")
            if new_threshold is not None and (
                new_threshold < 1 or new_threshold > owner_count + 1
            ):
                raise ValueError(
                    f"Threshold must be between 1 and {owner_count + 1}"
                )

        elif action == "remove_owner":
            if owner_count <= 1:
                raise ValueError("Cannot remove the only owner")
            if removed_owner and removed_owner.lower() not in [
                o.lower() for o in owners
            ]:
                raise ValueError(f"{removed_owner} is not an owner")
            if new_threshold is not None and (
                new_threshold < 1 or new_threshold > owner_count - 1
            ):
                raise ValueError(
                    f"Threshold must be between 1 and {owner_count - 1}"
                )

        elif action == "swap_owner":
            if removed_owner and removed_owner.lower() not in [
                o.lower() for o in owners
            ]:
                raise ValueError(f"{removed_owner} is not an owner")
            if new_owner and new_owner.lower() in [o.lower() for o in owners]:
                raise ValueError(f"{new_owner} is already an owner")

        elif action == "change_threshold":
            if new_threshold == current_threshold:
                raise ValueError(
                    f"New threshold {new_threshold} is the same as current"
                )
            if new_threshold is not None and (
                new_threshold < 1 or new_threshold > owner_count
            ):
                raise ValueError(
                    f"Threshold must be between 1 and {owner_count}"
                )

        # ── Build calldata ──
        calldata = self._safe_manager.build_policy_change_data(
            action=action,
            new_owner=new_owner,
            removed_owner=removed_owner,
            new_threshold=new_threshold,
            owners=owners,
        )

        # ── Build SafeTransaction (self-call: to = Safe address) ──
        safe_tx = await self._safe_manager.build_safe_transaction(
            safe_address=wallet_address,
            to=wallet_address,
            value=0,
            data=calldata,
            nonce=safe_nonce,
        )

        return safe_tx

    async def is_deployed(self, address: str) -> bool:
        """
        Check if a Safe is deployed.

        Args:
            address: Safe address to check.

        Returns:
            True if contract code exists at address.
        """
        self._ensure_connected()

        code = await self._client.web3.eth.get_code(
            Web3.to_checksum_address(address)
        )
        return len(code) > 0

    async def build_deployment_transaction(
        self,
        owners: list[str],
        threshold: int,
        salt_nonce: int = 0,
    ) -> dict[str, Any]:
        """
        Build a transaction to deploy a new Safe.

        Args:
            owners: List of owner addresses.
            threshold: Required signature count.
            salt_nonce: Salt for CREATE2.

        Returns:
            Transaction dict for deployment.
        """
        self._ensure_connected()

        return self._safe_manager.build_deployment_tx(
            owners=owners,
            threshold=threshold,
            salt_nonce=salt_nonce,
        )

    def build_exec_transaction(
        self,
        safe_tx: SafeTransaction,
        signatures: list[SafeSignature],
    ) -> bytes:
        """
        Build the execTransaction call data.

        Args:
            safe_tx: The Safe transaction.
            signatures: List of collected signatures.

        Returns:
            Encoded call data for execTransaction.
        """
        combined_sigs = self._safe_manager.combine_signatures(signatures)
        return self._safe_manager.build_exec_transaction_data(safe_tx, combined_sigs)

    async def get_pending_transactions(
        self,
        safe_address: str,
    ) -> list[dict[str, Any]]:
        """
        Get pending (not yet executed) transactions for a Safe.

        This implementation checks local state; for full pending tx
        tracking, use the Safe Transaction Service API.

        Args:
            safe_address: Safe contract address.

        Returns:
            List of pending transaction metadata.
        """
        # In a full implementation, this would query the Safe Transaction Service
        # For now, return empty list (local tracking only)
        return []

    # -------------------------------------------------------------------------
    # Event Monitoring
    # -------------------------------------------------------------------------

    async def get_execution_events(
        self,
        safe_addresses: list[str],
        from_block: int,
        to_block: int | str = "latest",
    ) -> list[dict[str, Any]]:
        """
        Get Safe execution events for specified addresses.

        Args:
            safe_addresses: List of Safe addresses to monitor.
            from_block: Starting block number.
            to_block: Ending block (default: latest).

        Returns:
            List of parsed execution events.
        """
        self._ensure_connected()

        from .safe import EXECUTION_SUCCESS_TOPIC, EXECUTION_FAILURE_TOPIC

        logs = await self._client.get_logs(
            address=safe_addresses,
            topics=[[EXECUTION_SUCCESS_TOPIC, EXECUTION_FAILURE_TOPIC]],
            from_block=from_block,
            to_block=to_block,
        )

        events = []
        for log in logs:
            parsed = SafeManager.parse_execution_event(log)
            if parsed:
                events.append(parsed)

        return events

    # -------------------------------------------------------------------------
    # Wallet Registration
    # -------------------------------------------------------------------------

    def register_wallet(
        self,
        config: SafeWalletConfig,
    ) -> None:
        """
        Register a wallet config for local tracking.

        Args:
            config: SafeWalletConfig to register.
        """
        self._wallet_configs[config.address.lower()] = config

    def get_registered_wallet(self, address: str) -> SafeWalletConfig | None:
        """
        Get a registered wallet config.

        Args:
            address: Wallet address.

        Returns:
            SafeWalletConfig or None if not registered.
        """
        return self._wallet_configs.get(address.lower())

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def _ensure_connected(self) -> None:
        """Raise if not connected."""
        if not self._connected or self._safe_manager is None:
            raise EVMConnectionError("Not connected to EVM network")

    @property
    def chain_id(self) -> int | None:
        """Get the current chain ID."""
        return self._client.chain_id

    @property
    def client(self) -> Web3Client:
        """Get the underlying Web3 client."""
        return self._client

    @property
    def safe_manager(self) -> SafeManager | None:
        """Get the Safe manager instance."""
        return self._safe_manager

    @property
    def multicall(self) -> Multicall3 | None:
        """Get the Multicall3 instance."""
        return self._multicall
