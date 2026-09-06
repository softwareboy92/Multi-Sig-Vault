"""Unit tests for EVM event indexer worker."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from multivault.models.transaction import TransactionStatus, TransactionType
from multivault.workers.evm_indexer import EVMEventIndexer, EVMBlockConfirmationWorker


class TestEVMEventIndexer:
    """Tests for EVMEventIndexer."""

    @pytest.fixture
    def mock_session_factory(self):
        """Create a mock session factory."""
        session = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)
        
        factory = MagicMock(return_value=session)
        return factory

    @pytest.fixture
    def indexer(self, mock_session_factory):
        """Create an EVMEventIndexer instance."""
        return EVMEventIndexer(
            session_factory=mock_session_factory,
            rpc_url="https://rpc.example.com",
            interval_seconds=15.0,
            block_range=100,
        )

    def test_init(self, indexer):
        """Test indexer initialization."""
        assert indexer.name == "EVMEventIndexer"
        assert indexer.interval == 15.0
        assert indexer._block_range == 100
        assert indexer._last_processed_block is None

    def test_init_with_start_block(self, mock_session_factory):
        """Test indexer with explicit start block."""
        indexer = EVMEventIndexer(
            session_factory=mock_session_factory,
            rpc_url="https://rpc.example.com",
            start_block=1000,
        )
        assert indexer._last_processed_block == 1000

    @pytest.mark.asyncio
    async def test_on_stop_disconnects_client(self, indexer):
        """Test that on_stop disconnects the Web3 client."""
        mock_client = AsyncMock()
        indexer._client = mock_client

        await indexer.on_stop()

        mock_client.disconnect.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_no_client(self, indexer):
        """Test execute returns early when client not connected."""
        indexer._client = None
        # Should not raise
        await indexer.execute()

    @pytest.mark.asyncio
    async def test_execute_updates_last_processed_block(self, indexer, mock_session_factory):
        """Test that execute updates last_processed_block."""
        mock_client = AsyncMock()
        mock_client.is_connected = True
        mock_client.get_block_number = AsyncMock(return_value=1000)
        indexer._client = mock_client

        # Mock _get_active_safe_addresses to return empty list
        with patch.object(indexer, "_get_active_safe_addresses", return_value=[]):
            await indexer.execute()

        # Should update to safe_head (current_block - confirmation_blocks)
        expected = 1000 - indexer._confirmation_blocks
        assert indexer._last_processed_block == expected

    @pytest.mark.asyncio
    async def test_get_active_safe_addresses(self, indexer, mock_session_factory):
        """Test getting active safe addresses from database."""
        # Setup mock result
        mock_result = MagicMock()
        mock_result.fetchall.return_value = [
            ("0xSafe1",),
            ("0xSafe2",),
        ]
        
        session = mock_session_factory.return_value
        session.execute = AsyncMock(return_value=mock_result)

        addresses = await indexer._get_active_safe_addresses()

        assert addresses == ["0xSafe1", "0xSafe2"]


class TestEVMBlockConfirmationWorker:
    """Tests for EVMBlockConfirmationWorker."""

    @pytest.fixture
    def mock_session_factory(self):
        """Create a mock session factory."""
        session = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)
        
        factory = MagicMock(return_value=session)
        return factory

    @pytest.fixture
    def worker(self, mock_session_factory):
        """Create a confirmation worker instance."""
        return EVMBlockConfirmationWorker(
            session_factory=mock_session_factory,
            rpc_url="https://rpc.example.com",
            interval_seconds=30.0,
            required_confirmations=3,
        )

    def test_init(self, worker):
        """Test worker initialization."""
        assert worker.name == "EVMBlockConfirmationWorker"
        assert worker.interval == 30.0
        assert worker._required_confirmations == 3

    @pytest.mark.asyncio
    async def test_execute_no_client(self, worker):
        """Test execute returns early when client not connected."""
        worker._client = None
        # Should not raise
        await worker.execute()


class TestPolicyChangePostConfirmation:
    """Tests for policy change post-confirmation hook."""

    @pytest.fixture
    def mock_session_factory(self):
        """Create a mock session factory."""
        session = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=None)

        factory = MagicMock(return_value=session)
        return factory

    @pytest.fixture
    def indexer(self, mock_session_factory):
        """Create an EVMEventIndexer instance."""
        return EVMEventIndexer(
            session_factory=mock_session_factory,
            rpc_url="https://rpc.example.com",
            interval_seconds=15.0,
            block_range=100,
        )

    def _make_mock_tx(self, *, tx_type=TransactionType.SAFE_POLICY_CHANGE):
        """Create a mock transaction."""
        tx = MagicMock()
        tx.id = "tx-policy-123"
        tx.tx_type = tx_type
        tx.wallet_id = "wallet-123"
        tx.status = TransactionStatus.PENDING_SIGN
        tx.payload_hash = "0xSafeTxHash"
        return tx

    @pytest.mark.asyncio
    async def test_policy_change_triggers_wallet_sync(
        self, indexer, mock_session_factory
    ):
        """ExecutionSuccess on SAFE_POLICY_CHANGE triggers _sync_policy_change."""
        mock_tx = self._make_mock_tx()
        session = mock_session_factory.return_value
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_tx
        session.execute = AsyncMock(return_value=mock_result)

        event = {
            "tx_hash": "0xSafeTxHash",
            "tx": "0xOnChainHash",
            "block": 12345,
            "event": "ExecutionSuccess",
        }

        with patch.object(
            indexer, "_sync_policy_change", new_callable=AsyncMock
        ) as mock_sync:
            await indexer._process_event(event)
            mock_sync.assert_called_once_with(session, mock_tx)

    @pytest.mark.asyncio
    async def test_regular_tx_does_not_trigger_sync(
        self, indexer, mock_session_factory
    ):
        """ExecutionSuccess on TRANSFER tx does NOT trigger policy sync."""
        mock_tx = self._make_mock_tx(tx_type=TransactionType.TRANSFER)
        session = mock_session_factory.return_value
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_tx
        session.execute = AsyncMock(return_value=mock_result)

        event = {
            "tx_hash": "0xSafeTxHash",
            "tx": "0xOnChainHash",
            "block": 12345,
            "event": "ExecutionSuccess",
        }

        with patch.object(
            indexer, "_sync_policy_change", new_callable=AsyncMock
        ) as mock_sync:
            await indexer._process_event(event)
            mock_sync.assert_not_called()

    @pytest.mark.asyncio
    async def test_sync_failure_does_not_crash_indexer(
        self, indexer, mock_session_factory
    ):
        """Sync failure is caught and logged, does not crash _process_event."""
        mock_tx = self._make_mock_tx()
        session = mock_session_factory.return_value
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_tx
        session.execute = AsyncMock(return_value=mock_result)

        event = {
            "tx_hash": "0xSafeTxHash",
            "tx": "0xOnChainHash",
            "block": 12345,
            "event": "ExecutionSuccess",
        }

        with patch.object(
            indexer,
            "_sync_policy_change",
            new_callable=AsyncMock,
            side_effect=RuntimeError("RPC down"),
        ):
            # Should not raise — error is caught and logged
            await indexer._process_event(event)

        # Verify tx was still marked confirmed
        assert mock_tx.status == TransactionStatus.CONFIRMED
        session.commit.assert_called()

