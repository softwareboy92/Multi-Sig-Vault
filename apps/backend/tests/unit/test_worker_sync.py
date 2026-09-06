"""Unit tests for sync workers."""

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from multivault.workers.sync import (
    BalanceSyncWorker,
    HealthCheckWorker,
    UTXOSyncWorker,
)


class TestUTXOSyncWorker:
    """Tests for UTXOSyncWorker."""

    @pytest.mark.asyncio
    async def test_init(self):
        """Test UTXOSyncWorker initialization."""
        session_factory = AsyncMock()
        get_adapter = MagicMock()

        worker = UTXOSyncWorker(
            session_factory=session_factory,
            get_adapter=get_adapter,
            interval_seconds=60.0,
        )

        assert worker.name == "UTXOSyncWorker"
        assert worker.interval == 60.0
        assert worker._get_adapter == get_adapter

    @pytest.mark.asyncio
    async def test_execute_syncs_utxos(self, async_session):
        """Test execute syncs UTXOs for BTC wallets."""
        @asynccontextmanager
        async def session_factory():
            yield async_session

        # Mock BTC adapter
        btc_adapter = MagicMock()
        btc_adapter.list_utxos = AsyncMock(return_value=[
            {
                "txid": "abc123",
                "vout": 0,
                "value": 100000,
                "confirmations": 6,
            }
        ])

        worker = UTXOSyncWorker(
            session_factory=session_factory,
            get_adapter=lambda nid=None: btc_adapter,
        )

        # Execute should not raise
        await worker.execute()

    @pytest.mark.asyncio
    async def test_execute_handles_no_adapter(self, async_session):
        """Test execute handles missing adapter gracefully."""
        @asynccontextmanager
        async def session_factory():
            yield async_session

        def get_adapter():
            return None  # No adapter available

        worker = UTXOSyncWorker(
            session_factory=session_factory,
            get_adapter=get_adapter,
        )

        # Should complete without error when adapter not available
        await worker.execute()

    @pytest.mark.asyncio
    async def test_execute_with_no_wallets(self, async_session):
        """Test execute handles no wallets gracefully."""
        @asynccontextmanager
        async def session_factory():
            yield async_session
        
        btc_adapter = MagicMock()

        worker = UTXOSyncWorker(
            session_factory=session_factory,
            get_adapter=lambda nid=None: btc_adapter,
        )

        # Should complete without error when no wallets exist
        await worker.execute()


class TestBalanceSyncWorker:
    """Tests for BalanceSyncWorker."""

    @pytest.mark.asyncio
    async def test_init(self):
        """Test BalanceSyncWorker initialization."""
        session_factory = AsyncMock()

        worker = BalanceSyncWorker(
            session_factory=session_factory,
            rpc_url="http://localhost:8545",
            interval_seconds=120.0,
        )

        assert worker.name == "BalanceSyncWorker"
        assert worker.interval == 120.0
        assert worker._rpc_url == "http://localhost:8545"

    @pytest.mark.asyncio
    async def test_execute_without_client(self, async_session):
        """Test execute skips when client is not connected."""
        @asynccontextmanager
        async def session_factory():
            yield async_session

        worker = BalanceSyncWorker(
            session_factory=session_factory,
            rpc_url="http://localhost:8545",
        )
        # Client is None by default (not started)
        await worker.execute()

    @pytest.mark.asyncio
    async def test_execute_with_no_wallets(self, async_session):
        """Test execute handles no wallets gracefully."""
        @asynccontextmanager
        async def session_factory():
            yield async_session

        worker = BalanceSyncWorker(
            session_factory=session_factory,
            rpc_url="http://localhost:8545",
        )
        # Simulate connected client
        worker._client = MagicMock()
        worker._client.is_connected = True

        await worker.execute()


class TestHealthCheckWorker:
    """Tests for HealthCheckWorker."""

    @pytest.mark.asyncio
    async def test_init(self):
        """Test HealthCheckWorker initialization."""
        get_btc = MagicMock()
        get_evm = MagicMock()

        worker = HealthCheckWorker(
            get_btc_adapter=get_btc,
            get_evm_adapter=get_evm,
            interval_seconds=30.0,
        )

        assert worker.name == "HealthCheckWorker"
        assert worker.interval == 30.0
        assert worker._get_btc_adapter == get_btc
        assert worker._get_evm_adapter == get_evm

    @pytest.mark.asyncio
    async def test_execute_checks_endpoints(self):
        """Test execute checks all adapters."""
        btc_adapter = MagicMock()
        btc_adapter.electrum = MagicMock()

        evm_adapter = MagicMock()
        evm_adapter._client = MagicMock()

        worker = HealthCheckWorker(
            get_btc_adapter=lambda nid=None: btc_adapter,
            get_evm_adapter=lambda: evm_adapter,
        )

        await worker.execute()

        # Check results are populated
        results = worker.health_results
        assert "bitcoin" in results
        assert "evm" in results
        assert results["bitcoin"]["status"] == "healthy"
        assert results["evm"]["status"] == "healthy"

    @pytest.mark.asyncio
    async def test_health_results_property(self):
        """Test getting health results."""
        worker = HealthCheckWorker()

        # Initially empty
        results = worker.health_results
        assert len(results) == 0

        # After execute with no adapters
        await worker.execute()
        results = worker.health_results
        assert len(results) == 0  # No adapters configured

    @pytest.mark.asyncio
    async def test_handles_adapter_errors(self):
        """Test health check handles adapter errors."""
        def failing_btc_adapter(nid=None):
            raise Exception("BTC connection failed")

        worker = HealthCheckWorker(
            get_btc_adapter=failing_btc_adapter,
        )

        await worker.execute()

        results = worker.health_results
        assert results["bitcoin"]["status"] == "unhealthy"
        assert "BTC connection failed" in results["bitcoin"]["error"]


