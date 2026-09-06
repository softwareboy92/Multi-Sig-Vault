"""Integration tests for System API endpoints."""

import pytest
from httpx import AsyncClient


class TestSystemAPI:
    """Integration tests for system endpoints."""

    @pytest.mark.asyncio
    async def test_health_check(self, client: AsyncClient):
        """Test health check endpoint returns healthy status."""
        response = await client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["status"] == "healthy"
        assert "version" in data
        assert "environment" in data
        assert "timestamp" in data

    @pytest.mark.asyncio
    async def test_health_check_includes_services(self, client: AsyncClient):
        """Test health check includes service status."""
        response = await client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()["data"]
        assert "services" in data
        # Services include database, bitcoin, evm
        services = data["services"]
        assert "database" in services


class TestAPIMetadata:
    """Tests for API metadata and structure."""

    @pytest.mark.asyncio
    async def test_response_format(self, client: AsyncClient):
        """Test that API responses follow the standard format."""
        response = await client.get("/api/v1/health")
        assert response.status_code == 200
        json_data = response.json()

        # Standard response structure
        assert "data" in json_data
        assert "meta" in json_data

        # Meta includes timestamp
        assert "timestamp" in json_data["meta"]

    @pytest.mark.asyncio
    async def test_error_response_format(self, client: AsyncClient):
        """Test that error responses follow the standard format."""
        response = await client.get("/api/v1/wallets/nonexistent-wallet-id")
        assert response.status_code == 404
        json_data = response.json()

        # Error response structure
        assert "error" in json_data
        assert "code" in json_data["error"]
        assert "message" in json_data["error"]

    @pytest.mark.asyncio
    async def test_validation_error_format(self, client: AsyncClient):
        """Test validation error response format."""
        response = await client.post(
            "/api/v1/signers/challenge",
            json={},  # Missing required fields
        )
        assert response.status_code == 422
        json_data = response.json()
        assert "detail" in json_data  # FastAPI validation error format
