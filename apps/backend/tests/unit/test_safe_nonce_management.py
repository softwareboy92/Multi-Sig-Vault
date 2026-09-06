"""Tests for Safe nonce management functionality."""

import pytest
from datetime import UTC, datetime

from multivault.models.transaction import Transaction, TransactionStatus, TransactionType
from multivault.models.wallet import Wallet, WalletStatus
from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus
from multivault.models.network import NetworkConfig
from multivault.services.transaction_service import TransactionService
from multivault.schemas.transaction import TransactionCreate


@pytest.fixture
async def evm_network(async_session):
    """Create test EVM network configuration."""
    network = NetworkConfig(
        chain_type="EVM",
        name="Ethereum Mainnet",
        explorer_url="https://etherscan.io",
        enabled=True,
        is_testnet=False,
        extra='{"chain_id": 1}',
    )
    async_session.add(network)
    await async_session.commit()
    await async_session.refresh(network)
    return network


@pytest.fixture
async def evm_wallet(async_session, evm_network):
    """Create an active EVM Safe wallet for testing."""
    wallet = Wallet(
        name="Test Safe Wallet",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=3,
        address="0x1234567890123456789012345678901234567890",
        status=WalletStatus.ACTIVE,
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.commit()
    await async_session.refresh(wallet)
    return wallet


@pytest.mark.asyncio
async def test_allocate_safe_nonce_first_transaction(async_session, evm_wallet):
    """Test nonce allocation for first transaction."""
    service = TransactionService(async_session)
    
    # First transaction should get on-chain nonce
    on_chain_nonce = 5
    allocated = await service.allocate_safe_nonce(evm_wallet.id, on_chain_nonce)
    
    assert allocated == 5


@pytest.mark.asyncio
async def test_allocate_safe_nonce_with_pending_transactions(async_session, evm_wallet):
    """Test nonce allocation when transactions already exist."""
    service = TransactionService(async_session)
    
    # Create transactions with nonces 5, 6, 7 (no gaps)
    for nonce in [5, 6, 7]:
        tx = Transaction(
            wallet_id=evm_wallet.id,
            tx_type=TransactionType.TRANSFER,
            to_address="0x" + "0" * 40,
            amount="1.0",
            payload="{}",
            threshold=2,
            status=TransactionStatus.PENDING_SIGN,
            safe_nonce=nonce,
        )
        async_session.add(tx)
    
    await async_session.commit()
    
    # Next allocation should be 8 (first nonce without active transaction)
    on_chain_nonce = 5
    allocated = await service.allocate_safe_nonce(evm_wallet.id, on_chain_nonce)
    
    assert allocated == 8


@pytest.mark.asyncio
async def test_allocate_safe_nonce_after_on_chain_advance(async_session, evm_wallet):
    """Test nonce allocation after on-chain nonce advances."""
    service = TransactionService(async_session)
    
    # Create transaction with nonce 5
    tx = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "0" * 40,
        amount="1.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.PENDING_SIGN,
        safe_nonce=5,
    )
    async_session.add(tx)
    await async_session.commit()
    
    # On-chain nonce advanced to 10 (transactions 5-9 executed elsewhere)
    on_chain_nonce = 10
    allocated = await service.allocate_safe_nonce(evm_wallet.id, on_chain_nonce)
    
    # Should use on-chain nonce since it's higher
    assert allocated == 10


@pytest.mark.asyncio
async def test_sync_safe_nonces_marks_stale_transactions(async_session, evm_wallet):
    """Test that sync marks transactions with old nonces as failed."""
    service = TransactionService(async_session)
    
    # Create transactions with nonces 5, 6, 7
    tx_ids = []
    for nonce in [5, 6, 7]:
        tx = Transaction(
            wallet_id=evm_wallet.id,
            tx_type=TransactionType.TRANSFER,
            to_address="0x" + "0" * 40,
            amount="1.0",
            payload="{}",
            threshold=2,
            status=TransactionStatus.PENDING_SIGN,
            safe_nonce=nonce,
        )
        async_session.add(tx)
        await async_session.flush()
        tx_ids.append(tx.id)
    
    await async_session.commit()
    
    # On-chain nonce advanced to 7 (nonces 5, 6 are stale)
    on_chain_nonce = 7
    stale_count = await service.sync_safe_nonces(evm_wallet.id, on_chain_nonce)
    
    assert stale_count == 2
    
    # Verify transactions are marked as failed
    tx5 = await async_session.get(Transaction, tx_ids[0])
    tx6 = await async_session.get(Transaction, tx_ids[1])
    tx7 = await async_session.get(Transaction, tx_ids[2])
    await async_session.refresh(tx5)
    await async_session.refresh(tx6)
    await async_session.refresh(tx7)
    
    assert tx5.status == TransactionStatus.FAILED
    assert tx6.status == TransactionStatus.FAILED
    assert tx7.status == TransactionStatus.PENDING_SIGN  # Not stale
    assert "stale" in tx5.error_message.lower()


