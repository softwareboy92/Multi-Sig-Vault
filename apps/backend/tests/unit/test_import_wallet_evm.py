"""Tests for EVM Safe wallet import."""

from unittest.mock import AsyncMock, patch
from datetime import datetime, UTC

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.models import (
    DeviceType,
    NetworkConfig,
    Signer,
    SignerStatus,
    Wallet,
    WalletSigner,
    WalletStatus,
)
from multivault.models.wallet import WalletSource
from multivault.schemas.wallet import WalletImport
from multivault.services.wallet_service import WalletService
from multivault.errors.exceptions import ConflictError, ValidationError


@pytest_asyncio.fixture
async def evm_network(async_session: AsyncSession) -> NetworkConfig:
    """Create a test EVM network with a default node."""
    from multivault.models.network import NetworkNodeConfig

    net = NetworkConfig(
        id="evm-net-1",
        name="Ethereum Mainnet",
        chain_type="EVM",
        enabled=True,
        extra='{"chain_id": 1}',
    )
    async_session.add(net)
    await async_session.flush()

    node = NetworkNodeConfig(
        network_id=net.id,
        node_type="JSON_RPC",
        endpoint_url="http://localhost:8545",
        priority=100,
        enabled=True,
    )
    async_session.add(node)
    await async_session.flush()

    # Set default_node_id on the network (this is how get_default_node works)
    net.default_node_id = node.id
    await async_session.commit()
    return net


@pytest_asyncio.fixture
def wallet_service(async_session: AsyncSession) -> WalletService:
    return WalletService(async_session)


SAFE_ADDRESS = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552"
OWNERS = [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
]


