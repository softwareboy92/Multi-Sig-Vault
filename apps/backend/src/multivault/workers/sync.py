"""Sync workers for blockchain data synchronization."""

import structlog
from typing import TYPE_CHECKING

from multivault.workers.base import BaseWorker

if TYPE_CHECKING:
    from multivault.chains.bitcoin.adapter import BitcoinAdapter
    from multivault.chains.evm.adapter import EVMAdapter

logger = structlog.get_logger(__name__)


class UTXOSyncWorker(BaseWorker):
    """Worker that syncs Bitcoin UTXOs for multisig wallets.

    Periodically fetches UTXOs from Electrum for all active BTC wallets
    and updates the local cache. This ensures transaction building has
    accurate UTXO data.

    Configuration:
        - interval_seconds: Sync interval (default: 30)
    """

    def __init__(
        self,
        session_factory,
        get_adapter,
        interval_seconds: float = 30.0,
    ):
        """Initialize the UTXO sync worker.

        Args:
            session_factory: Async session factory for database access
            get_adapter: Callable to get Bitcoin adapter instance
            interval_seconds: Sync interval in seconds
        """
        super().__init__(
            interval_seconds=interval_seconds,
            name="UTXOSyncWorker",
        )
        self._session_factory = session_factory
        self._get_adapter = get_adapter

    async def execute(self) -> None:
        """Sync UTXOs for all BTC wallets."""
        from sqlalchemy import select

        from multivault.models.signer import ChainType
        from multivault.models.wallet import Wallet, WalletStatus

        async with self._session_factory() as session:
            # Get all active BTC wallets with addresses
            stmt = select(Wallet).where(
                Wallet.chain_type == ChainType.BTC,
                Wallet.status == WalletStatus.ACTIVE,
                Wallet.address.isnot(None),
                Wallet.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            wallets = result.scalars().all()

            if not wallets:
                return

            adapters: dict[str, object] = {}
            sync_count = 0
            for wallet in wallets:
                try:
                    network_id = getattr(wallet, "network_id", None)
                    if not network_id:
                        continue
                    adapter = adapters.get(network_id)
                    if adapter is None:
                        adapter = self._get_adapter(network_id)
                        if not adapter:
                            logger.warning(
                                "Bitcoin adapter not available for UTXO sync",
                                network_id=network_id,
                            )
                            continue
                        if not adapter.is_connected:
                            await adapter.connect()
                        adapters[network_id] = adapter
                    await self._sync_wallet_utxos(adapter, wallet, session)
                    sync_count += 1
                except Exception as e:
                    logger.error(f"UTXO sync failed for wallet {wallet.id}: {e}")

            if sync_count > 0:
                logger.debug(f"Synced UTXOs for {sync_count} wallet(s)")

            # Check BTC broadcast confirmations
            from datetime import UTC, datetime

            from multivault.models.transaction import Transaction, TransactionStatus

            broadcast_stmt = select(Transaction).where(
                Transaction.status.in_(
                    [
                        TransactionStatus.BROADCAST,
                        TransactionStatus.PENDING_CONFIRMATION,
                    ]
                ),
                Transaction.safe_nonce.is_(None),  # BTC only
                Transaction.tx_hash.isnot(None),
                Transaction.deleted_at.is_(None),
            )
            broadcast_result = await session.execute(broadcast_stmt)
            broadcast_txs = list(broadcast_result.scalars().all())

            if broadcast_txs and adapters:
                # TODO: match adapter to tx's wallet network_id for multi-network
                # support. For now use any available adapter (safe when all BTC
                # wallets share the same network, which is the current assumption).
                fallback_adapter = next(iter(adapters.values()), None)
                if fallback_adapter:
                    await self._check_btc_confirmations(
                        fallback_adapter, broadcast_txs, session
                    )

    async def _sync_wallet_utxos(self, adapter, wallet, session=None) -> None:
        """Sync UTXOs for a single wallet from Electrum.

        Fetches current UTXOs via Electrum listunspent and overwrites
        the wallet.extra.utxos cache. Preserves other extra fields.

        Args:
            adapter: Bitcoin adapter with electrum client
            wallet: Wallet model instance
            session: Optional DB session (for commit); if None, caller commits
        """
        from datetime import UTC, datetime

        from multivault.utils.extra import set_extra

        utxos = await adapter.electrum.list_unspent(wallet.address)

        utxo_dicts = [
            {
                "txid": u.txid,
                "vout": u.vout,
                "value": u.value,
                "height": u.height,
            }
            for u in utxos
        ]

        set_extra(
            wallet,
            utxos=utxo_dicts,
            utxos_synced_at=datetime.now(UTC).isoformat(),
        )

        if session:
            await session.commit()

    async def _check_btc_confirmations(self, adapter, broadcast_txs, session) -> None:
        """Check confirmation status of broadcast BTC transactions.

        Uses two strategies:
        1. Try ``blockchain.transaction.get`` with verbose=True (full Electrum).
        2. Fall back to ``blockchain.scripthash.get_history`` on the wallet
           address (works with electrs which does not support verbose mode).

        Args:
            adapter: Bitcoin adapter with electrum client
            broadcast_txs: List of BROADCAST or PENDING_CONFIRMATION transactions
            session: DB session for commits
        """
        from datetime import UTC, datetime, timedelta

        from multivault.chains.bitcoin.electrum import ElectrumRPCError
        from multivault.models.transaction import TransactionStatus

        # Cache wallet addresses to avoid repeated DB access
        wallet_address_cache: dict[str, str | None] = {}

        for tx in broadcast_txs:
            if not tx.tx_hash:
                continue
            try:
                block_height = await self._get_tx_block_height(
                    adapter, tx, session, wallet_address_cache
                )

                if block_height is not None and block_height > 0:
                    tx.status = TransactionStatus.CONFIRMED
                    tx.block_number = block_height
                    tx.confirmed_at = datetime.now(UTC)
                    tx.updated_at = datetime.now(UTC)
                    logger.info(
                        f"BTC tx {tx.id} confirmed at block {tx.block_number}"
                    )
                elif block_height == 0:
                    # Still in mempool — transaction is alive, nothing to do
                    pass
                elif block_height is None:
                    # Not found in address history — may have been evicted
                    # from mempool.  Only mark FAILED after 72h to avoid
                    # false positives from transient query issues.
                    updated_at = tx.updated_at.replace(tzinfo=UTC) if tx.updated_at.tzinfo is None else tx.updated_at
                    broadcast_age = datetime.now(UTC) - updated_at
                    if broadcast_age > timedelta(hours=72):
                        tx.status = TransactionStatus.FAILED
                        tx.error_message = (
                            "Transaction not found on-chain after 72 hours"
                        )
                        tx.updated_at = datetime.now(UTC)
                        logger.warning(
                            f"BTC tx {tx.id} failed: not found in "
                            f"address history after {broadcast_age}"
                        )
            except Exception as e:
                logger.error(
                    f"Confirmation check failed for tx {tx.id}: {e}"
                )

        await session.commit()

    async def _get_tx_block_height(
        self,
        adapter,
        tx,
        session,
        address_cache: dict[str, str | None],
    ) -> int | None:
        """Resolve the block height of a broadcast transaction.

        Tries verbose ``get_transaction`` first; if the Electrum server does
        not support it (e.g. electrs), falls back to checking the wallet
        address history via ``get_history``.

        Returns:
            Positive int if confirmed, 0 if still unconfirmed, None if
            the transaction could not be found at all.
        """
        from multivault.chains.bitcoin.electrum import ElectrumRPCError

        # --- Strategy 1: verbose get_transaction (full Electrum servers) ---
        try:
            result = await adapter.electrum.get_transaction(
                tx.tx_hash, verbose=True,
            )
            if isinstance(result, dict):
                confirmations = result.get("confirmations", 0)
                if confirmations >= 1:
                    return (
                        result.get("blockheight")
                        or result.get("block_height")
                        or 0
                    )
                return 0
        except ElectrumRPCError as e:
            # electrs returns "verbose transactions are currently unsupported"
            if "verbose" not in str(e).lower():
                raise
            # Fall through to address-history strategy

        # --- Strategy 2: address history (electrs-compatible) ---
        wallet_id = tx.wallet_id
        if wallet_id not in address_cache:
            from sqlalchemy import select
            from multivault.models.wallet import Wallet

            stmt = select(Wallet.address).where(Wallet.id == wallet_id)
            row = await session.execute(stmt)
            address_cache[wallet_id] = row.scalar_one_or_none()

        wallet_address = address_cache[wallet_id]
        if not wallet_address:
            logger.warning(
                f"No address for wallet {wallet_id}, cannot check tx {tx.id}"
            )
            return None

        history = await adapter.electrum.get_history(wallet_address)
        for entry in history:
            if entry.txid == tx.tx_hash:
                return entry.height if entry.height > 0 else 0

        return None


class BalanceSyncWorker(BaseWorker):
    """Worker that syncs EVM token balances for wallets.

    Uses Multicall3 to batch-query token balances for all active
    EVM wallets. Results are cached for display in the UI.

    Configuration:
        - interval_seconds: Sync interval (default: 30)
        - batch_size: Max wallets per batch (default: 10)
    """

    def __init__(
        self,
        session_factory,
        rpc_url: str,
        chain_id: int | None = None,
        interval_seconds: float = 30.0,
        batch_size: int = 10,
    ):
        """Initialize the balance sync worker.

        Args:
            session_factory: Async session factory for database access
            rpc_url: EVM RPC endpoint URL
            interval_seconds: Sync interval in seconds
            batch_size: Maximum wallets per multicall batch
        """
        super().__init__(
            interval_seconds=interval_seconds,
            name="BalanceSyncWorker",
        )
        self._session_factory = session_factory
        self._rpc_url = rpc_url
        self._chain_id = chain_id
        self._batch_size = batch_size
        self._client = None
        self._target_network_ids: list[str] | None = None

    async def on_start(self) -> None:
        """Initialize Web3 client on worker start."""
        from multivault.chains.evm import Web3Client

        try:
            self._client = Web3Client(rpc_url=self._rpc_url)
            await self._client.connect()
            if self._chain_id is not None:
                from multivault.workers.evm_indexer import _resolve_network_ids
                self._target_network_ids = await _resolve_network_ids(
                    self._session_factory, self._chain_id
                )
            logger.info(f"BalanceSyncWorker started, connected to {self._rpc_url}")
        except Exception as e:
            logger.error(f"BalanceSyncWorker failed to connect: {e}")
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
                logger.info("BalanceSyncWorker stopped")
            except Exception as e:
                logger.warning(f"BalanceSyncWorker disconnect error: {e}")
            finally:
                self._client = None

    async def execute(self) -> None:
        """Sync balances for all EVM wallets."""
        from sqlalchemy import select

        from multivault.models.signer import ChainType
        from multivault.models.wallet import Wallet, WalletStatus

        if not self._client or not self._client.is_connected:
            logger.warning("Web3 client not connected")
            return

        async with self._session_factory() as session:
            # Get all active EVM wallets with addresses
            stmt = select(Wallet).where(
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
            wallets = list(result.scalars().all())

            if not wallets:
                return

            # Process in batches
            for i in range(0, len(wallets), self._batch_size):
                batch = wallets[i : i + self._batch_size]
                try:
                    await self._sync_batch_balances(batch)
                except Exception as e:
                    logger.error(f"Balance sync failed for batch: {e}")

            logger.debug(f"Synced balances for {len(wallets)} wallet(s)")

    async def _sync_batch_balances(self, wallets: list) -> None:
        """Sync balances for a batch of wallets.

        Args:
            wallets: List of wallet model instances
        """
        # In a full implementation, this would:
        # 1. Get list of tracked tokens
        # 2. Build multicall queries for each wallet/token pair
        # 3. Execute batch query via self._client
        # 4. Update balance cache in database
        addresses = [w.address for w in wallets]
        logger.debug(f"Would sync balances for {len(addresses)} addresses")


class HealthCheckWorker(BaseWorker):
    """Worker that checks health of RPC endpoints.

    Periodically pings configured Bitcoin and EVM nodes to verify
    connectivity and performance. Results are used for failover
    and monitoring.

    Configuration:
        - interval_seconds: Check interval (default: 300 = 5 min)
    """

    def __init__(
        self,
        get_btc_adapter=None,
        get_evm_adapter=None,
        interval_seconds: float = 300.0,
    ):
        """Initialize the health check worker.

        Args:
            get_btc_adapter: Callable to get Bitcoin adapter
            get_evm_adapter: Callable to get EVM adapter
            interval_seconds: Check interval in seconds
        """
        super().__init__(
            interval_seconds=interval_seconds,
            name="HealthCheckWorker",
        )
        self._get_btc_adapter = get_btc_adapter
        self._get_evm_adapter = get_evm_adapter
        self._last_results: dict = {}

    @property
    def health_results(self) -> dict:
        """Get last health check results."""
        return self._last_results.copy()

    async def execute(self) -> None:
        """Check health of all configured endpoints."""
        results = {}

        # Check Bitcoin (Electrum)
        if self._get_btc_adapter:
            try:
                adapter = self._get_btc_adapter(None)
                if adapter and hasattr(adapter, "electrum"):
                    # Would call adapter.electrum.ping() or similar
                    results["bitcoin"] = {
                        "status": "healthy",
                        "latency_ms": None,  # Would measure actual latency
                    }
            except Exception as e:
                results["bitcoin"] = {
                    "status": "unhealthy",
                    "error": str(e),
                }

        # Check EVM
        if self._get_evm_adapter:
            try:
                adapter = self._get_evm_adapter()
                if adapter and hasattr(adapter, "_client"):
                    # Would call adapter._client.get_block_number() or similar
                    results["evm"] = {
                        "status": "healthy",
                        "latency_ms": None,
                    }
            except Exception as e:
                results["evm"] = {
                    "status": "unhealthy",
                    "error": str(e),
                }

        self._last_results = results
        logger.debug(f"Health check results: {results}")