class TestUTXOSyncImplementation:
    """Tests for the actual _sync_wallet_utxos implementation."""

    @pytest.mark.asyncio
    async def test_sync_writes_utxos_to_wallet_extra(self):
        """After sync, wallet.extra should contain utxos from Electrum."""
        from multivault.chains.bitcoin.electrum import ElectrumUTXO
        from multivault.utils.extra import get_extra

        wallet = MagicMock()
        wallet.id = str(uuid4())
        wallet.address = "bc1qtestaddr"
        wallet.extra = None

        adapter = MagicMock()
        adapter.electrum = AsyncMock()
        adapter.electrum.list_unspent = AsyncMock(return_value=[
            ElectrumUTXO(txid="aaa111", vout=0, value=50000, height=800100),
            ElectrumUTXO(txid="bbb222", vout=1, value=120000, height=0),
        ])

        session = AsyncMock()

        @asynccontextmanager
        async def session_factory():
            yield session

        worker = UTXOSyncWorker(
            session_factory=session_factory,
            get_adapter=lambda: adapter,
        )

        await worker._sync_wallet_utxos(adapter, wallet, session)

        extra = get_extra(wallet)
        assert len(extra["utxos"]) == 2
        assert extra["utxos"][0]["txid"] == "aaa111"
        assert extra["utxos"][0]["value"] == 50000
        assert extra["utxos"][1]["txid"] == "bbb222"
        assert "utxos_synced_at" in extra

    @pytest.mark.asyncio
    async def test_sync_overwrites_existing_utxos(self):
        """Sync should full-overwrite, not merge."""
        from multivault.chains.bitcoin.electrum import ElectrumUTXO
        from multivault.utils.extra import get_extra

        wallet = MagicMock()
        wallet.id = str(uuid4())
        wallet.address = "bc1qtestaddr"
        wallet.extra = '{"witness_script": "5221...", "utxos": [{"txid": "old", "vout": 0, "value": 999, "height": 1}]}'

        adapter = MagicMock()
        adapter.electrum = AsyncMock()
        adapter.electrum.list_unspent = AsyncMock(return_value=[
            ElectrumUTXO(txid="new111", vout=0, value=77777, height=800200),
        ])

        session = AsyncMock()

        @asynccontextmanager
        async def session_factory():
            yield session

        worker = UTXOSyncWorker(
            session_factory=session_factory,
            get_adapter=lambda: adapter,
        )

        await worker._sync_wallet_utxos(adapter, wallet, session)

        extra = get_extra(wallet)
        assert len(extra["utxos"]) == 1
        assert extra["utxos"][0]["txid"] == "new111"
        # Existing non-utxo fields preserved
        assert extra.get("witness_script") == "5221..."


