"""Tests for simulation API endpoints."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from multivault.models.simulation import SimulationStatus


@pytest.mark.asyncio
async def test_get_simulation_config(client: AsyncClient):
    """GET /simulation/config returns configured status."""
    with patch(
        "multivault.api.simulation.SimulationService.get_configuration",
        new_callable=AsyncMock,
        return_value=SimpleNamespace(
            configured=False,
            enabled=False,
            source="none",
            access_key="",
            account_slug="",
            project_slug="",
        ),
    ):
        response = await client.get("/api/v1/simulation/config")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "configured" in data["data"]
    assert data["data"]["configured"] is False
    assert data["data"]["access_key_set"] is False


@pytest.mark.asyncio
async def test_get_simulation_nonexistent(client: AsyncClient):
    """GET /simulation/transactions/{id}/simulation returns null for missing."""
    response = await client.get(
        "/api/v1/simulation/transactions/nonexistent-id/simulation",
    )
    assert response.status_code == 200
    data = response.json()
    assert data["data"] is None


@pytest.mark.asyncio
async def test_simulate_tenderly_not_configured(client: AsyncClient):
    """POST /simulate returns error when Tenderly not configured."""
    with patch(
        "multivault.services.simulation_service.SimulationConfigService.get_credentials",
        return_value=SimpleNamespace(configured=False),
    ):
        response = await client.post(
            "/api/v1/simulation/transactions/some-id/simulate",
        )
    # Global exception handler maps ValidationError to 400
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_update_simulation_config_never_returns_api_key(client: AsyncClient):
    """PUT /simulation/config returns only masked credential state."""
    saved = SimpleNamespace(
        configured=True,
        enabled=True,
        source="settings",
        access_key="secret-key",
        account_slug="account",
        project_slug="project",
    )
    with patch(
        "multivault.api.simulation.SimulationConfigService.save",
        return_value=saved,
    ):
        response = await client.put(
            "/api/v1/simulation/config",
            json={
                "enabled": True,
                "access_key": "secret-key",
                "account_slug": "account",
                "project_slug": "project",
            },
        )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["configured"] is True
    assert data["access_key_set"] is True
    assert "access_key" not in data


@pytest.mark.asyncio
async def test_simulate_success(client: AsyncClient):
    """POST /simulate returns full simulation response on success."""
    now = datetime.now(UTC)
    mock_sim = SimpleNamespace(
        id="sim-001",
        transaction_id="tx-001",
        status=SimulationStatus.SUCCESS,
        chain_type="evm",
        result='{"gas_estimate": 21000, "success": true}',
        error_message=None,
        gas_used=21000,
        created_at=now,
        updated_at=now,
    )

    with patch(
        "multivault.api.simulation.SimulationService.simulate_transaction",
        new_callable=AsyncMock,
        return_value=mock_sim,
    ):
        response = await client.post(
            "/api/v1/simulation/transactions/tx-001/simulate",
        )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True

    data = body["data"]
    assert data["id"] == "sim-001"
    assert data["transaction_id"] == "tx-001"
    assert data["status"] == "SUCCESS"
    assert data["chain_type"] == "evm"
    assert data["result"] == {"gas_estimate": 21000, "success": True}
    assert data["error_message"] is None
    assert data["gas_used"] == 21000
    assert data["created_at"] == now.isoformat()
    assert data["updated_at"] == now.isoformat()
