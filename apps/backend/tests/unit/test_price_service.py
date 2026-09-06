"""Tests for PriceService."""

import pytest


class TestBuildCoinKey:
    """Test DeFiLlama coin key construction."""

    def test_btc_native(self):
        from multivault.services.price_service import PriceService
        key = PriceService._build_coin_key(chain_type="BTC", symbol="BTC")
        assert key == "coingecko:bitcoin"

    def test_eth_native(self):
        from multivault.services.price_service import PriceService
        key = PriceService._build_coin_key(chain_type="EVM", chain_id=1, symbol="ETH")
        assert key == "coingecko:ethereum"

    def test_erc20_ethereum(self):
        from multivault.services.price_service import PriceService
        key = PriceService._build_coin_key(
            chain_type="EVM", chain_id=1,
            token_address="0xdAC17F958D2ee523a2206206994597C13D831ec7",
            symbol="USDT",
        )
        assert key == "ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7"

    def test_erc20_polygon(self):
        from multivault.services.price_service import PriceService
        key = PriceService._build_coin_key(
            chain_type="EVM", chain_id=137,
            token_address="0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
            symbol="USDC",
        )
        assert key == "polygon:0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"

    def test_erc20_arbitrum(self):
        from multivault.services.price_service import PriceService
        key = PriceService._build_coin_key(
            chain_type="EVM", chain_id=42161,
            token_address="0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
            symbol="USDC",
        )
        assert key == "arbitrum:0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"

    def test_erc20_optimism(self):
        from multivault.services.price_service import PriceService
        key = PriceService._build_coin_key(
            chain_type="EVM", chain_id=10,
            token_address="0x4200000000000000000000000000000000000042",
            symbol="OP",
        )
        assert key == "optimism:0x4200000000000000000000000000000000000042"

    def test_unknown_chain_fallback(self):
        from multivault.services.price_service import PriceService
        key = PriceService._build_coin_key(chain_type="EVM", chain_id=999, symbol="UNKNOWN")
        assert key == "coingecko:unknown"

    def test_testnet_returns_none(self):
        from multivault.services.price_service import PriceService
        key = PriceService._build_coin_key(chain_type="EVM", chain_id=11155111, symbol="ETH")
        assert key is None


class TestCacheGetSet:
    def test_cache_miss_returns_none(self):
        from multivault.services.price_service import PriceService
        svc = PriceService()
        assert svc._cache_get("coingecko:bitcoin") is None

    def test_cache_set_and_get(self):
        from multivault.services.price_service import PriceService
        svc = PriceService()
        entry = {"usd": 45000.0, "confidence": 0.99, "updated_at": "2026-02-16T10:00:00Z"}
        svc._cache_set("coingecko:bitcoin", entry)
        result = svc._cache_get("coingecko:bitcoin")
        assert result is not None
        assert result["usd"] == 45000.0

    def test_cache_expiry(self):
        import time
        from multivault.services.price_service import PriceService
        svc = PriceService(cache_ttl_seconds=0.1)
        svc._cache_set("coingecko:bitcoin", {"usd": 45000.0})
        time.sleep(0.15)
        assert svc._cache_get("coingecko:bitcoin") is None

    def test_stale_cache_available(self):
        import time
        from multivault.services.price_service import PriceService
        svc = PriceService(cache_ttl_seconds=0.1)
        svc._cache_set("coingecko:bitcoin", {"usd": 45000.0})
        time.sleep(0.15)
        assert svc._cache_get("coingecko:bitcoin") is None
        result = svc._cache_get("coingecko:bitcoin", allow_stale=True)
        assert result is not None
        assert result["usd"] == 45000.0