@pytest.mark.asyncio
async def test_can_broadcast_safe_transaction(async_session, evm_wallet):
    """Test broadcast validation requires nonce to match on-chain nonce."""
    service = TransactionService(async_session)
    
    # Create transaction with nonce 5
    tx5 = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "0" * 40,
        amount="1.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=5,
    )
    async_session.add(tx5)
    
    # Create transaction with nonce 6
    tx6 = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "0" * 40,
        amount="1.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=6,
    )
    async_session.add(tx6)
    await async_session.commit()
    
    # Case 1: Try to broadcast tx6 when on-chain nonce is 5 (should fail - cannot skip nonces)
    can_broadcast, reason = await service.can_broadcast_safe_transaction(tx6, on_chain_nonce=5)
    assert not can_broadcast
    assert "Cannot skip nonces" in reason
    assert "nonce 5" in reason
    
    # Case 2: Try to broadcast tx5 when on-chain nonce is 5 (should succeed - nonce matches)
    can_broadcast, reason = await service.can_broadcast_safe_transaction(tx5, on_chain_nonce=5)
    assert can_broadcast
    assert reason == ""
    
    # Case 3: Try to broadcast tx5 when on-chain nonce is 6 (should fail - stale)
    can_broadcast, reason = await service.can_broadcast_safe_transaction(tx5, on_chain_nonce=6)
    assert not can_broadcast
    assert "stale" in reason.lower()


@pytest.mark.asyncio
async def test_can_broadcast_with_no_blocking_transactions(async_session, evm_wallet):
    """Test broadcast validation allows transaction when nonce matches on-chain."""
    service = TransactionService(async_session)
    
    # Create transaction with nonce 5
    tx = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "0" * 40,
        amount="1.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=5,
    )
    async_session.add(tx)
    await async_session.commit()
    
    # On-chain nonce matches transaction nonce - should be able to broadcast
    can_broadcast, reason = await service.can_broadcast_safe_transaction(tx, on_chain_nonce=5)
    
    assert can_broadcast
    assert reason == ""
    
    # On-chain nonce is 4 - transaction is ahead, cannot broadcast
    can_broadcast, reason = await service.can_broadcast_safe_transaction(tx, on_chain_nonce=4)
    
    assert not can_broadcast
    assert "Cannot skip nonces" in reason


@pytest.mark.asyncio
async def test_can_broadcast_prevents_duplicate_nonce_broadcast(async_session, evm_wallet):
    """Test broadcast validation prevents multiple transactions with same nonce being broadcast."""
    service = TransactionService(async_session)
    
    # Create first transaction with nonce 5 - already broadcast
    tx5_broadcast = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "1" * 40,
        amount="1.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.BROADCAST,
        safe_nonce=5,
    )
    async_session.add(tx5_broadcast)
    
    # Create second transaction with same nonce 5 - ready to sign
    tx5_signed = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "2" * 40,
        amount="2.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=5,
    )
    async_session.add(tx5_signed)
    await async_session.commit()
    
    # Try to broadcast second transaction - should fail because first is already broadcast
    can_broadcast, reason = await service.can_broadcast_safe_transaction(tx5_signed, on_chain_nonce=5)
    
    assert not can_broadcast
    assert "already broadcast" in reason.lower()
    assert "nonce 5" in reason


@pytest.mark.asyncio
async def test_can_broadcast_blocked_by_smaller_nonce(async_session, evm_wallet):
    """Test that transactions are blocked when smaller nonces haven't been broadcast yet.
    
    Scenario:
    - on-chain nonce = 5 (nonces 0-4 already executed)
    - nonce 5: SIGNED (not broadcast yet)
    - nonce 6: SIGNED (should be blocked by the "skip nonces" check)
    - nonce 7: SIGNED (should be blocked by the "skip nonces" check)
    
    After nonce 5 is broadcast and on-chain nonce becomes 6:
    - nonce 6: can broadcast
    - nonce 7: still blocked (should wait for nonce 6)
    """
    service = TransactionService(async_session)
    
    # Create nonce 5 (SIGNED but not broadcast yet)
    tx5 = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "1" * 40,
        amount="1.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=5,
        description="Nonce 5 transaction",
    )
    async_session.add(tx5)
    
    # Create nonce 6 (also SIGNED)
    tx6 = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "2" * 40,
        amount="2.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=6,
        description="Nonce 6 transaction",
    )
    async_session.add(tx6)
    
    # Create nonce 7 (also SIGNED)
    tx7 = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "3" * 40,
        amount="3.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=7,
        description="Nonce 7 transaction",
    )
    async_session.add(tx7)
    await async_session.commit()
    
    # Test 1: tx5 should be able to broadcast (nonce matches on-chain nonce 5)
    can_broadcast, reason = await service.can_broadcast_safe_transaction(tx5, on_chain_nonce=5)
    assert can_broadcast
    assert reason == ""
    
    # Test 2: tx6 should be BLOCKED (nonce 6 > on-chain nonce 5)
    can_broadcast, reason = await service.can_broadcast_safe_transaction(tx6, on_chain_nonce=5)
    assert not can_broadcast
    assert "Cannot skip nonces" in reason
    assert "nonce 5" in reason
    
    # Test 3: tx7 should also be BLOCKED (nonce 7 > on-chain nonce 5)
    can_broadcast, reason = await service.can_broadcast_safe_transaction(tx7, on_chain_nonce=5)
    assert not can_broadcast
    assert "Cannot skip nonces" in reason
    
    # Test 4: After broadcasting tx5 and on-chain nonce becomes 6
    tx5.status = TransactionStatus.BROADCAST
    await async_session.commit()
    
    # Now tx6 should be able to broadcast (nonce matches on-chain nonce 6)
    can_broadcast, reason = await service.can_broadcast_safe_transaction(tx6, on_chain_nonce=6)
    assert can_broadcast
    assert reason == ""
    
    # But tx7 should still be blocked (nonce 7 > on-chain nonce 6, must execute nonce 6 first)
    can_broadcast, reason = await service.can_broadcast_safe_transaction(tx7, on_chain_nonce=6)
    assert not can_broadcast
    assert "Cannot skip nonces" in reason
    assert "nonce 6" in reason


