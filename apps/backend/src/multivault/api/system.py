"""System API endpoints (health check, configuration)."""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from multivault.config import get_settings
from multivault.schemas.common import ApiResponse

router = APIRouter()


def _utc_now() -> datetime:
    """Get current UTC datetime (timezone-aware)."""
    return datetime.now(UTC)


class HealthStatus(BaseModel):
    """Health check response."""

    status: Literal["healthy", "degraded", "unhealthy"] = "healthy"
    version: str
    environment: str
    timestamp: datetime = Field(default_factory=_utc_now)
    services: dict[str, Literal["up", "down"]] = Field(default_factory=dict)


class ChainConfig(BaseModel):
    """Chain configuration info."""

    chain_id: str
    name: str
    enabled: bool
    network: str
    rpc_endpoint: str | None = None


class SupportedChains(BaseModel):
    """Supported chains response."""

    chains: list[ChainConfig]


@router.get("/health", response_model=ApiResponse[HealthStatus])
async def health_check() -> ApiResponse[HealthStatus]:
    """Check service health status.

    Returns the current health status of the service and its dependencies.
    """
    settings = get_settings()

    status = HealthStatus(
        status="healthy",
        version=settings.app_version,
        environment=settings.environment,
        services={
            "database": "up",
            "bitcoin": "up",  # TODO: actual health check
            "evm": "up",  # TODO: actual health check
        },
    )

    return ApiResponse(data=status)


@router.get("/chains", response_model=ApiResponse[SupportedChains])
async def get_supported_chains() -> ApiResponse[SupportedChains]:
    """Get list of supported chains.

    Returns configuration for all supported blockchain networks.
    """
    settings = get_settings()

    # Chain configurations are now stored in database
    # Use /api/v1/networks/evm and /api/v1/networks/btc to query configurations
    chains = SupportedChains(chains=[])
    return ApiResponse(data=chains)