class TestImportEVMSafe:
    @pytest.mark.asyncio
    async def test_import_evm_safe_success(
        self, wallet_service, evm_network, async_session
    ):
        """Import a deployed Safe wallet -> ACTIVE + UNVERIFIED signers."""
        data = WalletImport(
            name="Imported Safe",
            chain_type="EVM",
            network_id=evm_network.id,
            safe_address=SAFE_ADDRESS,
        )

        with patch(
            "multivault.services.wallet_service.EVMAdapter"
        ) as MockAdapter:
            adapter = MockAdapter.return_value
            adapter.connect = AsyncMock()
            adapter.disconnect = AsyncMock()
            adapter.is_deployed = AsyncMock(return_value=True)
            adapter.get_safe_info = AsyncMock(
                return_value={
                    "address": SAFE_ADDRESS,
                    "owners": OWNERS,
                    "threshold": 2,
                    "nonce": 5,
                }
            )

            wallet = await wallet_service.import_wallet(data)

        assert wallet.status == WalletStatus.ACTIVE
        assert wallet.source == WalletSource.IMPORTED
        assert wallet.address == SAFE_ADDRESS.lower()
        assert wallet.threshold == 2
        assert wallet.signer_count == 3

        # Verify signers created
        stmt = select(Signer).where(Signer.chain_type == "EVM")
        result = await async_session.execute(stmt)
        signers = list(result.scalars().all())
        assert len(signers) == 3
        for s in signers:
            assert s.status == SignerStatus.UNVERIFIED
            assert s.device_type == DeviceType.UNKNOWN

    @pytest.mark.asyncio
    async def test_import_evm_safe_duplicate(
        self, wallet_service, evm_network, async_session
    ):
        """Duplicate import -> ConflictError."""
        existing = Wallet(
            name="Already here",
            chain_type="EVM",
            threshold=2,
            signer_count=3,
            address=SAFE_ADDRESS.lower(),
            network_id=evm_network.id,
            status=WalletStatus.ACTIVE,
        )
        async_session.add(existing)
        await async_session.commit()

        data = WalletImport(
            name="Dup Safe",
            chain_type="EVM",
            network_id=evm_network.id,
            safe_address=SAFE_ADDRESS,
        )

        with patch(
            "multivault.services.wallet_service.EVMAdapter"
        ) as MockAdapter:
            adapter = MockAdapter.return_value
            adapter.connect = AsyncMock()
            adapter.disconnect = AsyncMock()
            adapter.is_deployed = AsyncMock(return_value=True)
            adapter.get_safe_info = AsyncMock(
                return_value={
                    "address": SAFE_ADDRESS,
                    "owners": OWNERS,
                    "threshold": 2,
                    "nonce": 5,
                }
            )
            with pytest.raises(ConflictError, match="already exists"):
                await wallet_service.import_wallet(data)

    @pytest.mark.asyncio
    async def test_import_evm_safe_not_deployed(
        self, wallet_service, evm_network
    ):
        """Safe not deployed -> ValidationError."""
        data = WalletImport(
            name="Bad Safe",
            chain_type="EVM",
            network_id=evm_network.id,
            safe_address=SAFE_ADDRESS,
        )

        with patch(
            "multivault.services.wallet_service.EVMAdapter"
        ) as MockAdapter:
            adapter = MockAdapter.return_value
            adapter.connect = AsyncMock()
            adapter.disconnect = AsyncMock()
            adapter.is_deployed = AsyncMock(return_value=False)
            with pytest.raises(ValidationError, match="not deployed"):
                await wallet_service.import_wallet(data)

    @pytest.mark.asyncio
    async def test_import_evm_signer_dedup(
        self, wallet_service, evm_network, async_session
    ):
        """Existing signer with matching address is reused."""
        existing_signer = Signer(
            name="My Ledger",
            device_type=DeviceType.LEDGER,
            chain_type="EVM",
            address=OWNERS[0].lower(),
            status=SignerStatus.VERIFIED,
        )
        async_session.add(existing_signer)
        await async_session.commit()

        data = WalletImport(
            name="Safe with existing signer",
            chain_type="EVM",
            network_id=evm_network.id,
            safe_address=SAFE_ADDRESS,
        )

        with patch(
            "multivault.services.wallet_service.EVMAdapter"
        ) as MockAdapter:
            adapter = MockAdapter.return_value
            adapter.connect = AsyncMock()
            adapter.disconnect = AsyncMock()
            adapter.is_deployed = AsyncMock(return_value=True)
            adapter.get_safe_info = AsyncMock(
                return_value={
                    "address": SAFE_ADDRESS,
                    "owners": OWNERS,
                    "threshold": 2,
                    "nonce": 5,
                }
            )
            wallet = await wallet_service.import_wallet(data)

        # Should have reused 1 existing + created 2 new
        stmt = select(Signer).where(Signer.chain_type == "EVM")
        result = await async_session.execute(stmt)
        signers = list(result.scalars().all())
        assert len(signers) == 3  # 1 reused + 2 new (not 4)

    @pytest.mark.asyncio
    async def test_import_evm_extra_json(
        self, wallet_service, evm_network, async_session
    ):
        """Verify extra JSON contains safe_version, imported_at, nonce_at_import."""
        import json

        data = WalletImport(
            name="Extra Check",
            chain_type="EVM",
            network_id=evm_network.id,
            safe_address=SAFE_ADDRESS,
        )

        with patch(
            "multivault.services.wallet_service.EVMAdapter"
        ) as MockAdapter:
            adapter = MockAdapter.return_value
            adapter.connect = AsyncMock()
            adapter.disconnect = AsyncMock()
            adapter.is_deployed = AsyncMock(return_value=True)
            adapter.get_safe_info = AsyncMock(
                return_value={
                    "address": SAFE_ADDRESS,
                    "owners": OWNERS,
                    "threshold": 2,
                    "nonce": 42,
                }
            )
            wallet = await wallet_service.import_wallet(data)

        extra = json.loads(wallet.extra)
        assert extra["safe_version"] == "1.4.0+"
        assert extra["nonce_at_import"] == 42
        assert "imported_at" in extra
        # Verify imported_at is a valid ISO datetime
        datetime.fromisoformat(extra["imported_at"])
