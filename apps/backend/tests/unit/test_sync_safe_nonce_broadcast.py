"""Test that sync_safe_nonces doesn't mark BROADCAST transactions as stale."""

import pytest
from datetime import datetime, timedelta, UTC

from multivault.models.transaction import Transaction, TransactionStatus, TransactionType
from multivault.models.wallet import Wallet, WalletStatus
from multivault.models.signer import ChainType
from multivault.models.network import NetworkConfig
from multivault.services.transaction_service import TransactionService


@pytest.mark.asyncio
async def test_sync_safe_nonces_excludes_broadcast_transactions(async_session):
    """
    Test that BROADCAST transactions are not marked as stale by sync_safe_nonces.
    
    Scenario:
    - Transaction with nonce=0 is BROADCAST (already submitted to network)
    - On-chain nonce becomes 1 (transaction confirmed or another tx executed)
    - sync_safe_nonces should NOT mark the BROADCAST transaction as stale
    - It should be handled by the EVM Indexer worker instead
    """
    # Create EVM network
    network = NetworkConfig(
        chain_type="EVM",
        name="Sepolia",
        explorer_url="https://sepolia.etherscan.io",
        enabled=True,
        is_testnet=True,
        extra='{"chain_id": 11155111}',
    )
    async_session.add(network)
    await async_session.commit()
    await async_session.refresh(network)

    # Create test wallet
    wallet = Wallet(
        id="test-wallet-1",
        name="Test Safe Wallet",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=3,
        address="0x1234567890123456789012345678901234567890",
        network_id=network.id,
        status=WalletStatus.ACTIVE,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    async_session.add(wallet)
    
    # Create BROADCAST transaction with nonce=0
    broadcast_tx = Transaction(
        id="broadcast-tx-1",
        wallet_id=wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        amount=1000000000000000000,  # 1 ETH
        payload="{}",
        threshold=2,
        signature_count=2,
        status=TransactionStatus.BROADCAST,
        safe_nonce=0,
        tx_hash="0x1111111111111111111111111111111111111111111111111111111111111111",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    async_session.add(broadcast_tx)
    
    # Create SIGNED transaction with nonce=0 (not yet broadcast)
    # Set updated_at to 15 min ago so it's past the grace period
    signed_tx = Transaction(
        id="signed-tx-1",
        wallet_id=wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        amount=500000000000000000,  # 0.5 ETH
        payload="{}",
        threshold=2,
        signature_count=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=0,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC) - timedelta(minutes=15),
    )
    async_session.add(signed_tx)
    
    await async_session.commit()
    
    # Initialize service and sync nonces with on-chain nonce = 1
    service = TransactionService(async_session)
    stale_count = await service.sync_safe_nonces(wallet.id, on_chain_nonce=1)
    
    # Refresh from DB
    await async_session.refresh(broadcast_tx)
    await async_session.refresh(signed_tx)
    
    # Assertions
    assert stale_count == 1, "Should mark 1 transaction as stale (SIGNED only)"
    
    # BROADCAST transaction should remain unchanged
    assert broadcast_tx.status == TransactionStatus.BROADCAST, (
        "BROADCAST transaction should not be marked as stale"
    )
    assert broadcast_tx.error_message is None, (
        "BROADCAST transaction should have no error message"
    )
    
    # SIGNED transaction should be marked as FAILED
    assert signed_tx.status == TransactionStatus.FAILED, (
        "SIGNED transaction with old nonce should be marked as FAILED"
    )
    assert "Transaction stale" in signed_tx.error_message, (
        "SIGNED transaction should have stale error message"
    )
    assert "Nonce 0 already used" in signed_tx.error_message


@pytest.mark.asyncio
async def test_sync_safe_nonces_marks_pending_transactions_as_stale(async_session):
    """
    Test that non-BROADCAST transactions are correctly marked as stale.
    
    Statuses that should be marked: PENDING_SIGN, PARTIALLY_SIGNED, SIGNED
    """
    # Create EVM network
    network = NetworkConfig(
        chain_type="EVM",
        name="Sepolia",
        explorer_url="https://sepolia.etherscan.io",
        enabled=True,
        is_testnet=True,
        extra='{"chain_id": 11155111}',
    )
    async_session.add(network)
    await async_session.commit()
    await async_session.refresh(network)

    # Create test wallet
    wallet = Wallet(
        id="test-wallet-2",
        name="Test Safe Wallet 2",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=3,
        address="0x2234567890123456789012345678901234567890",
        network_id=network.id,
        status=WalletStatus.ACTIVE,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    async_session.add(wallet)
    
    # Create transactions with various statuses
    statuses_to_test = [
        TransactionStatus.PENDING_SIGN,
        TransactionStatus.PARTIALLY_SIGNED,
        TransactionStatus.SIGNED,
    ]
    
    transactions = []
    for idx, status in enumerate(statuses_to_test):
        # SIGNED txs need updated_at > 10 min ago to be past grace period
        age = timedelta(minutes=15) if status == TransactionStatus.SIGNED else timedelta(0)
        tx = Transaction(
            id=f"test-tx-{idx}",
            wallet_id=wallet.id,
            tx_type=TransactionType.TRANSFER,
            to_address="0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            amount=1000000000000000000,
            payload="{}",
            threshold=2,
            signature_count=1,
            status=status,
            safe_nonce=0,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC) - age,
        )
        async_session.add(tx)
        transactions.append(tx)
    
    await async_session.commit()
    
    # Sync nonces with on-chain nonce = 1
    service = TransactionService(async_session)
    stale_count = await service.sync_safe_nonces(wallet.id, on_chain_nonce=1)
    
    # Refresh all transactions
    for tx in transactions:
        await async_session.refresh(tx)
    
    # All should be marked as FAILED
    assert stale_count == len(statuses_to_test)
    
    for tx in transactions:
        assert tx.status == TransactionStatus.FAILED
        assert "Transaction stale" in tx.error_message
        assert "Nonce 0 already used" in tx.error_message
