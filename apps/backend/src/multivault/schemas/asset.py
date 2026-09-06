"""Pydantic schemas for assets."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class AssetBase(BaseModel):
    """Base asset schema."""

    symbol: str = Field(..., max_length=32, description="Token symbol (e.g., ETH, USDT)")
    name: str | None = Field(None, max_length=128, description="Token name")
    contract_address: str | None = Field(
        None,
        max_length=64,
        description="Token contract address (null for native coins)",
    )
    decimals: int = Field(18, ge=0, le=18, description="Token decimals")


class AssetCreate(BaseModel):
    """Schema for adding a token to a wallet's watchlist."""

    contract_address: str = Field(
        ...,
        max_length=64,
        description="Token contract address",
    )
    symbol: str | None = Field(
        None,
        max_length=32,
        description="Token symbol (auto-fetched if not provided)",
    )
    name: str | None = Field(
        None,
        max_length=128,
        description="Token name (auto-fetched if not provided)",
    )
    decimals: int | None = Field(
        None,
        ge=0,
        le=18,
        description="Token decimals (auto-fetched if not provided)",
    )


class AssetResponse(AssetBase):
    """Asset response schema."""

    # Frontend-required identification fields
    id: str = Field(..., description="Asset ID (stringified int PK)")
    wallet_id: str = Field(..., description="Owning wallet UUID")
    token_address: str | None = Field(None, description="Token contract address (alias for contract_address)")
    is_native: bool = Field(False, description="True for native coins (ETH/BTC)")

    balance: str = Field("0", description="Raw balance (wei/satoshi)")
    balance_formatted: str = Field("0.000000", description="Human-readable balance")
    last_synced_at: datetime | None = Field(None, description="Last balance sync time")
    created_at: datetime | None = Field(None, description="Record creation time")
    updated_at: datetime | None = Field(None, description="Last update time")
    extra: dict[str, Any] | None = Field(None, description="Chain/token-specific metadata")

    model_config = {"from_attributes": True}


class AssetSyncResponse(BaseModel):
    """Response for asset sync operation."""

    wallet_id: str
    assets: list[AssetResponse]
    synced_count: int


class AssetBalanceUpdate(BaseModel):
    """Schema for balance update."""

    balance: str = Field(..., description="New raw balance")
    last_synced_at: datetime = Field(..., description="Sync timestamp")


class TokenInfo(BaseModel):
    """Token metadata info."""

    symbol: str
    name: str
    decimals: int
    contract_address: str | None = None
    logo_url: str | None = None


class NativeCoinInfo(TokenInfo):
    """Native coin info (ETH, BTC, etc.)."""

    chain_type: str


class WalletBalance(BaseModel):
    """Aggregated wallet balance response."""

    wallet_id: str
    wallet_address: str
    chain_type: str
    native_balance: AssetResponse
    token_balances: list[AssetResponse] = []
    total_usd_value: float | None = None  # Optional USD aggregation
    last_synced_at: datetime | None = None


class BatchBalanceQuery(BaseModel):
    """Request to query balances for multiple tokens."""

    tokens: list[str] = Field(
        default_factory=list,
        description="List of token contract addresses to query (empty = native only)",
    )
    force_refresh: bool = Field(
        False,
        description="Force on-chain refresh instead of using cached values",
    )
