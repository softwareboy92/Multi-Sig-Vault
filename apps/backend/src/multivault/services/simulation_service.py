"""Service for transaction simulation."""

from __future__ import annotations

import json

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from multivault.chains.evm.safe import SafeTransaction
from multivault.chains.evm.tenderly import (
    ZERO_ADDRESS,
    TenderlyError,
    TenderlySimulator,
    build_state_overrides,
)
from multivault.chains.evm.web3_client import Web3Client
from multivault.errors.exceptions import NotFoundError, ValidationError
from multivault.models.simulation import SimulationStatus, TransactionSimulation
from multivault.models.transaction import Transaction, TransactionStatus
from multivault.models.wallet import Wallet, WalletSigner
from multivault.services.simulation_config_service import (
    SimulationConfigService,
    TenderlyCredentials,
)
from multivault.utils.extra import get_extra_field

logger = structlog.get_logger(__name__)

# Transaction statuses that allow simulation
SIMULATABLE_STATUSES = {
    TransactionStatus.PENDING_SIGN,
    TransactionStatus.PARTIALLY_SIGNED,
    TransactionStatus.SIGNED,
}


class SimulationService:
    """Orchestrates transaction simulation via Tenderly."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_configuration(self) -> TenderlyCredentials:
        """Resolve encrypted UI settings with legacy environment fallback."""
        return SimulationConfigService().get_credentials()

    async def is_configured(self) -> bool:
        """Check if Tenderly is configured."""
        return (await self.get_configuration()).configured

    async def get_simulation(
        self, transaction_id: str,
    ) -> TransactionSimulation | None:
        """Get existing simulation result for a transaction."""
        result = await self.db.execute(
            select(TransactionSimulation).where(
                TransactionSimulation.transaction_id == transaction_id,
            ),
        )
        return result.scalar_one_or_none()

    async def simulate_transaction(
        self, transaction_id: str,
    ) -> TransactionSimulation:
        """Run simulation for an EVM Safe transaction.

        1. Validate transaction state and chain type
        2. Rebuild Safe transaction params from payload
        3. Build execTransaction calldata with state overrides
        4. Call Tenderly API
        5. Persist and return result
        """
        credentials = await self.get_configuration()
        if not credentials.configured:
            raise ValidationError(
                message="Tenderly is not configured",
                details={"hint": "Configure transaction simulation in Security Settings"},
            )

        # Load transaction with wallet
        result = await self.db.execute(
            select(Transaction)
            .options(
                selectinload(Transaction.wallet)
                .selectinload(Wallet.wallet_signers)
                .selectinload(WalletSigner.signer),
            )
            .options(selectinload(Transaction.signatures))
            .where(Transaction.id == transaction_id),
        )
        tx = result.scalar_one_or_none()
        if not tx:
            raise NotFoundError(resource="Transaction", identifier=transaction_id)

        wallet: Wallet = tx.wallet

        # Validate chain type
        if wallet.chain_type != "EVM":
            raise ValidationError(
                message="Simulation is only available for EVM transactions",
            )

        # Validate status
        tx_status = tx.status
        if hasattr(tx_status, "value"):
            tx_status = TransactionStatus(tx_status.value)
        if tx_status not in SIMULATABLE_STATUSES:
            raise ValidationError(
                message=f"Cannot simulate transaction in {tx_status} status",
                details={"current_status": str(tx_status)},
            )

        # Run EVM simulation
        try:
            sim_result = await self._simulate_evm(tx, wallet, credentials)
        except TenderlyError as e:
            logger.warning(
                "tenderly_simulation_failed",
                transaction_id=transaction_id,
                error=str(e),
                status_code=e.status_code,
            )
            sim_result = {
                "status": SimulationStatus.ERROR,
                "result": json.dumps({}),
                "error_message": str(e),
                "gas_used": None,
            }
        except Exception as e:
            logger.exception(
                "simulation_unexpected_error",
                transaction_id=transaction_id,
            )
            sim_result = {
                "status": SimulationStatus.ERROR,
                "result": json.dumps({}),
                "error_message": f"Unexpected error: {e!s}",
                "gas_used": None,
            }

        # Upsert simulation result
        return await self._upsert_simulation(transaction_id, sim_result)

    async def _simulate_evm(
        self,
        tx: Transaction,
        wallet: Wallet,
        credentials: TenderlyCredentials,
    ) -> dict:
        """Execute EVM simulation via Tenderly.

        Returns dict with keys: status, result, error_message, gas_used
        """
        from multivault.chains.evm.safe import SafeManager
        from multivault.services.network_service import NetworkService

        # Get chain_id from network config
        network_service = NetworkService(self.db)
        network = await network_service.get_network(wallet.network_id)
        chain_id = get_extra_field(network, "chain_id") if network else None
        if not chain_id:
            raise ValidationError(
                message="Cannot determine chain ID for this wallet's network",
            )

        # Get RPC URL for on-chain queries (nonce, guard check)
        node = await network_service.get_default_node(wallet.network_id)
        rpc_url = node.endpoint_url if node else None

        # Parse Safe tx params from payload (EIP-712 typed data JSON)
        safe_tx_params = self._extract_safe_tx_params(tx)

        # Build Safe transaction object
        safe_tx = SafeTransaction(
            to=safe_tx_params["to"],
            value=int(safe_tx_params["value"]),
            data=bytes.fromhex(safe_tx_params["data"].replace("0x", "")) if safe_tx_params["data"] else b"",
            operation=int(safe_tx_params.get("operation", 0)),
            safe_tx_gas=int(safe_tx_params.get("safeTxGas", 0)),
            base_gas=int(safe_tx_params.get("baseGas", 0)),
            gas_price=int(safe_tx_params.get("gasPrice", 0)),
            gas_token=safe_tx_params.get("gasToken", ZERO_ADDRESS),
            refund_receiver=safe_tx_params.get("refundReceiver", ZERO_ADDRESS),
            nonce=int(safe_tx_params.get("nonce", tx.safe_nonce or 0)),
            safe_address=wallet.address,
            chain_id=int(chain_id),
        )

        # Build signer_id → address map for sorting signatures
        if not wallet.wallet_signers:
            raise ValidationError(message="Wallet has no signers")

        all_sigs, execution_owner, override_threshold = self._build_simulation_signatures(
            wallet, tx,
        )

        # Check if nonce override needed
        nonce_override = None
        on_chain_nonce = None
        if rpc_url:
            try:
                web3_client = Web3Client(rpc_url=rpc_url)
                await web3_client.connect()
                try:
                    safe_manager = SafeManager(web3_client)
                    on_chain_nonce = await safe_manager.get_nonce(wallet.address)
                    if safe_tx.nonce > on_chain_nonce:
                        nonce_override = safe_tx.nonce
                finally:
                    await web3_client.disconnect()
            except Exception:
                logger.warning("failed_to_check_on_chain_nonce", exc_info=True)

        # TODO: Refactor build_exec_transaction_data into a @staticmethod or
        # standalone function so we don't need to bypass __init__ via __new__.
        # Currently safe because this method only reads its arguments (tx params
        # + signatures) to ABI-encode execTransaction calldata.
        safe_manager_local = SafeManager.__new__(SafeManager)
        exec_data = safe_manager_local.build_exec_transaction_data(
            safe_tx, all_sigs,
        )

        # Build state overrides
        state_objects = build_state_overrides(
            wallet.address,
            override_threshold=override_threshold,
            nonce_override=nonce_override,
            # Guard override: skip for now, can add later if needed
        )

        # Call Tenderly
        simulator = TenderlySimulator(
            access_key=credentials.access_key,
            account_slug=credentials.account_slug,
            project_slug=credentials.project_slug,
        )

        tenderly_result = await simulator.simulate(
            chain_id=int(chain_id),
            from_address=execution_owner,
            to_address=wallet.address,
            input_data="0x" + exec_data.hex(),
            state_objects=state_objects,
        )

        status = (
            SimulationStatus.SUCCESS
            if tenderly_result.success
            else SimulationStatus.FAILURE
        )

        return {
            "status": status,
            "result": json.dumps(tenderly_result.to_dict()),
            "error_message": tenderly_result.revert_reason,
            "gas_used": tenderly_result.gas_used,
        }

    @staticmethod
    def _build_simulation_signatures(
        wallet: Wallet,
        tx: Transaction,
    ) -> tuple[bytes, str, bool]:
        """Assemble sorted signatures for Safe execTransaction simulation.

        Safe's checkNSignatures requires signatures sorted by signer address
        (ascending). When all ECDSA signatures are present (>= threshold),
        only collected signatures are used. Otherwise a preValidated signature
        is appended for an owner who hasn't signed yet.

        Returns:
            (combined_sig_bytes, execution_owner_address, override_threshold)
        """
        signer_address_map: dict[str, str] = {}
        for ws in wallet.wallet_signers:
            signer_address_map[ws.signer.id] = ws.signer.address

        # Collect ECDSA signatures with signer addresses
        sig_entries: list[tuple[str, bytes]] = []
        for sig in tx.signatures:
            if hasattr(sig, "signature_data") and sig.signature_data:
                addr = signer_address_map.get(sig.signer_id)
                if addr:
                    sig_bytes = bytes.fromhex(sig.signature_data.replace("0x", ""))
                    sig_entries.append((addr.lower(), sig_bytes))

        # Only add preValidated when collected signatures are insufficient.
        # When all signatures are present, using preValidated would create
        # a duplicate signer → Safe reverts with GS026.
        if len(sig_entries) < wallet.threshold:
            # Pick an owner NOT already in collected to avoid duplicates
            signed_addrs = {addr for addr, _ in sig_entries}
            execution_owner = None
            for ws in wallet.wallet_signers:
                if ws.signer.address and ws.signer.address.lower() not in signed_addrs:
                    execution_owner = ws.signer.address
                    break
            if not execution_owner:
                execution_owner = wallet.signers[0].address

            pre_validated_sig = (
                bytes(12)
                + bytes.fromhex(execution_owner.replace("0x", ""))
                + bytes(32)
                + bytes([1])
            )
            sig_entries.append((execution_owner.lower(), pre_validated_sig))
        else:
            execution_owner = wallet.signers[0].address

        # Sort by signer address ascending — Safe requires this (GS026)
        sig_entries.sort(key=lambda x: x[0])

        all_sigs = b""
        for _, sig_bytes in sig_entries:
            all_sigs += sig_bytes

        override_threshold = len(sig_entries) < wallet.threshold
        return all_sigs, execution_owner, override_threshold

    def _extract_safe_tx_params(self, tx: Transaction) -> dict:
        """Extract Safe transaction parameters from tx.payload.

        The payload stores EIP-712 typed data JSON with the Safe tx params
        in the 'message' field.
        """
        if not tx.payload:
            raise ValidationError(
                message="Transaction has no payload data for simulation",
            )

        try:
            typed_data = json.loads(tx.payload)
        except json.JSONDecodeError as e:
            raise ValidationError(
                message=f"Invalid transaction payload format: {e}",
            )

        message = typed_data.get("message")
        if not message:
            raise ValidationError(
                message="Transaction payload missing 'message' field (not EIP-712 typed data)",
            )

        required_fields = ["to", "value"]
        for field_name in required_fields:
            if field_name not in message:
                raise ValidationError(
                    message=f"Safe tx params missing required field: {field_name}",
                )

        return message

    async def _upsert_simulation(
        self, transaction_id: str, sim_data: dict,
    ) -> TransactionSimulation:
        """Insert or update simulation result."""
        from multivault.models.base import generate_uuid

        existing = await self.get_simulation(transaction_id)
        if existing:
            existing.status = sim_data["status"]
            existing.result = sim_data["result"]
            existing.error_message = sim_data.get("error_message")
            existing.gas_used = sim_data.get("gas_used")
            await self.db.commit()
            await self.db.refresh(existing)
            return existing

        simulation = TransactionSimulation(
            id=generate_uuid(),
            transaction_id=transaction_id,
            status=sim_data["status"],
            chain_type="evm",
            result=sim_data["result"],
            error_message=sim_data.get("error_message"),
            gas_used=sim_data.get("gas_used"),
        )
        self.db.add(simulation)
        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            # Concurrent insert race — retry as update
            existing = await self.get_simulation(transaction_id)
            if existing:
                existing.status = sim_data["status"]
                existing.result = sim_data["result"]
                existing.error_message = sim_data.get("error_message")
                existing.gas_used = sim_data.get("gas_used")
                await self.db.commit()
                await self.db.refresh(existing)
                return existing
            raise
        await self.db.refresh(simulation)
        return simulation
