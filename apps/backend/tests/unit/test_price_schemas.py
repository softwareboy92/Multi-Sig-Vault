"""Tests for price schemas."""

import pytest
from pydantic import ValidationError


class TestAssetPriceRequest:
    def test_evm_native(self):
        from multivault.schemas.price import AssetPriceRequest

        req = AssetPriceRequest(chain_type="EVM", chain_id=1, symbol="ETH")
        assert req.token_address is None
        assert req.chain_id == 1

    def test_evm_erc20(self):
        from multivault.schemas.price import AssetPriceRequest

        req = AssetPriceRequest(
            chain_type="EVM",
            chain_id=1,
            token_address="0xdAC17F958D2ee523a2206206994597C13D831ec7",
            symbol="USDT",
        )
        assert req.token_address is not None

    def test_btc_native(self):
        from multivault.schemas.price import AssetPriceRequest

        req = AssetPriceRequest(chain_type="BTC", symbol="BTC")
        assert req.chain_id is None

    def test_symbol_required(self):
        from multivault.schemas.price import AssetPriceRequest

        with pytest.raises(ValidationError):
            AssetPriceRequest(chain_type="EVM", chain_id=1)

    def test_invalid_token_address_rejected(self):
        from multivault.schemas.price import AssetPriceRequest

        with pytest.raises(ValidationError, match="token_address"):
            AssetPriceRequest(
                chain_type="EVM", chain_id=1, symbol="BAD",
                token_address="not-a-hex-address",
            )

    def test_short_token_address_rejected(self):
        from multivault.schemas.price import AssetPriceRequest

        with pytest.raises(ValidationError, match="token_address"):
            AssetPriceRequest(
                chain_type="EVM", chain_id=1, symbol="BAD",
                token_address="0x1234",
            )


class TestPriceInfo:
    def test_price_info_construction(self):
        from multivault.schemas.price import PriceInfo

        info = PriceInfo(usd=3200.5, confidence=0.99, updated_at="2026-02-16T10:00:00Z")
        assert info.usd == 3200.5

    def test_price_info_optional_fields(self):
        from multivault.schemas.price import PriceInfo

        info = PriceInfo(usd=1.0)
        assert info.confidence is None
        assert info.updated_at is None


class TestBatchPriceRequest:
    def test_batch_request(self):
        from multivault.schemas.price import AssetPriceRequest, BatchPriceRequest

        req = BatchPriceRequest(assets=[
            AssetPriceRequest(chain_type="EVM", chain_id=1, symbol="ETH"),
            AssetPriceRequest(chain_type="BTC", symbol="BTC"),
        ])
        assert len(req.assets) == 2

    def test_empty_assets_rejected(self):
        from multivault.schemas.price import BatchPriceRequest

        with pytest.raises(ValidationError):
            BatchPriceRequest(assets=[])

    def test_over_max_assets_rejected(self):
        from multivault.schemas.price import AssetPriceRequest, BatchPriceRequest

        assets = [
            AssetPriceRequest(chain_type="EVM", chain_id=1, symbol=f"T{i}")
            for i in range(101)
        ]
        with pytest.raises(ValidationError, match="at most 100"):
            BatchPriceRequest(assets=assets)


class TestBatchPriceResponse:
    def test_batch_response(self):
        from multivault.schemas.price import BatchPriceResponse, PriceInfo

        resp = BatchPriceResponse(
            prices={"ETH": PriceInfo(usd=3200.5)},
            currency="USD",
            stale=False,
        )
        assert resp.prices["ETH"].usd == 3200.5
        assert resp.currency == "USD"