@pytest.mark.asyncio
class TestFetchPrices:
    async def test_fetch_prices_uses_cache(self):
        """If all prices are cached, no HTTP request is made."""
        from multivault.schemas.price import AssetPriceRequest
        from multivault.services.price_service import PriceService

        svc = PriceService()
        svc._cache_set("coingecko:bitcoin", {"usd": 45000.0, "confidence": 0.99, "updated_at": "2026-02-16T10:00:00Z"})

        result, is_stale = await svc.fetch_prices([
            AssetPriceRequest(chain_type="BTC", symbol="BTC"),
        ])
        assert "BTC" in result
        assert result["BTC"]["usd"] == 45000.0
        assert is_stale is False

    async def test_fetch_prices_skips_testnet(self):
        """Testnet assets should be skipped entirely."""
        from multivault.schemas.price import AssetPriceRequest
        from multivault.services.price_service import PriceService

        svc = PriceService()
        result, is_stale = await svc.fetch_prices([
            AssetPriceRequest(chain_type="EVM", chain_id=11155111, symbol="ETH"),
        ])
        assert result == {}
        assert is_stale is False

    async def test_fetch_prices_http_call(self, monkeypatch):
        """Verify DeFiLlama HTTP request is made for cache-miss assets."""
        import httpx
        from multivault.schemas.price import AssetPriceRequest
        from multivault.services.price_service import PriceService

        mock_response = httpx.Response(
            200,
            json={
                "coins": {
                    "coingecko:ethereum": {
                        "price": 3200.5,
                        "confidence": 0.99,
                        "timestamp": 1739692800,
                    }
                }
            },
            request=httpx.Request("GET", "https://example.com"),
        )

        calls = []

        async def mock_get(self_client, url, **kwargs):
            calls.append(url)
            return mock_response

        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        svc = PriceService()
        result, is_stale = await svc.fetch_prices([
            AssetPriceRequest(chain_type="EVM", chain_id=1, symbol="ETH"),
        ])
        assert len(calls) == 1
        assert "coingecko:ethereum" in calls[0]
        assert "ETH" in result
        assert result["ETH"]["usd"] == 3200.5
        assert is_stale is False

    async def test_fetch_prices_http_error_returns_stale(self, monkeypatch):
        """On HTTP error, return stale cache if available."""
        import httpx
        from multivault.schemas.price import AssetPriceRequest
        from multivault.services.price_service import PriceService

        async def mock_get(self_client, url, **kwargs):
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        svc = PriceService(cache_ttl_seconds=0)
        svc._cache_set("coingecko:ethereum", {"usd": 3100.0, "confidence": 0.95, "updated_at": "old"})
        svc._cache_ts["coingecko:ethereum"] = 0

        result, is_stale = await svc.fetch_prices([
            AssetPriceRequest(chain_type="EVM", chain_id=1, symbol="ETH"),
        ])
        assert "ETH" in result
        assert result["ETH"]["usd"] == 3100.0
        assert is_stale is True

    async def test_fetch_prices_http_error_no_cache(self, monkeypatch):
        """On HTTP error with no cache, returns empty dict."""
        import httpx
        from multivault.schemas.price import AssetPriceRequest
        from multivault.services.price_service import PriceService

        async def mock_get(self_client, url, **kwargs):
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        svc = PriceService()
        result, is_stale = await svc.fetch_prices([
            AssetPriceRequest(chain_type="EVM", chain_id=1, symbol="ETH"),
        ])
        assert result == {}
        assert is_stale is False


class TestCacheTtlConfig:
    """Verify that PriceService respects custom cache_ttl_seconds."""

    def test_default_cache_ttl(self):
        from multivault.services.price_service import PriceService, DEFAULT_CACHE_TTL
        svc = PriceService()
        assert svc._cache_ttl == DEFAULT_CACHE_TTL

    def test_custom_cache_ttl(self):
        from multivault.services.price_service import PriceService
        svc = PriceService(cache_ttl_seconds=60)
        assert svc._cache_ttl == 60

    def test_config_field_exists(self):
        from multivault.config import Settings
        s = Settings()
        assert s.price_cache_ttl_seconds == 180
