"""Unit tests for WalletService."""

import pytest
from datetime import UTC, datetime

from multivault.errors.exceptions import NotFoundError, ValidationError
from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus
from multivault.models.wallet import WalletStatus
from multivault.models.network import NetworkConfig, NetworkNodeConfig
from multivault.schemas.signer import ChainTypeEnum
from multivault.schemas.wallet import WalletCreate, WalletQuery, WalletUpdate
from multivault.services.wallet_service import WalletService


@pytest.fixture
async def wallet_service(async_session):
    """Create wallet service with test database."""
    return WalletService(async_session)


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
        name="Bitcoin Mainnet",
        enabled=True,
        extra='{"btc_network": "mainnet"}',
    )
    async_session.add(network)
    await async_session.commit()
    await async_session.refresh(network)

    # Add a default node
    node = NetworkNodeConfig(
        network_id=network.id,
        node_type="ELECTRUM",
        endpoint_url="electrum://localhost:50001?ssl=false",
        enabled=True,
        is_healthy=True,
    )
    async_session.add(node)
    await async_session.commit()
    await async_session.refresh(node)

    # Set as default node
    network.default_node_id = node.id
    await async_session.commit()
    await async_session.refresh(network)

    return network


@pytest.fixture
async def verified_evm_signers(async_session):
    """Create 3 verified EVM signers."""
    signers = []
    for i in range(3):
        signer = Signer(
            name=f"EVM Signer {i + 1}",
            device_type=DeviceType.METAMASK,
            chain_type=ChainType.EVM,
            address=f"0x{'1' * 39}{i}",
            status=SignerStatus.VERIFIED,
            verified_at=datetime.now(UTC),
        )
        async_session.add(signer)
        signers.append(signer)
    await async_session.commit()
    for s in signers:
        await async_session.refresh(s)
    return signers


@pytest.fixture
async def verified_btc_signers(async_session):
    """Create 3 verified BTC signers."""
    signers = []
    for i in range(3):
        signer = Signer(
            name=f"BTC Signer {i + 1}",
            device_type=DeviceType.LEDGER,
            chain_type=ChainType.BTC,
            # Valid compressed public key format: 02/03 + 64 hex chars = 66 chars total (33 bytes)
            public_key=f"02{'a' * 63}{i}",
            derivation_path=f"m/48'/0'/{i}'/2'",
            status=SignerStatus.VERIFIED,
            verified_at=datetime.now(UTC),
        )
        async_session.add(signer)
        signers.append(signer)
    await async_session.commit()
    for s in signers:
        await async_session.refresh(s)
    return signers


@pytest.mark.asyncio
async def test_create_wallet_success(wallet_service, verified_evm_signers, evm_network):
    """Test successful wallet creation."""
    signer_ids = [s.id for s in verified_evm_signers]

    data = WalletCreate(
        name="Test 2-of-3 Multisig",
        chain_type=ChainTypeEnum.EVM,
        threshold=2,
        network_id=evm_network.id,
        signer_ids=signer_ids,
    )

    wallet = await wallet_service.create_wallet(data)

    assert wallet.id is not None
    assert wallet.name == "Test 2-of-3 Multisig"
    assert wallet.chain_type == ChainType.EVM
    assert wallet.threshold == 2
    assert wallet.signer_count == 3
    assert wallet.status == WalletStatus.PENDING_DEPLOY
    assert len(wallet.wallet_signers) == 3


@pytest.mark.asyncio
async def test_create_wallet_btc(wallet_service, verified_btc_signers, btc_network):
    """Test BTC wallet creation."""
    signer_ids = [s.id for s in verified_btc_signers[:2]]

    data = WalletCreate(
        name="BTC 2-of-2",
        chain_type=ChainTypeEnum.BTC,
        threshold=2,
        signer_ids=signer_ids,
        network_id=btc_network.id,
    )

    wallet = await wallet_service.create_wallet(data)

    assert wallet.chain_type == ChainType.BTC
    assert wallet.threshold == 2
    assert wallet.signer_count == 2


