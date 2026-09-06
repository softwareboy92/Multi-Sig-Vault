"""Tests for system API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    """Test health check endpoint returns healthy status."""
    response = await client.get("/api/v1/health")

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert data["data"]["status"] == "healthy"
    assert "version" in data["data"]
    assert "environment" in data["data"]
    assert "timestamp" in data["data"]
    assert "services" in data["data"]


@pytest.mark.asyncio
async def test_get_supported_chains(client: AsyncClient):
    """Test supported chains endpoint returns chain configurations."""
    response = await client.get("/api/v1/chains")

    assert response.status_code == 200

    data = response.json()
    assert data["success"] is True
    assert "chains" in data["data"]

    chains = data["data"]["chains"]
    assert len(chains) == 0
