"""Tests for Safe transaction cancellation with latest/non-latest nonce logic."""

import pytest
from datetime import datetime, UTC
from unittest.mock import AsyncMock, MagicMock

from multivault.models.transaction import Transaction, TransactionStatus, TransactionType
from multivault.models.wallet import Wallet, WalletStatus
from multivault.utils.extra import get_extra
from multivault.models.signer import ChainType
from multivault.services.transaction_service import TransactionService
from multivault.errors.exceptions import ValidationError


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


@pytest.fixture
def transaction_service(mock_db):
    return TransactionService(db=mock_db)


@pytest.fixture
def safe_wallet():
    wallet = Wallet(
        id="wallet-123",
        name="Test Safe",
        address="0x1234567890123456789012345678901234567890",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=3,
        status=WalletStatus.ACTIVE,
        network_id="evm-network-1",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    return wallet


@pytest.fixture
def non_safe_wallet():
    wallet = Wallet(
        id="wallet-456",
        name="Test EOA",
        address="0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        chain_type=ChainType.EVM,
        threshold=1,
        signer_count=1,
        status=WalletStatus.ACTIVE,
        network_id="evm-network-1",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    return wallet


@pytest.mark.asyncio
async def test_cancel_latest_nonce_offchain(transaction_service, mock_db, safe_wallet):
    """Test offchain cancellation of latest nonce transaction."""
    tx = Transaction(
        id="tx-1",
        wallet_id=safe_wallet.id,
        to_address="0xdead",
        amount="1.0",
        status=TransactionStatus.SIGNED,
        safe_nonce=5,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    
    # Mock get_transaction
    transaction_service.get_transaction = AsyncMock(return_value=tx)
    
    # Mock wallet query
    wallet_result = MagicMock()
    wallet_result.scalar_one.return_value = safe_wallet
    mock_db.execute = AsyncMock(return_value=wallet_result)
    
    # Mock _is_latest_safe_nonce to return True
    transaction_service._is_latest_safe_nonce = AsyncMock(return_value=True)
    
    # Cancel offchain (default)
    result = await transaction_service.cancel_transaction("tx-1", on_chain=False)
    
    assert result.id == "tx-1"
    assert result.status == TransactionStatus.CANCELLED
    assert result.error_message is None
    assert get_extra(result)["cancellation_method"] == "offchain"
    mock_db.commit.assert_called_once()


@pytest.mark.asyncio
async def test_cancel_latest_nonce_onchain(transaction_service, mock_db, safe_wallet):
    """Test onchain cancellation of latest nonce transaction."""
    tx = Transaction(
        id="tx-1",
        wallet_id=safe_wallet.id,
        to_address="0xdead",
        amount="1.0",
        status=TransactionStatus.SIGNED,
        safe_nonce=5,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    
    cancellation_tx = Transaction(
        id="tx-cancel-1",
        wallet_id=safe_wallet.id,
        to_address=safe_wallet.address,
        amount="0",
        tx_type=TransactionType.CANCELLATION,
        status=TransactionStatus.PENDING_SIGN,
        safe_nonce=5,
        safe_replaces_tx_id="tx-1",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    
    transaction_service.get_transaction = AsyncMock(return_value=tx)
    wallet_result = MagicMock()
    wallet_result.scalar_one.return_value = safe_wallet
    mock_db.execute = AsyncMock(return_value=wallet_result)
    transaction_service._is_latest_safe_nonce = AsyncMock(return_value=True)
    transaction_service._create_safe_cancellation_transaction = AsyncMock(
        return_value=cancellation_tx
    )
    
    # Cancel onchain
    result = await transaction_service.cancel_transaction("tx-1", on_chain=True)
    
    assert result.tx_type == TransactionType.CANCELLATION
    assert result.safe_nonce == tx.safe_nonce
    assert result.safe_replaces_tx_id == tx.id
    transaction_service._create_safe_cancellation_transaction.assert_called_once()


@pytest.mark.asyncio
async def test_cancel_non_latest_nonce_must_be_onchain(transaction_service, mock_db, safe_wallet):
    """Test that non-latest nonce MUST use onchain cancellation."""
    tx = Transaction(
        id="tx-1",
        wallet_id=safe_wallet.id,
        to_address="0xdead",
        amount="1.0",
        status=TransactionStatus.SIGNED,
        safe_nonce=3,  # Not latest
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    
    transaction_service.get_transaction = AsyncMock(return_value=tx)
    wallet_result = MagicMock()
    wallet_result.scalar_one.return_value = safe_wallet
    mock_db.execute = AsyncMock(return_value=wallet_result)
    
    # Mock _is_latest_safe_nonce to return False (there's nonce 4, 5, etc.)
    transaction_service._is_latest_safe_nonce = AsyncMock(return_value=False)
    
    # Try offchain cancellation - should fail
    with pytest.raises(ValidationError) as exc_info:
        await transaction_service.cancel_transaction("tx-1", on_chain=False)
    
    assert "not the latest nonce" in str(exc_info.value)
    assert "offchain" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_cancel_non_latest_nonce_onchain_succeeds(transaction_service, mock_db, safe_wallet):
    """Test that non-latest nonce can be cancelled onchain."""
    tx = Transaction(
        id="tx-1",
        wallet_id=safe_wallet.id,
        to_address="0xdead",
        amount="1.0",
        status=TransactionStatus.SIGNED,
        safe_nonce=3,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    
    cancellation_tx = Transaction(
        id="tx-cancel-1",
        wallet_id=safe_wallet.id,
        to_address=safe_wallet.address,
        amount="0",
        tx_type=TransactionType.CANCELLATION,
        status=TransactionStatus.PENDING_SIGN,
        safe_nonce=3,
        safe_replaces_tx_id="tx-1",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    
    transaction_service.get_transaction = AsyncMock(return_value=tx)
    wallet_result = MagicMock()
    wallet_result.scalar_one.return_value = safe_wallet
    mock_db.execute = AsyncMock(return_value=wallet_result)
    transaction_service._is_latest_safe_nonce = AsyncMock(return_value=False)
    transaction_service._create_safe_cancellation_transaction = AsyncMock(
        return_value=cancellation_tx
    )
    
    # Cancel onchain - should succeed
    result = await transaction_service.cancel_transaction("tx-1", on_chain=True)
    
    assert result.tx_type == TransactionType.CANCELLATION
    assert result.safe_nonce == 3
    transaction_service._create_safe_cancellation_transaction.assert_called_once()


@pytest.mark.asyncio
async def test_get_cancellation_options_latest_nonce(transaction_service, mock_db, safe_wallet):
    """Test get_safe_cancellation_options for latest nonce."""
    tx = Transaction(
        id="tx-1",
        wallet_id=safe_wallet.id,
        to_address="0xdead",
        amount="1.0",
        status=TransactionStatus.SIGNED,
        safe_nonce=5,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    
    transaction_service.get_transaction = AsyncMock(return_value=tx)
    wallet_result = MagicMock()
    wallet_result.scalar_one.return_value = safe_wallet
    mock_db.execute = AsyncMock(return_value=wallet_result)
    transaction_service._is_latest_safe_nonce = AsyncMock(return_value=True)
    
    options = await transaction_service.get_safe_cancellation_options("tx-1")
    
    assert options["can_cancel_offchain"] is True
    assert options["can_cancel_onchain"] is True
    assert options["is_latest_nonce"] is True
    assert "free" in options["reason"].lower() or "offchain" in options["reason"].lower()


@pytest.mark.asyncio
async def test_get_cancellation_options_non_latest_nonce(transaction_service, mock_db, safe_wallet):
    """Test get_safe_cancellation_options for non-latest nonce."""
    tx = Transaction(
        id="tx-1",
        wallet_id=safe_wallet.id,
        to_address="0xdead",
        amount="1.0",
        status=TransactionStatus.SIGNED,
        safe_nonce=3,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    
    transaction_service.get_transaction = AsyncMock(return_value=tx)
    wallet_result = MagicMock()
    wallet_result.scalar_one.return_value = safe_wallet
    mock_db.execute = AsyncMock(return_value=wallet_result)
    transaction_service._is_latest_safe_nonce = AsyncMock(return_value=False)
    
    options = await transaction_service.get_safe_cancellation_options("tx-1")
    
    assert options["can_cancel_offchain"] is False
    assert options["can_cancel_onchain"] is True
    assert options["is_latest_nonce"] is False
    assert "must cancel onchain" in options["reason"].lower()


@pytest.mark.asyncio
async def test_cancel_non_safe_wallet_always_offchain(transaction_service, mock_db, non_safe_wallet):
    """Test non-Safe wallet always uses offchain cancellation."""
    tx = Transaction(
        id="tx-1",
        wallet_id=non_safe_wallet.id,
        to_address="0xdead",
        amount="1.0",
        status=TransactionStatus.SIGNED,
        safe_nonce=None,  # Non-Safe
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    
    transaction_service.get_transaction = AsyncMock(return_value=tx)
    wallet_result = MagicMock()
    wallet_result.scalar_one.return_value = non_safe_wallet
    mock_db.execute = AsyncMock(return_value=wallet_result)
    
    # Even if on_chain=True, non-Safe uses direct cancellation
    result = await transaction_service.cancel_transaction("tx-1", on_chain=True)
    
    assert result.status == TransactionStatus.CANCELLED
    assert result.id == "tx-1"  # Original transaction, not new one


@pytest.mark.asyncio
async def test_cannot_cancel_final_transaction(transaction_service, mock_db, safe_wallet):
    """Test cannot cancel confirmed transaction."""
    tx = Transaction(
        id="tx-1",
        wallet_id=safe_wallet.id,
        to_address="0xdead",
        amount="1.0",
        status=TransactionStatus.CONFIRMED,
        safe_nonce=5,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    tx.status = TransactionStatus.CONFIRMED
    
    transaction_service.get_transaction = AsyncMock(return_value=tx)
    
    with pytest.raises(ValidationError) as exc_info:
        await transaction_service.cancel_transaction("tx-1")
    
    assert "Cannot cancel transaction" in str(exc_info.value)


@pytest.mark.asyncio
async def test_cannot_cancel_broadcast_transaction(transaction_service, mock_db, safe_wallet):
    """Test cannot cancel broadcast transaction."""
    tx = Transaction(
        id="tx-1",
        wallet_id=safe_wallet.id,
        to_address="0xdead",
        amount="1.0",
        status=TransactionStatus.BROADCAST,
        safe_nonce=5,
        tx_hash="0xabc123",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    
    transaction_service.get_transaction = AsyncMock(return_value=tx)
    
    with pytest.raises(ValidationError) as exc_info:
        await transaction_service.cancel_transaction("tx-1")
    
    assert "broadcast" in str(exc_info.value).lower()