@pytest.mark.asyncio
async def test_create_wallet_threshold_exceeds_signers(
    wallet_service, verified_evm_signers, evm_network
):
    """Test validation when threshold > signer count."""
    signer_ids = [verified_evm_signers[0].id]

    data = WalletCreate(
        name="Invalid Threshold",
        chain_type=ChainTypeEnum.EVM,
        threshold=2,
        network_id=evm_network.id,  # threshold > 1 signer
        signer_ids=signer_ids,
    )

    with pytest.raises(ValidationError) as exc_info:
        await wallet_service.create_wallet(data)

    assert "cannot exceed signer count" in exc_info.value.message


@pytest.mark.asyncio
async def test_create_wallet_missing_signer(wallet_service, verified_evm_signers, evm_network):
    """Test error when signer not found."""
    signer_ids = [verified_evm_signers[0].id, "non-existent-id"]

    data = WalletCreate(
        name="Missing Signer",
        chain_type=ChainTypeEnum.EVM,
        threshold=2,
        network_id=evm_network.id,
        signer_ids=signer_ids,
    )

    with pytest.raises(NotFoundError) as exc_info:
        await wallet_service.create_wallet(data)

    assert "not found" in exc_info.value.message


@pytest.mark.asyncio
async def test_create_wallet_unverified_signer(wallet_service, async_session, evm_network):
    """Test error when signer is not verified."""
    unverified = Signer(
        name="Unverified",
        device_type=DeviceType.METAMASK,
        chain_type=ChainType.EVM,
        address="0x7777777777777777777777777777777777777777",
        status=SignerStatus.UNVERIFIED,
    )
    async_session.add(unverified)
    await async_session.commit()
    await async_session.refresh(unverified)

    data = WalletCreate(
        name="With Unverified",
        chain_type=ChainTypeEnum.EVM,
        threshold=1,
        network_id=evm_network.id,
        signer_ids=[unverified.id],
    )

    with pytest.raises(ValidationError) as exc_info:
        await wallet_service.create_wallet(data)

    assert "not verified" in str(exc_info.value.details)


@pytest.mark.asyncio
async def test_create_wallet_chain_type_mismatch(
    wallet_service, verified_evm_signers, verified_btc_signers, evm_network
):
    """Test error when signer chain type doesn't match wallet."""
    # Try to add BTC signer to EVM wallet
    data = WalletCreate(
        name="Mixed Chain",
        chain_type=ChainTypeEnum.EVM,
        threshold=1,
        network_id=evm_network.id,
        signer_ids=[verified_btc_signers[0].id],  # BTC signer
    )

    with pytest.raises(ValidationError) as exc_info:
        await wallet_service.create_wallet(data)

    assert "chain type" in str(exc_info.value.details).lower()


@pytest.mark.asyncio
async def test_get_wallet_success(wallet_service, verified_evm_signers, evm_network):
    """Test getting wallet by ID."""
    data = WalletCreate(
        name="Get Test",
        chain_type=ChainTypeEnum.EVM,
        threshold=2,
        network_id=evm_network.id,
        signer_ids=[s.id for s in verified_evm_signers[:2]],
    )
    created = await wallet_service.create_wallet(data)

    wallet = await wallet_service.get_wallet(created.id)

    assert wallet.id == created.id
    assert wallet.name == "Get Test"
    assert len(wallet.wallet_signers) == 2


@pytest.mark.asyncio
async def test_get_wallet_not_found(wallet_service):
    """Test getting non-existent wallet."""
    with pytest.raises(NotFoundError):
        await wallet_service.get_wallet("non-existent-id")


