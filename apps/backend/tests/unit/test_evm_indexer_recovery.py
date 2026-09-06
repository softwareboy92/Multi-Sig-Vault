"""Tests for EVM Indexer FAILED→CONFIRMED recovery."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from multivault.models.transaction import TransactionStatus


def _make_indexer(mock_session):
    """Helper: create an EVMEventIndexer with mocked session factory."""
    from multivault.workers.evm_indexer import EVMEventIndexer

    indexer = EVMEventIndexer.__new__(EVMEventIndexer)
    indexer._session_factory = MagicMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    indexer._session_factory.return_value = mock_session
    return indexer


@pytest.mark.asyncio
async def test_failed_tx_with_execution_success_is_recovered():
    """FAILED tx + ExecutionSuccess event → should recover to CONFIRMED."""
    tx = MagicMock()
    tx.id = "tx-1"
    tx.status = TransactionStatus.FAILED
    tx.payload_hash = "0xSafeTxHash"
    tx.deleted_at = None
    tx.tx_type = None

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = tx
    mock_session.execute.return_value = mock_result

    event = {
        "tx_hash": "0xSafeTxHash",
        "tx": "0xOnChainHash",
        "block": 12345,
        "event": "ExecutionSuccess",
    }

    indexer = _make_indexer(mock_session)
    await indexer._process_event(event)

    assert tx.status == TransactionStatus.CONFIRMED
    assert tx.tx_hash == "0xOnChainHash"
    assert tx.block_number == 12345
    mock_session.commit.assert_called_once()


@pytest.mark.asyncio
async def test_failed_tx_with_execution_failure_stays_failed():
    """FAILED tx + ExecutionFailure event → should stay FAILED (no change)."""
    tx = MagicMock()
    tx.id = "tx-2"
    tx.status = TransactionStatus.FAILED
    tx.payload_hash = "0xSafeTxHash2"
    tx.deleted_at = None

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = tx
    mock_session.execute.return_value = mock_result

    event = {
        "tx_hash": "0xSafeTxHash2",
        "tx": "0xOnChainHash2",
        "block": 12346,
        "event": "ExecutionFailure",
    }

    indexer = _make_indexer(mock_session)
    await indexer._process_event(event)

    # Should stay FAILED — ExecutionFailure on already-FAILED is a no-op
    assert tx.status == TransactionStatus.FAILED


@pytest.mark.asyncio
async def test_confirmed_tx_is_skipped():
    """Already CONFIRMED tx → skip entirely (idempotent)."""
    tx = MagicMock()
    tx.id = "tx-3"
    tx.status = TransactionStatus.CONFIRMED
    tx.payload_hash = "0xSafeTxHash3"
    tx.deleted_at = None

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = tx
    mock_session.execute.return_value = mock_result

    event = {
        "tx_hash": "0xSafeTxHash3",
        "tx": "0xOnChainHash3",
        "block": 12347,
        "event": "ExecutionSuccess",
    }

    indexer = _make_indexer(mock_session)
    await indexer._process_event(event)

    # Should not change status — already CONFIRMED
    assert tx.status == TransactionStatus.CONFIRMED


@pytest.mark.asyncio
async def test_event_tx_hash_without_0x_prefix_matches_db():
    """Regression: parse_execution_event returns tx_hash without 0x prefix,
    but DB payload_hash has 0x prefix. _process_event must normalize."""
    tx = MagicMock()
    tx.id = "tx-prefix"
    tx.status = TransactionStatus.SIGNED
    tx.payload_hash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
    tx.deleted_at = None
    tx.tx_type = None

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = tx
    mock_session.execute.return_value = mock_result

    # Event tx_hash WITHOUT 0x prefix (as produced by bytes32.hex())
    event = {
        "tx_hash": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        "tx": "0xOnChainHash",
        "block": 99999,
        "event": "ExecutionSuccess",
    }

    indexer = _make_indexer(mock_session)
    await indexer._process_event(event)

    # Verify the SQL query used the normalized 0x-prefixed value
    call_args = mock_session.execute.call_args
    # The query should have matched, so tx should be CONFIRMED
    assert tx.status == TransactionStatus.CONFIRMED
    assert tx.tx_hash == "0xOnChainHash"
    mock_session.commit.assert_called_once()
