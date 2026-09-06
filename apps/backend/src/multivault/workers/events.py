"""EVM event workers for blockchain event indexing."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Callable

import structlog

from multivault.workers.base import BaseWorker

if TYPE_CHECKING:
    from multivault.chains.evm.adapter import EVMAdapter

logger = structlog.get_logger(__name__)


class EVMEventWorker(BaseWorker):
    """Worker that indexes EVM events for Safe wallets.

    Polls for Safe events (ExecutionSuccess, ExecutionFailure, SafeReceived)
    and updates transaction status accordingly.

    Configuration:
        - interval_seconds: Poll interval (default: 12 = ~1 block time)
        - blocks_per_query: Max blocks to query per iteration (default: 100)
        - confirmations: Blocks to wait before considering confirmed (default: 1)
    """

    # Safe event signatures
    EXECUTION_SUCCESS_TOPIC = (
        "0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e"
    )
    EXECUTION_FAILURE_TOPIC = (
        "0x23428b18acfb3ea64b08dc0c1d296ea9c09702c09083ca5272e64d115b687d23"
    )
    SAFE_RECEIVED_TOPIC = (
        "0x3d0ce9bfc3ed7d6862dbb28b2dea94561fe714a1b4d019aa8af39730d1ad7c3d"
    )

    def __init__(
        self,
        session_factory,
        get_adapter,
        interval_seconds: float = 12.0,
        blocks_per_query: int = 100,
        confirmations: int = 1,
    ):
        """Initialize the event worker.

        Args:
            session_factory: Async session factory for database access
            get_adapter: Callable to get EVM adapter instance
            interval_seconds: Poll interval in seconds
            blocks_per_query: Maximum blocks to query per iteration
            confirmations: Blocks to wait for confirmation
        """
        super().__init__(
            interval_seconds=interval_seconds,
            name="EVMEventWorker",
        )
        self._session_factory = session_factory
        self._get_adapter = get_adapter
        self._blocks_per_query = blocks_per_query
        self._confirmations = confirmations
        self._last_block: int | None = None

    async def on_start(self) -> None:
        """Initialize last processed block."""
        # In production, this would be loaded from database
        # to resume from where we left off
        adapter = self._get_adapter()
        if adapter and hasattr(adapter, "_client"):
            try:
                # Would get current block from chain
                self._last_block = None  # Start from current
            except Exception as e:
                logger.warning(f"Could not get initial block: {e}")

    async def execute(self) -> None:
        """Poll for new Safe events."""
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload
        from sqlalchemy.orm import selectinload
        from sqlalchemy.orm import selectinload

        from multivault.models.signer import ChainType
        from multivault.models.wallet import Wallet, WalletStatus

        adapter = self._get_adapter()
        if not adapter:
            logger.debug("EVM adapter not available for event polling")
            return

        async with self._session_factory() as session:
            # Get all active EVM wallets with addresses
            stmt = select(Wallet).where(
                Wallet.chain_type == ChainType.EVM,
                Wallet.status == WalletStatus.ACTIVE,
                Wallet.address.isnot(None),
                Wallet.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            wallets = list(result.scalars().all())

            if not wallets:
                return

            # Get current block
            try:
                current_block = await self._get_current_block(adapter)
            except Exception as e:
                logger.error(f"Failed to get current block: {e}")
                return

            # Calculate block range to query
            if self._last_block is None:
                # First run: start from recent blocks only
                from_block = max(0, current_block - self._blocks_per_query)
            else:
                from_block = self._last_block + 1

            # Don't query beyond confirmed blocks
            to_block = min(
                current_block - self._confirmations,
                from_block + self._blocks_per_query - 1,
            )

            if to_block < from_block:
                return  # No new confirmed blocks

            # Query events for all wallet addresses
            addresses = [w.address for w in wallets]
            address_to_wallet = {w.address.lower(): w for w in wallets}

            try:
                events = await self._get_events(adapter, addresses, from_block, to_block)
                await self._process_events(session, events, address_to_wallet)
                self._last_block = to_block

                if events:
                    logger.info(f"Processed {len(events)} Safe events from blocks {from_block}-{to_block}")
            except Exception as e:
                logger.error(f"Event query failed: {e}")

    async def _get_current_block(self, adapter) -> int:
        """Get current block number from chain.

        Args:
            adapter: EVM adapter instance

        Returns:
            Current block number
        """
        # In production, this would call adapter._client.get_block_number()
        # For now, return a mock value
        return 0

    async def _get_events(
        self,
        adapter,
        addresses: list[str],
        from_block: int,
        to_block: int,
    ) -> list[dict]:
        """Get Safe events for addresses in block range.

        Args:
            adapter: EVM adapter instance
            addresses: List of Safe addresses to query
            from_block: Start block (inclusive)
            to_block: End block (inclusive)

        Returns:
            List of event dictionaries
        """
        # In production, this would use adapter._client.get_logs()
        # to query for ExecutionSuccess and other Safe events
        return []

    async def _process_events(
        self,
        session,
        events: list[dict],
        address_to_wallet: dict,
    ) -> None:
        """Process Safe events and update transaction status.

        Args:
            session: Database session
            events: List of event dictionaries
            address_to_wallet: Mapping from address to wallet
        """
        from multivault.models.transaction import Transaction, TransactionStatus
        from multivault.services.transaction_service import TransactionService

        service = TransactionService(session)

        for event in events:
            try:
                # Extract event data
                address = event.get("address", "").lower()
                tx_hash = event.get("transactionHash", "")
                block_number = event.get("blockNumber", 0)
                topic0 = event.get("topics", [None])[0]

                if not address or address not in address_to_wallet:
                    continue

                wallet = address_to_wallet[address]

                if topic0 == self.EXECUTION_SUCCESS_TOPIC:
                    await self._handle_execution_success(
                        service, wallet, tx_hash, block_number
                    )
                elif topic0 == self.EXECUTION_FAILURE_TOPIC:
                    await self._handle_execution_failure(
                        service, wallet, tx_hash, block_number
                    )
                elif topic0 == self.SAFE_RECEIVED_TOPIC:
                    # Could log incoming transfers
                    logger.debug(f"SafeReceived event for {address}")

            except Exception as e:
                logger.error(f"Error processing event: {e}")

    async def _handle_execution_success(
        self,
        service,
        wallet,
        tx_hash: str,
        block_number: int,
    ) -> None:
        """Handle ExecutionSuccess event.

        Args:
            service: Transaction service
            wallet: Wallet model
            tx_hash: Transaction hash
            block_number: Block number
        """
        # Find transaction by tx_hash and confirm it
        tx = await service.get_transaction_by_hash(tx_hash)
        if tx and tx.wallet_id == wallet.id:
            await service.confirm_on_chain(
                tx.id,
                block_number=block_number,
            )
            logger.info(f"Transaction {tx.id} confirmed at block {block_number}")

    async def _handle_execution_failure(
        self,
        service,
        wallet,
        tx_hash: str,
        block_number: int,
    ) -> None:
        """Handle ExecutionFailure event.

        Args:
            service: Transaction service
            wallet: Wallet model
            tx_hash: Transaction hash
            block_number: Block number
        """
        # Find transaction by tx_hash and mark as failed
        tx = await service.get_transaction_by_hash(tx_hash)
        if tx and tx.wallet_id == wallet.id:
            await service.fail_transaction(
                tx.id,
                error=f"Execution failed on chain at block {block_number}",
            )
            logger.warning(f"Transaction {tx.id} failed at block {block_number}")


class BTCConfirmationWorker(BaseWorker):
    """Worker that monitors Bitcoin transaction confirmations.

    Polls for confirmations of broadcast Bitcoin transactions
    and updates their status when confirmed.

    Configuration:
        - interval_seconds: Poll interval (default: 60)
        - required_confirmations: Confirmations needed (default: 1)
    """

    def __init__(
        self,
        session_factory,
        get_adapter: Callable[[str | None], object | None],
        interval_seconds: float = 60.0,
        required_confirmations: int = 1,
    ):
        """Initialize the confirmation worker.

        Args:
            session_factory: Async session factory for database access
            get_adapter: Callable to get Bitcoin adapter
            interval_seconds: Poll interval in seconds
            required_confirmations: Required confirmations
        """
        super().__init__(
            interval_seconds=interval_seconds,
            name="BTCConfirmationWorker",
        )
        self._session_factory = session_factory
        self._get_adapter = get_adapter
        self._required_confirmations = required_confirmations
        self._adapters: dict[str, object] = {}

    async def on_start(self) -> None:
        """No-op.

        Adapters are selected per-tx based on wallet.network_id and
        connected on-demand.
        """
        return

    async def on_stop(self) -> None:
        """Disconnect all cached Bitcoin adapters on worker stop."""
        for network_id, adapter in list(self._adapters.items()):
            try:
                if getattr(adapter, "is_connected", False):
                    await adapter.disconnect()
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "bitcoin_adapter_disconnect_failed",
                    network_id=network_id,
                    error=str(e),
                )

    async def execute(self) -> None:
        """Check for transaction confirmations."""
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from multivault.models.signer import ChainType
        from multivault.models.transaction import Transaction, TransactionStatus
        from multivault.models.wallet import Wallet
        from multivault.services.transaction_service import TransactionService
        from multivault.chains.bitcoin.electrum import ElectrumConnectionError

        async with self._session_factory() as session:
            # Get broadcast BTC transactions awaiting confirmation
            stmt = (
                select(Transaction)
                .join(Wallet)
                .options(selectinload(Transaction.wallet))
                .where(
                    Wallet.chain_type == ChainType.BTC,
                    Transaction.status == TransactionStatus.BROADCAST,
                    Transaction.tx_hash.isnot(None),
                    Transaction.deleted_at.is_(None),
                )
            )
            result = await session.execute(stmt)
            transactions = list(result.scalars().all())

            if not transactions:
                return
            service = TransactionService(session)

            for tx in transactions:
                try:
                    wallet = tx.wallet
                    network_id = getattr(wallet, "network_id", None) if wallet else None
                    address = getattr(wallet, "address", None) if wallet else None

                    if not network_id:
                        logger.warning(
                            "btc_confirmation_missing_network",
                            tx_id=str(tx.id),
                            wallet_id=str(tx.wallet_id),
                        )
                        continue

                    adapter = self._adapters.get(network_id)
                    if not adapter:
                        adapter = self._get_adapter(network_id)
                        if not adapter:
                            logger.warning(
                                "btc_adapter_unavailable",
                                tx_id=str(tx.id),
                                wallet_id=str(tx.wallet_id),
                                network_id=network_id,
                            )
                            continue
                        self._adapters[network_id] = adapter

                    if not getattr(adapter, "is_connected", False):
                        try:
                            await adapter.connect()
                        except Exception as e:
                            logger.warning(
                                "bitcoin_adapter_connection_failed",
                                network_id=network_id,
                                error=str(e),
                            )
                            self._adapters.pop(network_id, None)
                            continue

                    confirmations, block_height = await self._get_confirmations(
                        adapter,
                        tx.tx_hash,
                        address,
                    )

                    if confirmations >= self._required_confirmations:
                        await service.confirm_on_chain(
                            tx.id,
                            block_number=block_height or 0,
                        )
                        logger.info(f"BTC transaction {tx.id} confirmed with {confirmations} confirmations")

                except Exception as e:
                    if self._is_connection_error(e, ElectrumConnectionError):
                        wallet = tx.wallet
                        network_id = getattr(wallet, "network_id", None) if wallet else None
                        logger.warning(
                            "bitcoin_adapter_connection_lost",
                            tx_id=str(tx.id),
                            error=str(e),
                        )
                        if not network_id:
                            logger.error(f"Confirmation check failed for tx {tx.id}: {e}")
                            continue

                        adapter = self._adapters.get(network_id)
                        if not adapter:
                            adapter = self._get_adapter(network_id)
                            if not adapter:
                                logger.error(f"Confirmation check failed for tx {tx.id}: {e}")
                                continue
                            self._adapters[network_id] = adapter

                        reconnected = await self._reconnect_adapter(adapter)
                        if not reconnected:
                            self._adapters.pop(network_id, None)
                            logger.error(f"Confirmation check failed for tx {tx.id}: {e}")
                            continue
                        try:
                            confirmations, block_height = await self._get_confirmations(
                                adapter,
                                tx.tx_hash,
                                getattr(tx.wallet, "address", None) if tx.wallet else None,
                            )
                            if confirmations >= self._required_confirmations:
                                await service.confirm_on_chain(
                                    tx.id,
                                    block_number=block_height or 0,
                                )
                                logger.info(
                                    f"BTC transaction {tx.id} confirmed with {confirmations} confirmations"
                                )
                        except Exception as retry_error:
                            logger.error(
                                f"Confirmation check failed for tx {tx.id}: {retry_error}"
                            )
                    else:
                        logger.error(f"Confirmation check failed for tx {tx.id}: {e}")

    @staticmethod
    def _is_connection_error(
        error: Exception,
        electrum_error_type: type[Exception],
    ) -> bool:
        message = str(error)
        return isinstance(
            error,
            (
                ConnectionError,
                OSError,
                electrum_error_type,
            ),
        ) or any(
            hint in message
            for hint in (
                "SSL connection is closed",
                "Connection lost",
                "Connection closed",
            )
        )

    async def _reconnect_adapter(self, adapter) -> bool:
        try:
            if adapter.is_connected:
                await adapter.disconnect()
        except Exception as e:
            logger.debug("bitcoin_adapter_disconnect_failed", error=str(e))

        try:
            await adapter.connect()
            return True
        except Exception as e:
            logger.warning("bitcoin_adapter_reconnect_failed", error=str(e))
            return False

    async def _get_confirmations(
        self,
        adapter,
        tx_hash: str,
        address: str | None,
    ) -> tuple[int, int | None]:
        """Get confirmation count for a transaction.

        Args:
            adapter: Bitcoin adapter
            tx_hash: Transaction hash

        Returns:
            Tuple of (confirmations, block_height)
        """
        # get_transaction returns raw hex (many Electrum servers don't support verbose)
        # Use address history to get confirmation data
        if not address:
            logger.warning(
                "btc_confirmation_no_address",
                tx_hash=tx_hash,
            )
            return 0, None
        
        history = await adapter.get_history(address)
        matched = next((item for item in history if item.txid == tx_hash), None)
        
        if not matched:
            logger.debug(
                "btc_confirmation_not_in_history",
                tx_hash=tx_hash,
                address=address,
                network=getattr(getattr(adapter, "network", None), "value", None),
            )
            return 0, None
        
        if matched.height <= 0:
            # Unconfirmed transaction
            return 0, None
        
        tip_height, _ = await adapter.get_blockchain_tip()
        if tip_height < matched.height:
            return 0, matched.height
        
        confirmations = tip_height - matched.height + 1
        logger.info(
            "btc_confirmation_found",
            tx_hash=tx_hash,
            confirmations=confirmations,
            block_height=matched.height,
            tip_height=tip_height,
        )
        return confirmations, matched.height
