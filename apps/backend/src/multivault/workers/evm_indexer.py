"""EVM event indexer worker.

Polls Safe contracts for ExecutionSuccess/ExecutionFailure events
and updates transaction statuses accordingly.
"""

import logging
from typing import TYPE_CHECKING, Any

from multivault.workers.base import BaseWorker

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def _resolve_network_ids(session_factory, chain_id: int) -> list[str]:
    """Resolve EVM chain_id to all matching network.id values.

    Multiple NetworkConfig rows may share the same chain_id (e.g. user
    created duplicates).  We must return ALL of them so that workers
    query transactions across every matching network.
    """
    import json

    from sqlalchemy import select

    from multivault.models.network import NetworkConfig

    ids: list[str] = []
    async with session_factory() as session:
        stmt = select(NetworkConfig).where(
            NetworkConfig.chain_type == "EVM",
            NetworkConfig.enabled.is_(True),
        )
        result = await session.execute(stmt)
        for network in result.scalars().all():
            if network.extra:
                extra = json.loads(network.extra) if isinstance(network.extra, str) else network.extra
                if extra.get("chain_id") == chain_id:
                    ids.append(network.id)
    return ids


class EVMEventIndexer(BaseWorker):
    """Worker that indexes Safe transaction execution events.

    Polls for ExecutionSuccess and ExecutionFailure events from Safe contracts
    and updates the corresponding transaction statuses in the database.

    Configuration:
        - interval_seconds: Polling interval (default: 15)
        - block_range: Number of blocks to query per poll (default: 100)
    """

    def __init__(
        self,
        session_factory,
        rpc_url: str,
        chain_id: int | None = None,
        interval_seconds: float = 15.0,
        block_range: int = 100,
        start_block: int | None = None,
        confirmation_blocks: int = 5,
    ):
        """Initialize the EVM event indexer.

        Args:
            session_factory: Async session factory for database access
            rpc_url: EVM RPC endpoint URL
            interval_seconds: Polling interval in seconds
            block_range: Number of blocks to query per poll
            start_block: Starting block number (None = current - block_range)
            confirmation_blocks: Safety buffer from chain tip to avoid
                querying blocks not yet available for log queries on
                load-balanced or OP Stack RPC endpoints.
        """
        super().__init__(
            interval_seconds=interval_seconds,
            name="EVMEventIndexer",
        )
        self._session_factory = session_factory
        self._rpc_url = rpc_url
        self._chain_id = chain_id
        self._block_range = block_range
        self._confirmation_blocks = confirmation_blocks
        self._last_processed_block: int | None = start_block
        self._client = None
        self._target_network_ids: list[str] = []

    async def on_start(self) -> None:
        """Initialize Web3 client on worker start."""
        from multivault.chains.evm import Web3Client

        try:
            self._client = Web3Client(rpc_url=self._rpc_url)
            await self._client.connect()
            if self._chain_id is not None:
                self._target_network_ids = await _resolve_network_ids(
                    self._session_factory, self._chain_id
                )
            logger.info(f"EVMEventIndexer started, connected to {self._rpc_url}")
        except Exception as e:
            logger.error(f"EVMEventIndexer failed to connect: {e}")
            # Ensure partial client is cleaned up
            if self._client:
                try:
                    await self._client.disconnect()
                except Exception:
                    pass
                self._client = None
            raise

    async def on_stop(self) -> None:
        """Disconnect Web3 client on worker stop."""
        if self._client:
            try:
                await self._client.disconnect()
                logger.info("EVMEventIndexer stopped")
            except Exception as e:
                logger.warning(f"EVMEventIndexer disconnect error: {e}")
            finally:
                self._client = None

    async def execute(self) -> None:
        """Poll for Safe execution events."""
        if not self._client or not self._client.is_connected:
            logger.warning("EVMEventIndexer: Web3 client not connected, skipping")
            return

        # Get current block, applying a safety buffer to avoid querying
        # blocks not yet available for log queries on load-balanced RPCs
        current_block = await self._client.get_block_number()
        safe_head = max(0, current_block - self._confirmation_blocks)

        # Determine block range to query
        if self._last_processed_block is None:
            from_block = max(0, safe_head - self._block_range)
        else:
            from_block = self._last_processed_block + 1

        to_block = min(from_block + self._block_range, safe_head)

        if from_block > to_block:
            logger.debug("EVMEventIndexer: no new blocks (from=%d > to=%d)", from_block, to_block)
            return

        # Get all active Safe addresses from database
        safe_addresses = await self._get_active_safe_addresses()
        if not safe_addresses:
            self._last_processed_block = to_block
            return

        # Query events for each Safe
        events_processed = 0
        had_errors = False
        for safe_address in safe_addresses:
            try:
                events = await self._query_safe_events(
                    safe_address, from_block, to_block
                )
                for event in events:
                    await self._process_event(event)
                    events_processed += 1
            except Exception:
                logger.exception(
                    f"Error querying events for {safe_address} "
                    f"in blocks {from_block}-{to_block}"
                )
                had_errors = True

        if not had_errors:
            self._last_processed_block = to_block
        else:
            # Don't advance block pointer so the range is retried next tick
            logger.warning(
                f"EVMEventIndexer: errors occurred, will retry blocks "
                f"{from_block}-{to_block} on next tick"
            )

        if events_processed > 0:
            logger.info(
                f"Processed {events_processed} events from blocks {from_block}-{to_block}"
            )

    async def _get_active_safe_addresses(self) -> list[str]:
        """Get addresses of all active EVM wallets."""
        from sqlalchemy import select

        from multivault.models.signer import ChainType
        from multivault.models.wallet import Wallet, WalletStatus

        async with self._session_factory() as session:
            stmt = select(Wallet.address).where(
                Wallet.chain_type == ChainType.EVM,
                Wallet.status == WalletStatus.ACTIVE,
                Wallet.address.isnot(None),
                Wallet.deleted_at.is_(None),
            )
            if self._target_network_ids:
                stmt = stmt.where(
                    Wallet.network_id.in_(self._target_network_ids)
                )
            result = await session.execute(stmt)
            addresses = [row[0] for row in result.fetchall()]
            return addresses

    async def _query_safe_events(
        self, safe_address: str, from_block: int, to_block: int
    ) -> list[dict[str, Any]]:
        """Query ExecutionSuccess/ExecutionFailure events for a Safe."""
        from multivault.chains.evm.safe import (
            EXECUTION_FAILURE_TOPIC,
            EXECUTION_SUCCESS_TOPIC,
            SafeManager,
        )

        # Query logs for both event types using wrapped method
        # Note: topics is a list where first element is OR of event signatures
        logs = await self._client.get_logs(
            address=safe_address,
            topics=[[EXECUTION_SUCCESS_TOPIC, EXECUTION_FAILURE_TOPIC]],
            from_block=from_block,
            to_block=to_block,
        )

        # Parse events
        events = []
        for log in logs:
            parsed = SafeManager.parse_execution_event(log)
            if parsed:
                events.append(parsed)

        return events

    async def _process_event(self, event: dict[str, Any]) -> None:
        """Process a parsed Safe execution event.

        Updates the corresponding transaction status based on the event type.
        """
        from sqlalchemy import select

        from multivault.models.transaction import (
            Transaction,
            TransactionStatus,
            TransactionType,
        )

        safe_tx_hash = event.get("tx_hash")
        on_chain_tx_hash = event.get("tx")
        block_number = event.get("block")
        event_type = event.get("event")

        if not safe_tx_hash:
            return

        # Normalize: parse_execution_event returns hex without 0x prefix,
        # but payload_hash in DB is stored with 0x prefix.
        if not safe_tx_hash.startswith("0x"):
            safe_tx_hash = "0x" + safe_tx_hash

        async with self._session_factory() as session:
            # Find transaction by payload_hash (Safe tx hash)
            stmt = select(Transaction).where(
                Transaction.payload_hash == safe_tx_hash,
                Transaction.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            tx = result.scalar_one_or_none()

            if not tx:
                # No matching transaction found
                logger.debug(f"No transaction found for safe_tx_hash {safe_tx_hash[:16]}...")
                return

            # Check if already processed
            tx_status = tx.status.value if hasattr(tx.status, "value") else str(tx.status)
            if tx_status == TransactionStatus.CONFIRMED.value:
                return  # Already confirmed — idempotent skip

            if tx_status == TransactionStatus.FAILED.value:
                if event_type == "ExecutionSuccess":
                    # On-chain success = ultimate truth; override nonce-sync's FAILED
                    logger.warning(
                        f"Recovering FAILED tx {tx.id} from chain confirmation, "
                        f"safe_tx_hash: {safe_tx_hash[:16]}..., "
                        f"on_chain_tx_hash: {on_chain_tx_hash}"
                    )
                    # Fall through to CONFIRMED update logic below
                else:
                    # ExecutionFailure on already-FAILED — nothing to do
                    return

            # Update transaction based on event type
            from datetime import UTC, datetime

            now = datetime.now(UTC)

            if event_type == "ExecutionSuccess":
                tx.status = TransactionStatus.CONFIRMED
                tx.tx_hash = on_chain_tx_hash
                tx.block_number = block_number
                tx.confirmed_at = now
                tx.error_message = None
                tx.updated_at = now
                logger.info(
                    f"Transaction {tx.id} confirmed at block {block_number}, "
                    f"tx_hash: {on_chain_tx_hash}"
                )

                # Post-confirmation hook: sync wallet policy on-chain state
                if tx.tx_type == TransactionType.SAFE_POLICY_CHANGE:
                    try:
                        await self._sync_policy_change(session, tx)
                    except Exception as e:
                        logger.error(
                            f"Failed to sync policy for tx {tx.id}: {e}"
                        )
            elif event_type == "ExecutionFailure":
                tx.status = TransactionStatus.FAILED
                tx.tx_hash = on_chain_tx_hash
                tx.block_number = block_number
                tx.error_message = "Safe transaction execution failed on-chain"
                tx.updated_at = now
                logger.warning(
                    f"Transaction {tx.id} failed at block {block_number}, "
                    f"tx_hash: {on_chain_tx_hash}"
                )

            await session.commit()

    async def _sync_policy_change(self, session, tx) -> None:
        """Sync wallet policy from on-chain state after a SAFE_POLICY_CHANGE confirmation.

        Fetches current owners/threshold from the Safe contract and updates
        the local wallet record + signer associations.
        """
        from multivault.chains.evm.adapter import EVMAdapter
        from multivault.models.wallet import Wallet
        from multivault.services.wallet_service import WalletService

        wallet = await session.get(Wallet, tx.wallet_id)
        if not wallet or not wallet.address:
            return

        adapter = EVMAdapter(rpc_url=self._rpc_url)
        await adapter.connect()
        try:
            safe_info = await adapter.get_safe_info(wallet.address)
            wallet_service = WalletService(session)
            await wallet_service.sync_wallet_policy(wallet.id, safe_info)
            logger.info(
                f"Policy synced for wallet {wallet.id} after tx {tx.id}"
            )
        finally:
            await adapter.disconnect()


class EVMBlockConfirmationWorker(BaseWorker):
    """Worker that confirms broadcast transactions after N block confirmations.

    For transactions in BROADCAST status, checks if they have enough
    block confirmations and updates status to CONFIRMED.

    Configuration:
        - interval_seconds: Check interval (default: 30)
        - required_confirmations: Blocks needed for confirmation (default: 3)
    """

    def __init__(
        self,
        session_factory,
        rpc_url: str,
        chain_id: int | None = None,
        interval_seconds: float = 30.0,
        required_confirmations: int = 3,
    ):
        """Initialize the confirmation worker.

        Args:
            session_factory: Async session factory for database access
            rpc_url: EVM RPC endpoint URL
            interval_seconds: Check interval in seconds
            required_confirmations: Number of block confirmations required
        """
        super().__init__(
            interval_seconds=interval_seconds,
            name="EVMBlockConfirmationWorker",
        )
        self._session_factory = session_factory
        self._rpc_url = rpc_url
        self._chain_id = chain_id
        self._required_confirmations = required_confirmations
        self._client = None
        self._target_network_ids: list[str] = []

    async def on_start(self) -> None:
        """Initialize Web3 client."""
        from multivault.chains.evm import Web3Client

        try:
            self._client = Web3Client(rpc_url=self._rpc_url)
            await self._client.connect()
            if self._chain_id is not None:
                self._target_network_ids = await _resolve_network_ids(
                    self._session_factory, self._chain_id
                )
            logger.info(f"EVMBlockConfirmationWorker started, connected to {self._rpc_url}")
        except Exception as e:
            logger.error(f"EVMBlockConfirmationWorker failed to connect: {e}")
            # Ensure partial client is cleaned up
            if self._client:
                try:
                    await self._client.disconnect()
                except Exception:
                    pass
                self._client = None
            raise

    async def on_stop(self) -> None:
        """Disconnect Web3 client."""
        if self._client:
            try:
                await self._client.disconnect()
                logger.info("EVMBlockConfirmationWorker stopped")
            except Exception as e:
                logger.warning(f"EVMBlockConfirmationWorker disconnect error: {e}")
            finally:
                self._client = None

    async def execute(self) -> None:
        """Check broadcast transactions for confirmations."""
        if not self._client or not self._client.is_connected:
            logger.warning(
                "EVMBlockConfirmationWorker: Web3 client not connected, skipping"
            )
            return

        from datetime import UTC, datetime

        from sqlalchemy import select

        from multivault.models.signer import ChainType
        from multivault.models.transaction import Transaction, TransactionStatus
        from multivault.models.wallet import Wallet

        current_block = await self._client.get_block_number()

        async with self._session_factory() as session:
            # Find BROADCAST EVM transactions with tx_hash
            stmt = (
                select(Transaction)
                .join(Wallet, Transaction.wallet_id == Wallet.id)
                .where(
                    Transaction.status == TransactionStatus.BROADCAST,
                    Transaction.tx_hash.isnot(None),
                    Wallet.chain_type == ChainType.EVM,
                    Transaction.deleted_at.is_(None),
                )
            )
            if self._target_network_ids:
                stmt = stmt.where(
                    Wallet.network_id.in_(self._target_network_ids)
                )
            result = await session.execute(stmt)
            transactions = result.scalars().all()

            changed_count = 0
            for tx in transactions:
                try:
                    # Get transaction receipt
                    receipt = await self._client.web3.eth.get_transaction_receipt(
                        tx.tx_hash
                    )

                    if receipt and receipt.get("blockNumber"):
                        confirmations = current_block - receipt["blockNumber"]

                        if confirmations >= self._required_confirmations:
                            now = datetime.now(UTC)
                            # Check if transaction succeeded
                            if receipt.get("status") == 1:
                                tx.status = TransactionStatus.CONFIRMED
                                tx.block_number = receipt["blockNumber"]
                                tx.confirmed_at = now
                                tx.error_message = None
                                tx.updated_at = now
                                changed_count += 1
                                logger.info(
                                    f"Transaction {tx.id} confirmed with "
                                    f"{confirmations} confirmations"
                                )
                            else:
                                tx.status = TransactionStatus.FAILED
                                tx.block_number = receipt["blockNumber"]
                                tx.error_message = "Transaction reverted"
                                tx.updated_at = now
                                changed_count += 1
                                logger.warning(f"Transaction {tx.id} reverted")

                except Exception:
                    logger.exception(f"Error checking tx {tx.id}")

            if changed_count > 0:
                await session.commit()
                logger.info(f"Updated {changed_count} transaction(s)")
