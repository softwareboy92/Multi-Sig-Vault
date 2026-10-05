"""Price API endpoints."""

from fastapi import APIRouter

from multivault.config import get_settings
from multivault.schemas.common import ApiResponse
from multivault.schemas.price import BatchPriceRequest, BatchPriceResponse, PriceInfo
from multivault.services.price_service import PriceService

router = APIRouter()

# Module-level singleton — no DB dependency, just in-memory cache + HTTP
_settings = get_settings()
_price_service = PriceService(cache_ttl_seconds=_settings.price_cache_ttl_seconds)


@router.post("/batch", response_model=ApiResponse[BatchPriceResponse])
async def batch_prices(body: BatchPriceRequest) -> ApiResponse[BatchPriceResponse]:
    """Fetch current USD prices for a batch of assets.

    Uses the selected market-data provider with a short in-memory cache.
    Testnet assets are skipped (no market price).
    """
    raw, is_stale = await _price_service.fetch_prices(body.assets, provider=body.provider)

    prices = {
        symbol: PriceInfo(
            usd=data["usd"],
            confidence=data.get("confidence"),
            updated_at=str(data["updated_at"]) if data.get("updated_at") else None,
        )
        for symbol, data in raw.items()
    }

    return ApiResponse(
        data=BatchPriceResponse(
            prices=prices,
            currency="USD",
            stale=is_stale,
            provider=body.provider,
        )
    )