@pytest.mark.asyncio
async def test_list_wallets(wallet_service, verified_evm_signers, verified_btc_signers, evm_network, btc_network):
    """Test listing wallets with pagination."""
    # Create EVM wallet
    await wallet_service.create_wallet(
        WalletCreate(
            name="EVM Wallet",
            chain_type=ChainTypeEnum.EVM,
            threshold=2,
            network_id=evm_network.id,
            signer_ids=[s.id for s in verified_evm_signers[:2]],
        )
    )

    # Create BTC wallet
    await wallet_service.create_wallet(
        WalletCreate(
            name="BTC Wallet",
            chain_type=ChainTypeEnum.BTC,
            threshold=2,
            network_id=btc_network.id,
            signer_ids=[s.id for s in verified_btc_signers[:2]],
        )
    )

    # List all
    query = WalletQuery(page=1, page_size=10)
    wallets, total = await wallet_service.list_wallets(query)

    assert total == 2
    assert len(wallets) == 2

    # Filter by chain type
    query = WalletQuery(chain_type=ChainTypeEnum.EVM, page=1, page_size=10)
    wallets, total = await wallet_service.list_wallets(query)

    assert total == 1
    assert wallets[0].chain_type == ChainType.EVM


@pytest.mark.asyncio
async def test_update_wallet(wallet_service, verified_evm_signers, evm_network):
    """Test updating wallet name."""
    data = WalletCreate(
        name="Original Name",
        chain_type=ChainTypeEnum.EVM,
        threshold=2,
        network_id=evm_network.id,
        signer_ids=[s.id for s in verified_evm_signers[:2]],
    )
    wallet = await wallet_service.create_wallet(data)

    updated = await wallet_service.update_wallet(
        wallet.id, WalletUpdate(name="New Name")
    )

    assert updated.name == "New Name"


@pytest.mark.asyncio
async def test_archive_wallet(wallet_service, verified_evm_signers, evm_network):
    """Test archiving wallet."""
    data = WalletCreate(
        name="To Archive",
        chain_type=ChainTypeEnum.EVM,
        threshold=1,
        network_id=evm_network.id,
        signer_ids=[verified_evm_signers[0].id],
    )
    wallet = await wallet_service.create_wallet(data)

    archived = await wallet_service.archive_wallet(wallet.id)

    assert archived.status == WalletStatus.ARCHIVED
    assert archived.deleted_at is None  # ARCHIVED no longer sets deleted_at


@pytest.mark.asyncio
async def test_activate_wallet(wallet_service, verified_evm_signers, evm_network):
    """Test activating wallet after deployment."""
    data = WalletCreate(
        name="To Activate",
        chain_type=ChainTypeEnum.EVM,
        threshold=2,
        network_id=evm_network.id,
        signer_ids=[s.id for s in verified_evm_signers[:2]],
    )
    wallet = await wallet_service.create_wallet(data)

    assert wallet.status == WalletStatus.PENDING_DEPLOY

    activated = await wallet_service.activate_wallet(
        wallet.id,
        address="0x8888888888888888888888888888888888888888",
        salt="0xabcdef",
        factory_address="0x9999999999999999999999999999999999999999",
    )

    assert activated.status == WalletStatus.ACTIVE
    assert activated.address == "0x8888888888888888888888888888888888888888"
    from multivault.utils.extra import get_extra_field
    assert get_extra_field(activated, "salt") == "0xabcdef"
    assert activated.deployed_at is not None


