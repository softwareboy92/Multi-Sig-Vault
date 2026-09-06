"""Unit tests for Asset model."""

import pytest
from datetime import datetime, UTC

from multivault.models.asset import Asset


class TestAssetModel:
    """Test Asset model."""

    def test_asset_creation(self):
        """Test basic asset creation."""
        asset = Asset(
            wallet_id="test-wallet-id",
            symbol="ETH",
            name="Ethereum",
            decimals=18,
            balance="1000000000000000000",
        )

        assert asset.wallet_id == "test-wallet-id"
        assert asset.symbol == "ETH"
        assert asset.name == "Ethereum"
        assert asset.decimals == 18
        assert asset.balance == "1000000000000000000"
        assert asset.contract_address is None
        assert asset.is_native is True

    def test_asset_token(self):
        """Test token asset (with contract address)."""
        asset = Asset(
            wallet_id="test-wallet-id",
            symbol="USDT",
            name="Tether USD",
            contract_address="0xdac17f958d2ee523a2206206994597c13d831ec7",
            decimals=6,
            balance="1000000",
        )

        assert asset.is_native is False
        assert asset.contract_address == "0xdac17f958d2ee523a2206206994597c13d831ec7"

    def test_balance_float(self):
        """Test balance_float property."""
        # 1 ETH = 10^18 wei
        asset = Asset(
            wallet_id="test",
            symbol="ETH",
            decimals=18,
            balance="1000000000000000000",
        )
        assert asset.balance_float == 1.0

        # 1.5 ETH
        asset.balance = "1500000000000000000"
        assert asset.balance_float == 1.5

        # 0.001 ETH
        asset.balance = "1000000000000000"
        assert asset.balance_float == 0.001

    def test_balance_float_usdt(self):
        """Test balance_float with 6 decimals."""
        # 100 USDT
        asset = Asset(
            wallet_id="test",
            symbol="USDT",
            contract_address="0x...",
            decimals=6,
            balance="100000000",
        )
        assert asset.balance_float == 100.0

    def test_balance_float_zero(self):
        """Test balance_float with zero balance."""
        asset = Asset(
            wallet_id="test",
            symbol="ETH",
            decimals=18,
            balance="0",
        )
        assert asset.balance_float == 0.0

    def test_balance_float_invalid(self):
        """Test balance_float with invalid balance."""
        asset = Asset(
            wallet_id="test",
            symbol="ETH",
            decimals=18,
            balance="invalid",
        )
        assert asset.balance_float == 0.0

    def test_repr(self):
        """Test asset repr."""
        asset = Asset(
            wallet_id="wallet-123",
            symbol="ETH",
            balance="1000000000000000000",
        )
        repr_str = repr(asset)
        assert "wallet_id='wallet-123'" in repr_str
        assert "symbol='ETH'" in repr_str
