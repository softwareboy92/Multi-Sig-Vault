"""Unit tests for event workers."""

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from multivault.models.transaction import Transaction, TransactionStatus, TransactionType
from multivault.models.wallet import Wallet
from multivault.models.network import NetworkConfig
from multivault.models.signer import ChainType
from multivault.workers.events import (
    BTCConfirmationWorker,
    EVMEventWorker,
)


class TestEVMEventWorker:
    """Tests for EVMEventWorker."""

    @pytest.mark.asyncio
    async def test_init(self):
        """Test EVMEventWorker initialization."""
        session_factory = AsyncMock()
        get_adapter = MagicMock()

        worker = EVMEventWorker(
            session_factory=session_factory,
            get_adapter=get_adapter,
            interval_seconds=15.0,
        )

        assert worker.name == "EVMEventWorker"
        assert worker.interval == 15.0
        assert worker._get_adapter == get_adapter

    @pytest.mark.asyncio
    async def test_execute_fetches_events(self, async_session):
        """Test execute fetches and processes Safe events."""
        @asynccontextmanager
        async def session_factory():
            yield async_session

        evm_adapter = MagicMock()
        evm_adapter.get_logs = AsyncMock(return_value=[
            {
                "address": "0xsafe123",
                "topics": [EVMEventWorker.EXECUTION_SUCCESS_TOPIC, "0xtxhash"],
                "blockNumber": "0x1234",
                "transactionHash": "0xabcdef",
            }
        ])
        evm_adapter.get_block_number = AsyncMock(return_value=5000)

        worker = EVMEventWorker(
            session_factory=session_factory,
            get_adapter=lambda: evm_adapter,
        )

        await worker.execute()

    @pytest.mark.asyncio
    async def test_execute_handles_no_events(self, async_session):
        """Test processing when no events found."""
        @asynccontextmanager
        async def session_factory():
            yield async_session

        evm_adapter = MagicMock()
        evm_adapter.get_logs = AsyncMock(return_value=[])
        evm_adapter.get_block_number = AsyncMock(return_value=5000)

        worker = EVMEventWorker(
            session_factory=session_factory,
            get_adapter=lambda: evm_adapter,
        )

        await worker.execute()

    @pytest.mark.asyncio
    async def test_topics_are_valid_keccak(self):
        """Test event topic hashes are correct format."""
        # ExecutionSuccess(bytes32 txHash, uint256 payment)
        assert EVMEventWorker.EXECUTION_SUCCESS_TOPIC.startswith("0x")
        assert len(EVMEventWorker.EXECUTION_SUCCESS_TOPIC) == 66  # 0x + 64 hex chars

        # ExecutionFailure(bytes32 txHash, uint256 payment)
        assert EVMEventWorker.EXECUTION_FAILURE_TOPIC.startswith("0x")
        assert len(EVMEventWorker.EXECUTION_FAILURE_TOPIC) == 66

        # SafeReceived(address indexed sender, uint256 value)
        assert EVMEventWorker.SAFE_RECEIVED_TOPIC.startswith("0x")
        assert len(EVMEventWorker.SAFE_RECEIVED_TOPIC) == 66

    @pytest.mark.asyncio
    async def test_execute_with_no_adapter(self, async_session):
        """Test execute handles missing adapter gracefully."""
        @asynccontextmanager
        async def session_factory():
            yield async_session

        worker = EVMEventWorker(
            session_factory=session_factory,
            get_adapter=lambda: None,
        )

        # Should complete without error
        await worker.execute()


class TestBTCConfirmationWorker:
    """Tests for BTCConfirmationWorker."""

    @pytest.fixture
    async def btc_network(self, async_session):
        """Create test BTC network configuration."""
        network = NetworkConfig(
            chain_type="BTC",
            name="Bitcoin Testnet",
            enabled=True,
            extra='{"btc_network": "testnet"}',
        )
        async_session.add(network)
        await async_session.commit()
        await async_session.refresh(network)
        return network

    @pytest.mark.asyncio
    async def test_init(self):
        """Test BTCConfirmationWorker initialization."""
        session_factory = AsyncMock()
        get_adapter = MagicMock()

        worker = BTCConfirmationWorker(
            session_factory=session_factory,
            get_adapter=get_adapter,
            required_confirmations=6,
            interval_seconds=60.0,
        )

        assert worker.name == "BTCConfirmationWorker"
        assert worker.interval == 60.0
        assert worker._required_confirmations == 6

    @pytest.mark.asyncio
    async def test_execute_checks_confirmations(self, async_session, btc_network):
        """Test execute checks confirmations for broadcast transactions."""
        # Create test wallet first
        wallet = Wallet(
            name="Test Wallet",
            chain_type=ChainType.BTC,
            threshold=2,
            signer_count=3,
            network_id=btc_network.id,
        )
        async_session.add(wallet)
        await async_session.commit()
        
        # Create broadcast transaction
        tx = Transaction(
            wallet_id=wallet.id,
            tx_type=TransactionType.TRANSFER,
            status=TransactionStatus.BROADCAST,
            to_address="bc1qtest123",
            amount=Decimal("0.1"),
            payload="cHNidP8...",
            threshold=2,
            tx_hash="abc123",
        )
        async_session.add(tx)
        await async_session.commit()

        @asynccontextmanager
        async def session_factory():
            yield async_session

        btc_adapter = MagicMock()

        worker = BTCConfirmationWorker(
            session_factory=session_factory,
            get_adapter=lambda _network_id: btc_adapter,
            required_confirmations=6,
        )

        await worker.execute()

    @pytest.mark.asyncio
    async def test_execute_with_no_transactions(self, async_session):
        """Test execute handles no broadcast transactions."""
        @asynccontextmanager
        async def session_factory():
            yield async_session

        btc_adapter = MagicMock()

        worker = BTCConfirmationWorker(
            session_factory=session_factory,
            get_adapter=lambda _network_id: btc_adapter,
        )

        # Should complete without error
        await worker.execute()

    @pytest.mark.asyncio
    async def test_execute_with_no_adapter(self, async_session):
        """Test execute handles missing adapter gracefully."""
        @asynccontextmanager
        async def session_factory():
            yield async_session

        worker = BTCConfirmationWorker(
            session_factory=session_factory,
            get_adapter=lambda _network_id: None,
        )

        # Should complete without error
        await worker.execute()

    @pytest.mark.asyncio
    async def test_default_confirmations(self):
        """Test default confirmation requirement."""
        session_factory = AsyncMock()
        get_adapter = MagicMock()

        worker = BTCConfirmationWorker(
            session_factory=session_factory,
            get_adapter=get_adapter,
        )

        # Default should be 1 confirmation
        assert worker._required_confirmations == 1