@pytest.mark.asyncio
async def test_allocate_safe_nonce_fills_cancelled_gap(async_session, evm_wallet):
    """Test that nonce allocation fills gaps left by cancelled transactions."""
    service = TransactionService(async_session)
    
    # Create transaction with nonce 5 - CANCELLED (gap)
    tx5_cancelled = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "1" * 40,
        amount="1.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.CANCELLED,
        safe_nonce=5,
    )
    async_session.add(tx5_cancelled)
    
    # Create active transactions with nonce 6, 7
    for nonce in [6, 7]:
        tx = Transaction(
            wallet_id=evm_wallet.id,
            tx_type=TransactionType.TRANSFER,
            to_address="0x" + "0" * 40,
            amount="1.0",
            payload="{}",
            threshold=2,
            status=TransactionStatus.SIGNED,
            safe_nonce=nonce,
        )
        async_session.add(tx)
    
    await async_session.commit()
    
    # On-chain nonce is 5 - next allocation should FILL THE GAP at nonce 5
    on_chain_nonce = 5
    allocated = await service.allocate_safe_nonce(evm_wallet.id, on_chain_nonce)
    
    # Should allocate nonce 5 (reusing cancelled nonce) to prevent blocking nonce 6, 7
    assert allocated == 5


@pytest.mark.asyncio
async def test_allocate_safe_nonce_fills_multiple_gaps(async_session, evm_wallet):
    """Test nonce allocation with multiple cancelled gaps."""
    service = TransactionService(async_session)
    
    # Create pattern: Active(5), Cancelled(6), Active(7), Cancelled(8), Active(9)
    statuses = [
        TransactionStatus.SIGNED,
        TransactionStatus.CANCELLED,
        TransactionStatus.SIGNED,
        TransactionStatus.CANCELLED,
        TransactionStatus.SIGNED,
    ]
    
    for i, status in enumerate(statuses):
        nonce = 5 + i
        tx = Transaction(
            wallet_id=evm_wallet.id,
            tx_type=TransactionType.TRANSFER,
            to_address="0x" + str(i) * 40,
            amount="1.0",
            payload="{}",
            threshold=2,
            status=status,
            safe_nonce=nonce,
        )
        async_session.add(tx)
    
    await async_session.commit()
    
    # First allocation should fill gap at nonce 6
    allocated1 = await service.allocate_safe_nonce(evm_wallet.id, on_chain_nonce=5)
    assert allocated1 == 6
    
    # Simulate creating transaction with nonce 6
    tx6 = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "a" * 40,
        amount="1.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=6,
    )
    async_session.add(tx6)
    await async_session.commit()
    
    # Second allocation should fill gap at nonce 8
    allocated2 = await service.allocate_safe_nonce(evm_wallet.id, on_chain_nonce=5)
    assert allocated2 == 8
    
    # Simulate creating transaction with nonce 8
    tx8 = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "b" * 40,
        amount="1.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=8,
    )
    async_session.add(tx8)
    await async_session.commit()
    
    # Third allocation should be nonce 10 (all gaps filled)
    allocated3 = await service.allocate_safe_nonce(evm_wallet.id, on_chain_nonce=5)
    assert allocated3 == 10


@pytest.mark.asyncio
async def test_allocate_safe_nonce_with_cancelled_gap(async_session, evm_wallet):
    """Test that cancelled transactions create gaps that are filled."""
    service = TransactionService(async_session)
    
    # Create cancelled transaction at nonce 5
    tx5_cancelled = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "1" * 40,
        amount="1.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.CANCELLED,
        safe_nonce=5,
    )
    async_session.add(tx5_cancelled)
    
    # Create active transaction at nonce 6
    tx6 = Transaction(
        wallet_id=evm_wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0x" + "2" * 40,
        amount="1.0",
        payload="{}",
        threshold=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=6,
    )
    async_session.add(tx6)
    await async_session.commit()
    
    # Should reuse nonce 5 from cancelled transaction
    allocated = await service.allocate_safe_nonce(evm_wallet.id, on_chain_nonce=5)
    assert allocated == 5


