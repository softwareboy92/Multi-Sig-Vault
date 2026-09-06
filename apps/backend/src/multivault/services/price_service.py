"""Price data service — DeFiLlama integration with in-memory cache."""

from __future__ import annotations

import time
from typing import Any

import httpx
import structlog

logger = structlog.get_logger()

# DeFiLlama chain_id → platform mapping
CHAIN_ID_TO_PLATFORM: dict[int, str] = {
    1: "ethereum",
    137: "polygon",
    42161: "arbitrum",
    10: "optimism",
}

# Native asset overrides (symbol → coingecko id)
NATIVE_OVERRIDES: dict[str, str] = {
    "BTC": "coingecko:bitcoin",
    "ETH": "coingecko:ethereum",
}

# Known testnet chain_ids — skip price queries
TESTNET_CHAIN_IDS: set[int] = {
    5, 11155111, 11155420,  # Goerli, Sepolia, OP Sepolia
    80001, 80002,           # Mumbai, Amoy
    421614,                 # Arbitrum Sepolia
    97,                     # BSC Testnet
}

DEFILLAMA_BASE_URL = "https://coins.llama.fi/prices/current"
DEFAULT_CACHE_TTL = 180  # 3 minutes


class PriceService:
    """Fetches and caches asset prices from DeFiLlama."""

    def __init__(self, cache_ttl_seconds: float = DEFAULT_CACHE_TTL):
        self._cache: dict[str, dict[str, Any]] = {}
        self._cache_ts: dict[str, float] = {}
        self._cache_ttl = cache_ttl_seconds

    # ------------------------------------------------------------------
    # Coin key builder
    # ------------------------------------------------------------------

    @staticmethod
    def _build_coin_key(
        chain_type: str,
        symbol: str,
        chain_id: int | None = None,
        token_address: str | None = None,
    ) -> str | None:
        """Build DeFiLlama coin key from asset attributes.

        Returns None for testnet assets (no market price).
        """
        # Skip testnets
        if chain_id is not None and chain_id in TESTNET_CHAIN_IDS:
            return None

        # Native asset with known override
        if token_address is None:
            override = NATIVE_OVERRIDES.get(symbol.upper())
            if override:
                return override
            # Unknown native → coingecko fallback
            return f"coingecko:{symbol.lower()}"

        # ERC-20: need chain_id → platform mapping
        if chain_type == "EVM" and chain_id is not None:
            platform = CHAIN_ID_TO_PLATFORM.get(chain_id)
            if platform:
                return f"{platform}:{token_address}"

        # Fallback for unknown chain
        return f"coingecko:{symbol.lower()}"

    # ------------------------------------------------------------------
    # In-memory cache
    # ------------------------------------------------------------------

    def _cache_get(self, key: str, *, allow_stale: bool = False) -> dict[str, Any] | None:
        """Get cached price entry. Returns None if missing or expired."""
        if key not in self._cache:
            return None
        age = time.monotonic() - self._cache_ts[key]
        if age > self._cache_ttl and not allow_stale:
            return None
        return self._cache[key]

    def _cache_set(self, key: str, entry: dict[str, Any]) -> None:
        """Store a price entry in cache."""
        self._cache[key] = entry
        self._cache_ts[key] = time.monotonic()

    # ------------------------------------------------------------------
    # DeFiLlama fetch
    # ------------------------------------------------------------------

    async def fetch_prices(
        self,
        assets: list[Any],
    ) -> tuple[dict[str, dict[str, Any]], bool]:
        """Fetch prices for a list of AssetPriceRequest.

        Returns (prices_dict, is_stale). ``is_stale`` is True when at
        least one price came from an expired cache entry (DeFiLlama
        request failed and we fell back to stale data).

        Strategy:
        1. Build coin keys for each asset
        2. Return cached values for cache hits
        3. Batch-fetch remaining from DeFiLlama
        4. On error → fallback to stale cache (mark stale=True)
        """
        result: dict[str, dict[str, Any]] = {}
        to_fetch: list[tuple[str, Any]] = []  # (coin_key, asset)
        is_stale = False

        for asset in assets:
            coin_key = self._build_coin_key(
                chain_type=asset.chain_type,
                symbol=asset.symbol,
                chain_id=asset.chain_id,
                token_address=asset.token_address,
            )
            if coin_key is None:
                continue  # testnet, skip

            cached = self._cache_get(coin_key)
            if cached is not None:
                result[asset.symbol] = cached
            else:
                to_fetch.append((coin_key, asset))

        if not to_fetch:
            return result, is_stale

        # Batch fetch from DeFiLlama
        coin_keys_str = ",".join(ck for ck, _ in to_fetch)
        url = f"{DEFILLAMA_BASE_URL}/{coin_keys_str}"

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()

            coins = data.get("coins", {})
            for coin_key, asset in to_fetch:
                coin_data = coins.get(coin_key)
                if coin_data is not None:
                    entry = {
                        "usd": coin_data["price"],
                        "confidence": coin_data.get("confidence"),
                        "updated_at": coin_data.get("timestamp"),
                    }
                    self._cache_set(coin_key, entry)
                    result[asset.symbol] = entry
        except Exception as exc:
            logger.warning("defillama_fetch_failed", error=str(exc))
            # Fallback to stale cache
            for coin_key, asset in to_fetch:
                stale_entry = self._cache_get(coin_key, allow_stale=True)
                if stale_entry is not None:
                    result[asset.symbol] = stale_entry
                    is_stale = True

        return result, is_stale