class TestBTCConfirmationCheck:
    """Tests for _check_btc_confirmations in UTXOSyncWorker."""

    @pytest.mark.asyncio
    async def test_confirms_imported_pending_confirmation_tx(self):
        """An externally discovered mempool tx should become CONFIRMED once mined."""
        from multivault.models.transaction import TransactionStatus

        session = AsyncMock()
        tx = MagicMock()
        tx.id = str(uuid4())
        tx.tx_hash = "imported_txhash"
        tx.status = TransactionStatus.PENDING_CONFIRMATION
        tx.created_at = datetime(2026, 2, 10, tzinfo=UTC)

        adapter = MagicMock()
        adapter.electrum = AsyncMock()
        adapter.electrum.get_transaction = AsyncMock(
            return_value={
                "confirmations": 1,
                "blockhash": "blockhash456",
                "blockheight": 800501,
            }
        )

        @asynccontextmanager
        async def session_factory():
            yield session

        worker = UTXOSyncWorker(
            session_factory=session_factory,
            get_adapter=lambda: adapter,
        )

        await worker._check_btc_confirmations(adapter, [tx], session)

        assert tx.status == TransactionStatus.CONFIRMED
        assert tx.block_number == 800501

    @pytest.mark.asyncio
    async def test_confirms_broadcast_tx_with_confirmations(self):
        """BROADCAST tx with confirmation >= 1 should become CONFIRMED."""
        from multivault.models.transaction import TransactionStatus

        session = AsyncMock()
        tx = MagicMock()
        tx.id = str(uuid4())
        tx.tx_hash = "txhash123"
        tx.status = TransactionStatus.BROADCAST
        tx.created_at = datetime(2026, 2, 10, tzinfo=UTC)

        adapter = MagicMock()
        adapter.electrum = AsyncMock()
        adapter.electrum.get_transaction = AsyncMock(return_value={
            "confirmations": 3,
            "blockhash": "blockhash123",
            "blockheight": 800500,
        })

        @asynccontextmanager
        async def session_factory():
            yield session

        worker = UTXOSyncWorker(
            session_factory=session_factory,
            get_adapter=lambda: adapter,
        )

        await worker._check_btc_confirmations(adapter, [tx], session)

        assert tx.status == TransactionStatus.CONFIRMED
        assert tx.block_number == 800500

    @pytest.mark.asyncio
    async def test_stale_broadcast_tx_becomes_failed(self):
        """BROADCAST tx older than 72h not found on-chain should FAIL."""
        from multivault.models.transaction import TransactionStatus

        session = AsyncMock()
        tx = MagicMock()
        tx.id = str(uuid4())
        tx.tx_hash = "txhash_stale"
        tx.wallet_id = "wallet_stale"
        tx.status = TransactionStatus.BROADCAST
        tx.created_at = datetime(2026, 2, 10, tzinfo=UTC)  # >72h ago
        tx.updated_at = datetime(2026, 2, 10, tzinfo=UTC)  # broadcast time

        adapter = MagicMock()
        adapter.electrum = AsyncMock()
        # Strategy 1 fails (electrs), strategy 2 finds no history entry
        # → _get_tx_block_height returns None → tx not found on-chain
        from multivault.chains.bitcoin.electrum import ElectrumRPCError
        adapter.electrum.get_transaction = AsyncMock(
            side_effect=ElectrumRPCError(-1, "verbose transactions are currently unsupported"),
        )
        # Return empty history — tx not in address history
        adapter.electrum.get_history = AsyncMock(return_value=[])

        # Provide wallet address for strategy 2 lookup
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = "tb1qfakeaddress"
        session.execute = AsyncMock(return_value=mock_result)

        @asynccontextmanager
        async def session_factory():
            yield session

        worker = UTXOSyncWorker(
            session_factory=session_factory,
            get_adapter=lambda: adapter,
        )

        await worker._check_btc_confirmations(adapter, [tx], session)

        assert tx.status == TransactionStatus.FAILED
        assert "72 hours" in tx.error_message

    @pytest.mark.asyncio
    async def test_mempool_tx_not_marked_failed(self):
        """BROADCAST tx still in mempool should NOT be marked FAILED even after 72h."""
        from multivault.models.transaction import TransactionStatus

        session = AsyncMock()
        tx = MagicMock()
        tx.id = str(uuid4())
        tx.tx_hash = "txhash_mempool"
        tx.status = TransactionStatus.BROADCAST
        tx.created_at = datetime(2026, 2, 10, tzinfo=UTC)
        tx.updated_at = datetime(2026, 2, 10, tzinfo=UTC)

        adapter = MagicMock()
        adapter.electrum = AsyncMock()
        # Strategy 1 returns 0 confirmations — tx is in mempool
        adapter.electrum.get_transaction = AsyncMock(return_value={
            "confirmations": 0,
        })

        @asynccontextmanager
        async def session_factory():
            yield session

        worker = UTXOSyncWorker(
            session_factory=session_factory,
            get_adapter=lambda: adapter,
        )

        await worker._check_btc_confirmations(adapter, [tx], session)

        assert tx.status == TransactionStatus.BROADCAST

    @pytest.mark.asyncio
    async def test_skips_tx_without_hash(self):
        """Transactions without tx_hash should be skipped."""
        from multivault.models.transaction import TransactionStatus

        session = AsyncMock()
        tx = MagicMock()
        tx.id = str(uuid4())
        tx.tx_hash = None
        tx.status = TransactionStatus.BROADCAST

        adapter = MagicMock()
        adapter.electrum = AsyncMock()

        @asynccontextmanager
        async def session_factory():
            yield session

        worker = UTXOSyncWorker(
            session_factory=session_factory,
            get_adapter=lambda: adapter,
        )

        await worker._check_btc_confirmations(adapter, [tx], session)

        # Status unchanged, electrum not called
        assert tx.status == TransactionStatus.BROADCAST
        adapter.electrum.get_transaction.assert_not_called()
