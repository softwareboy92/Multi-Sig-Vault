"""Tests for preset token auto-discovery during EVM asset sync."""

import json
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from multivault.chains.evm.multicall import BalanceResult
from multivault.chains.evm.token_registry import PresetToken
from multivault.models.asset import Asset
from multivault.models.base import Base
from multivault.models.network import NetworkConfig
from multivault.models.signer import ChainType
from multivault.models.wallet import Wallet, WalletStatus
from multivault.services.asset_service import AssetService


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as sess:
        yield sess


@pytest_asyncio.fixture
async def evm_wallet(session: AsyncSession):
    """Create a minimal EVM wallet on Ethereum mainnet (chain_id=1)."""
    network = NetworkConfig(
        chain_type="EVM",
        name="Ethereum",
        enabled=True,
        is_testnet=False,
        extra=json.dumps({"chain_id": 1}),
    )
    session.add(network)
    await session.flush()

    wallet = Wallet(
        name="Test Wallet",
        chain_type=ChainType.EVM,
        signer_count=3,
        address="0x1234567890123456789012345678901234567890",
        status=WalletStatus.ACTIVE,
        network_id=network.id,
        threshold=2,
    )
    session.add(wallet)
    await session.commit()
    return wallet


class TestPresetTokenDiscovery:
    """Tests for preset token auto-discovery in _sync_evm_assets."""

    @pytest.mark.asyncio
    async def test_preset_token_with_balance_is_created(self, session, evm_wallet):
        """Preset token with non-zero balance should be auto-created."""
        service = AssetService(session)

        usdt_address = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
        mock_results = [
            BalanceResult(address=evm_wallet.address, token=None, balance=1000000000000000000, success=True),
            BalanceResult(address=evm_wallet.address, token=usdt_address, balance=1000000000, success=True),
        ]

        with (
            patch.object(service, "_get_evm_rpc_url", return_value="http://localhost:8545"),
            patch("multivault.chains.evm.Web3Client") as MockClient,
            patch("multivault.chains.evm.Multicall3") as MockMulticall,
            patch(
                "multivault.chains.evm.token_registry.get_preset_tokens",
                return_value=[
                    PresetToken("USDT", "Tether USD", usdt_address, 6),
                ],
            ),
        ):
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.disconnect = AsyncMock()
            MockClient.return_value = mock_client
            mock_multicall = AsyncMock()
            MockMulticall.return_value = mock_multicall
            mock_multicall.get_balances.return_value = mock_results

            assets = await service._sync_evm_assets(evm_wallet)

        assert len(assets) == 2
        symbols = {a.symbol for a in assets}
        assert "ETH" in symbols
        assert "USDT" in symbols

        usdt_asset = next(a for a in assets if a.symbol == "USDT")
        assert usdt_asset.contract_address == usdt_address
        assert usdt_asset.balance == "1000000000"

    @pytest.mark.asyncio
    async def test_preset_token_with_zero_balance_not_created(self, session, evm_wallet):
        """Preset token with zero balance should NOT be created."""
        service = AssetService(session)

        usdt_address = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
        mock_results = [
            BalanceResult(address=evm_wallet.address, token=None, balance=1000000000000000000, success=True),
            BalanceResult(address=evm_wallet.address, token=usdt_address, balance=0, success=True),
        ]

        with (
            patch.object(service, "_get_evm_rpc_url", return_value="http://localhost:8545"),
            patch("multivault.chains.evm.Web3Client") as MockClient,
            patch("multivault.chains.evm.Multicall3") as MockMulticall,
            patch(
                "multivault.chains.evm.token_registry.get_preset_tokens",
                return_value=[
                    PresetToken("USDT", "Tether USD", usdt_address, 6),
                ],
            ),
        ):
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.disconnect = AsyncMock()
            MockClient.return_value = mock_client
            mock_multicall = AsyncMock()
            MockMulticall.return_value = mock_multicall
            mock_multicall.get_balances.return_value = mock_results

            assets = await service._sync_evm_assets(evm_wallet)

        assert len(assets) == 1
        assert assets[0].symbol == "ETH"

    @pytest.mark.asyncio
    async def test_existing_token_excluded_from_discovery(self, session, evm_wallet):
        """Tokens already in Asset table should not be re-discovered (no duplicate)."""
        usdt_address = "0xdAC17F958D2ee523a2206206994597C13D831ec7"

        # Pre-add USDT as existing asset
        existing = Asset(
            wallet_id=evm_wallet.id,
            symbol="USDT",
            name="Tether USD",
            contract_address=usdt_address,
            decimals=6,
            balance="500000000",
        )
        session.add(existing)
        await session.commit()

        service = AssetService(session)

        # Results: native + existing USDT (no discovery result since USDT already exists)
        mock_results = [
            BalanceResult(address=evm_wallet.address, token=None, balance=1000000000000000000, success=True),
            BalanceResult(address=evm_wallet.address, token=usdt_address, balance=2000000000, success=True),
        ]

        with (
            patch.object(service, "_get_evm_rpc_url", return_value="http://localhost:8545"),
            patch("multivault.chains.evm.Web3Client") as MockClient,
            patch("multivault.chains.evm.Multicall3") as MockMulticall,
            patch(
                "multivault.chains.evm.token_registry.get_preset_tokens",
                return_value=[
                    PresetToken("USDT", "Tether USD", usdt_address, 6),
                ],
            ),
        ):
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.disconnect = AsyncMock()
            MockClient.return_value = mock_client
            mock_multicall = AsyncMock()
            MockMulticall.return_value = mock_multicall
            mock_multicall.get_balances.return_value = mock_results

            assets = await service._sync_evm_assets(evm_wallet)

        # Native + existing USDT (no duplicate)
        assert len(assets) == 2
        usdt_assets = [a for a in assets if a.symbol == "USDT"]
        assert len(usdt_assets) == 1
        assert usdt_assets[0].balance == "2000000000"

    @pytest.mark.asyncio
    async def test_failed_preset_query_skipped(self, session, evm_wallet):
        """If Multicall3 query fails for a preset token, skip it silently."""
        service = AssetService(session)

        usdt_address = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
        mock_results = [
            BalanceResult(address=evm_wallet.address, token=None, balance=1000000000000000000, success=True),
            BalanceResult(address=evm_wallet.address, token=usdt_address, balance=0, success=False, error="Call failed"),
        ]

        with (
            patch.object(service, "_get_evm_rpc_url", return_value="http://localhost:8545"),
            patch("multivault.chains.evm.Web3Client") as MockClient,
            patch("multivault.chains.evm.Multicall3") as MockMulticall,
            patch(
                "multivault.chains.evm.token_registry.get_preset_tokens",
                return_value=[
                    PresetToken("USDT", "Tether USD", usdt_address, 6),
                ],
            ),
        ):
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.disconnect = AsyncMock()
            MockClient.return_value = mock_client
            mock_multicall = AsyncMock()
            MockMulticall.return_value = mock_multicall
            mock_multicall.get_balances.return_value = mock_results

            assets = await service._sync_evm_assets(evm_wallet)

        # Only native, failed preset skipped
        assert len(assets) == 1
        assert assets[0].symbol == "ETH"

    @pytest.mark.asyncio
    async def test_no_chain_id_skips_discovery(self, session):
        """Wallet without chain_id in network config should skip discovery."""
        # Create network without chain_id in extra
        network = NetworkConfig(
            chain_type="EVM",
            name="Unknown EVM",
            enabled=True,
            is_testnet=False,
            extra=json.dumps({}),
        )
        session.add(network)
        await session.flush()

        wallet = Wallet(
            name="No ChainID Wallet",
            chain_type=ChainType.EVM,
            signer_count=2,
            address="0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            status=WalletStatus.ACTIVE,
            network_id=network.id,
            threshold=1,
        )
        session.add(wallet)
        await session.commit()

        service = AssetService(session)

        # Only native result (no discovery tokens added)
        mock_results = [
            BalanceResult(address=wallet.address, token=None, balance=5000, success=True),
        ]

        with (
            patch.object(service, "_get_evm_rpc_url", return_value="http://localhost:8545"),
            patch("multivault.chains.evm.Web3Client") as MockClient,
            patch("multivault.chains.evm.Multicall3") as MockMulticall,
        ):
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.disconnect = AsyncMock()
            MockClient.return_value = mock_client
            mock_multicall = AsyncMock()
            MockMulticall.return_value = mock_multicall
            mock_multicall.get_balances.return_value = mock_results

            assets = await service._sync_evm_assets(wallet)

        # Only native, no discovery attempted
        assert len(assets) == 1
        # Verify get_balances was called with only 1 query (native)
        call_args = mock_multicall.get_balances.call_args[0][0]
        assert len(call_args) == 1

    @pytest.mark.asyncio
    async def test_mixed_existing_and_discovery(self, session, evm_wallet):
        """Existing tokens sync normally while new preset tokens get discovered."""
        usdt_address = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
        usdc_address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"

        # Pre-add USDT as existing asset
        existing = Asset(
            wallet_id=evm_wallet.id,
            symbol="USDT",
            name="Tether USD",
            contract_address=usdt_address,
            decimals=6,
            balance="500000000",
        )
        session.add(existing)
        await session.commit()

        service = AssetService(session)

        # Results: native + existing USDT + discovered USDC
        # Query order: [native, existing_USDT, discovery_USDC]
        mock_results = [
            BalanceResult(address=evm_wallet.address, token=None, balance=10**18, success=True),
            BalanceResult(address=evm_wallet.address, token=usdt_address, balance=2000000000, success=True),
            BalanceResult(address=evm_wallet.address, token=usdc_address, balance=500000000, success=True),
        ]

        with (
            patch.object(service, "_get_evm_rpc_url", return_value="http://localhost:8545"),
            patch("multivault.chains.evm.Web3Client") as MockClient,
            patch("multivault.chains.evm.Multicall3") as MockMulticall,
            patch(
                "multivault.chains.evm.token_registry.get_preset_tokens",
                return_value=[
                    PresetToken("USDT", "Tether USD", usdt_address, 6),
                    PresetToken("USDC", "USD Coin", usdc_address, 6),
                ],
            ),
        ):
            mock_client = AsyncMock()
            mock_client.connect = AsyncMock()
            mock_client.disconnect = AsyncMock()
            MockClient.return_value = mock_client
            mock_multicall = AsyncMock()
            MockMulticall.return_value = mock_multicall
            mock_multicall.get_balances.return_value = mock_results

            assets = await service._sync_evm_assets(evm_wallet)

        # Native + existing USDT (updated) + discovered USDC
        assert len(assets) == 3
        symbols = {a.symbol for a in assets}
        assert symbols == {"ETH", "USDT", "USDC"}

        # USDT balance updated
        usdt = next(a for a in assets if a.symbol == "USDT")
        assert usdt.balance == "2000000000"

        # USDC discovered with correct metadata
        usdc = next(a for a in assets if a.symbol == "USDC")
        assert usdc.contract_address == usdc_address
        assert usdc.balance == "500000000"
        assert usdc.decimals == 6
