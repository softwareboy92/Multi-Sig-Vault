"""Pydantic schemas for price data."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AssetPriceRequest(BaseModel):
    """Single asset for price lookup."""

    chain_type: str = Field(..., description="Chain type: EVM, BTC")
    chain_id: int | None = Field(None, description="EVM chain ID (null for BTC)")
    token_address: str | None = Field(
        None,
        pattern=r"^0x[0-9a-fA-F]{40}$",
        description="Contract address (null for native)",
    )
    symbol: str = Field(..., max_length=32, description="Token symbol")


class PriceInfo(BaseModel):
    """Price data for a single asset."""

    usd: float = Field(..., description="Price in USD")
    confidence: float | None = Field(None, description="DeFiLlama confidence score")
    updated_at: str | None = Field(None, description="Price timestamp from source")


class BatchPriceRequest(BaseModel):
    """Request body for batch price lookup."""

    assets: list[AssetPriceRequest] = Field(
        ..., min_length=1, max_length=100, description="Assets to query (max 100)"
    )
    provider: Literal["defillama", "okx", "binance", "coinmarketcap", "gateio"] = "defillama"


class BatchPriceResponse(BaseModel):
    """Response for batch price lookup."""

    prices: dict[str, PriceInfo] = Field(default_factory=dict, description="symbol → price")
    currency: str = Field("USD", description="Price currency")
    stale: bool = Field(False, description="True if prices are from stale cache")
    error: str | None = Field(None, description="Error message if price lookup failed")
    provider: str = Field("defillama", description="Price service used")
