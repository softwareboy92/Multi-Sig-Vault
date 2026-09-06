"""Unit tests for Wallet model."""

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus
from multivault.models.wallet import Wallet, WalletSigner, WalletStatus
from multivault.models.network import NetworkConfig


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
async def btc_network(async_session):
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
async def test_wallet_creation(async_session, evm_network):
    """Test basic wallet creation."""
    wallet = Wallet(
        name="Test Multisig",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=3,
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.commit()

    assert wallet.id is not None
    assert wallet.name == "Test Multisig"
    assert wallet.chain_type == ChainType.EVM
    assert wallet.threshold == 2
    assert wallet.signer_count == 3
    assert wallet.status == WalletStatus.PENDING_DEPLOY
    assert wallet.address is None
    assert wallet.created_at is not None


@pytest.mark.asyncio
async def test_wallet_with_signers(async_session, evm_network):
    """Test wallet with associated signers."""
    # Create signers
    signer1 = Signer(
        name="Signer 1",
        device_type=DeviceType.METAMASK,
        chain_type=ChainType.EVM,
        address="0x1111111111111111111111111111111111111111",
        status=SignerStatus.VERIFIED,
    )
    signer2 = Signer(
        name="Signer 2",
        device_type=DeviceType.LEDGER,
        chain_type=ChainType.EVM,
        address="0x2222222222222222222222222222222222222222",
        status=SignerStatus.VERIFIED,
    )
    async_session.add_all([signer1, signer2])
    await async_session.flush()

    # Create wallet
    wallet = Wallet(
        name="2-of-2 Multisig",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=2,
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.flush()

    # Create associations
    ws1 = WalletSigner(wallet_id=wallet.id, signer_id=signer1.id, order_index=0)
    ws2 = WalletSigner(wallet_id=wallet.id, signer_id=signer2.id, order_index=1)
    async_session.add_all([ws1, ws2])
    await async_session.commit()

    # Verify relationships - need selectinload for async
    stmt = (
        select(Wallet)
        .options(selectinload(Wallet.wallet_signers))
        .where(Wallet.id == wallet.id)
    )
    result = await async_session.execute(stmt)
    loaded_wallet = result.scalar_one()
    assert len(loaded_wallet.wallet_signers) == 2


@pytest.mark.asyncio
async def test_wallet_status_transitions(async_session, btc_network):
    """Test wallet status changes."""
    wallet = Wallet(
        name="Status Test",
        chain_type=ChainType.BTC,
        threshold=2,
        signer_count=3,
        network_id=btc_network.id,
    )
    async_session.add(wallet)
    await async_session.commit()

    assert wallet.status == WalletStatus.PENDING_DEPLOY
    assert not wallet.is_active
    assert not wallet.is_deployed

    # Simulate deployment
    wallet.status = WalletStatus.ACTIVE
    wallet.address = "bc1qtest..."
    await async_session.commit()

    await async_session.refresh(wallet)
    assert wallet.is_active
    assert wallet.is_deployed


@pytest.mark.asyncio
async def test_wallet_soft_delete(async_session, evm_network):
    """Test wallet soft deletion."""
    from datetime import UTC, datetime

    wallet = Wallet(
        name="To Delete",
        chain_type=ChainType.EVM,
        threshold=1,
        signer_count=1,
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.commit()

    assert wallet.deleted_at is None

    wallet.deleted_at = datetime.now(UTC)
    wallet.status = WalletStatus.ARCHIVED
    await async_session.commit()

    await async_session.refresh(wallet)
    assert wallet.deleted_at is not None
    assert wallet.status == WalletStatus.ARCHIVED
    assert not wallet.is_active


@pytest.mark.asyncio
async def test_wallet_signer_unique_constraint(async_session, evm_network):
    """Test unique constraint on wallet-signer relationship."""
    signer = Signer(
        name="Test Signer",
        device_type=DeviceType.METAMASK,
        chain_type=ChainType.EVM,
        address="0x3333333333333333333333333333333333333333",
        status=SignerStatus.VERIFIED,
    )
    async_session.add(signer)
    await async_session.flush()

    wallet = Wallet(
        name="Constraint Test",
        chain_type=ChainType.EVM,
        threshold=1,
        signer_count=1,
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.flush()

    # First association should work
    ws1 = WalletSigner(wallet_id=wallet.id, signer_id=signer.id, order_index=0)
    async_session.add(ws1)
    await async_session.commit()

    # Duplicate should fail
    ws2 = WalletSigner(wallet_id=wallet.id, signer_id=signer.id, order_index=1)
    async_session.add(ws2)

    with pytest.raises(IntegrityError):
        await async_session.commit()


@pytest.mark.asyncio
async def test_wallet_order_index_unique(async_session, evm_network):
    """Test unique order index per wallet."""
    signer1 = Signer(
        name="Signer A",
        device_type=DeviceType.METAMASK,
        chain_type=ChainType.EVM,
        address="0x4444444444444444444444444444444444444444",
        status=SignerStatus.VERIFIED,
    )
    signer2 = Signer(
        name="Signer B",
        device_type=DeviceType.LEDGER,
        chain_type=ChainType.EVM,
        address="0x5555555555555555555555555555555555555555",
        status=SignerStatus.VERIFIED,
    )
    async_session.add_all([signer1, signer2])
    await async_session.flush()

    wallet = Wallet(
        name="Order Test",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=2,
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.flush()

    # Same order_index should fail
    ws1 = WalletSigner(wallet_id=wallet.id, signer_id=signer1.id, order_index=0)
    ws2 = WalletSigner(wallet_id=wallet.id, signer_id=signer2.id, order_index=0)
    async_session.add_all([ws1, ws2])

    with pytest.raises(IntegrityError):
        await async_session.commit()


@pytest.mark.asyncio
async def test_wallet_btc_specific_fields(async_session, btc_network):
    """Test BTC-specific fields stored in extra JSON."""
    from multivault.utils.extra import get_extra_field, set_extra

    wallet = Wallet(
        name="BTC Multisig",
        chain_type=ChainType.BTC,
        threshold=2,
        signer_count=3,
        network_id=btc_network.id,
    )
    set_extra(wallet, witness_script="522102abc...53ae")
    async_session.add(wallet)
    await async_session.commit()

    await async_session.refresh(wallet)
    assert get_extra_field(wallet, "witness_script") == "522102abc...53ae"


@pytest.mark.asyncio
async def test_wallet_evm_specific_fields(async_session, evm_network):
    """Test EVM-specific fields stored in extra JSON."""
    from multivault.utils.extra import get_extra_field, set_extra

    wallet = Wallet(
        name="Safe Wallet",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=3,
        network_id=evm_network.id,
    )
    set_extra(wallet, salt="0x1234567890abcdef", factory_address="0x6666666666666666666666666666666666666666")
    async_session.add(wallet)
    await async_session.commit()

    await async_session.refresh(wallet)
    assert get_extra_field(wallet, "salt") == "0x1234567890abcdef"
    assert get_extra_field(wallet, "factory_address") == "0x6666666666666666666666666666666666666666"