@pytest.mark.asyncio
async def test_activate_wallet_already_active(wallet_service, verified_evm_signers, evm_network):
    """Test error when activating a non-PENDING_DEPLOY wallet."""
    data = WalletCreate(
        name="Already Active",
        chain_type=ChainTypeEnum.EVM,
        threshold=1,
        network_id=evm_network.id,
        signer_ids=[verified_evm_signers[0].id],
    )
    wallet = await wallet_service.create_wallet(data)

    # Activate first time
    await wallet_service.activate_wallet(
        wallet.id, address="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    )

    # Try to activate again
    with pytest.raises(ValidationError) as exc_info:
        await wallet_service.activate_wallet(
            wallet.id, address="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        )

    assert "pending-deploy" in exc_info.value.message.lower()


@pytest.mark.asyncio
async def test_signer_order_preserved(wallet_service, verified_evm_signers, evm_network):
    """Test that signer order is preserved."""
    # Reverse the order
    signer_ids = [s.id for s in reversed(verified_evm_signers)]

    data = WalletCreate(
        name="Order Test",
        chain_type=ChainTypeEnum.EVM,
        threshold=2,
        network_id=evm_network.id,
        signer_ids=signer_ids,
    )

    wallet = await wallet_service.create_wallet(data)

    # Verify order matches input
    for i, ws in enumerate(wallet.wallet_signers):
        assert ws.signer_id == signer_ids[i]
        assert ws.order_index == i


class TestSyncWalletPolicy:
    """Tests for WalletService.sync_wallet_policy()."""

    @pytest.mark.asyncio
    async def test_updates_threshold_and_signer_count(
        self, wallet_service, evm_network, verified_evm_signers, async_session
    ):
        """sync_wallet_policy updates wallet threshold and signer_count."""
        wallet_data = WalletCreate(
            name="Test Safe",
            chain_type=ChainTypeEnum.EVM,
            threshold=2,
            signer_ids=[s.id for s in verified_evm_signers],
            network_id=evm_network.id,
        )
        wallet = await wallet_service.create_wallet(wallet_data)

        # Simulate on-chain state with changed threshold
        safe_info = {
            "owners": [s.address for s in verified_evm_signers],
            "threshold": 1,  # Changed from 2 → 1
        }

        await wallet_service.sync_wallet_policy(wallet.id, safe_info)
        await async_session.refresh(wallet)

        assert wallet.threshold == 1
        assert wallet.signer_count == 3

    @pytest.mark.asyncio
    async def test_adds_new_signer(
        self, wallet_service, evm_network, verified_evm_signers, async_session
    ):
        """sync_wallet_policy creates Signer + WalletSigner for new owner."""
        wallet_data = WalletCreate(
            name="Test Safe",
            chain_type=ChainTypeEnum.EVM,
            threshold=2,
            signer_ids=[verified_evm_signers[0].id, verified_evm_signers[1].id],
            network_id=evm_network.id,
        )
        wallet = await wallet_service.create_wallet(wallet_data)

        # On-chain state has a new owner added
        new_owner_addr = "0x4444444444444444444444444444444444444444"
        safe_info = {
            "owners": [
                verified_evm_signers[0].address,
                verified_evm_signers[1].address,
                new_owner_addr,
            ],
            "threshold": 2,
        }

        await wallet_service.sync_wallet_policy(wallet.id, safe_info)
        await async_session.refresh(wallet)

        assert wallet.signer_count == 3

        from sqlalchemy import select
        from multivault.models.wallet import WalletSigner

        stmt = select(WalletSigner).where(WalletSigner.wallet_id == wallet.id)
        result = await async_session.execute(stmt)
        wallet_signers = result.scalars().all()
        assert len(wallet_signers) == 3

    @pytest.mark.asyncio
    async def test_removes_old_signer_association(
        self, wallet_service, evm_network, verified_evm_signers, async_session
    ):
        """sync_wallet_policy removes WalletSigner for removed owner."""
        wallet_data = WalletCreate(
            name="Test Safe",
            chain_type=ChainTypeEnum.EVM,
            threshold=2,
            signer_ids=[s.id for s in verified_evm_signers],
            network_id=evm_network.id,
        )
        wallet = await wallet_service.create_wallet(wallet_data)

        # On-chain state: one owner removed
        safe_info = {
            "owners": [
                verified_evm_signers[0].address,
                verified_evm_signers[2].address,
            ],
            "threshold": 1,
        }

        await wallet_service.sync_wallet_policy(wallet.id, safe_info)
        await async_session.refresh(wallet)

        assert wallet.signer_count == 2
        assert wallet.threshold == 1

        from sqlalchemy import select
        from multivault.models.wallet import WalletSigner

        stmt = select(WalletSigner).where(WalletSigner.wallet_id == wallet.id)
        result = await async_session.execute(stmt)
        wallet_signers = result.scalars().all()
        assert len(wallet_signers) == 2
