"""Tests for price API endpoint."""

import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
class TestBatchPriceEndpoint:
    async def test_batch_price_success(self, client):
        """POST /api/v1/prices/batch returns prices."""
        mock_result = (
            {"ETH": {"usd": 3200.5, "confidence": 0.99, "updated_at": "2026-02-16T10:00:00Z"}},
            False,
        )
        with patch(
            "multivault.api.prices._price_service.fetch_prices",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            resp = await client.post("/api/v1/prices/batch", json={
                "assets": [
                    {"chain_type": "EVM", "chain_id": 1, "symbol": "ETH"},
                ],
            })
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert "ETH" in body["data"]["prices"]
        assert body["data"]["prices"]["ETH"]["usd"] == 3200.5
        assert body["data"]["currency"] == "USD"
        assert body["data"]["stale"] is False

    async def test_batch_price_stale_propagation(self, client):
        """POST /api/v1/prices/batch propagates stale=True from service."""
        mock_result = (
            {"ETH": {"usd": 3100.0, "confidence": 0.95, "updated_at": "old"}},
            True,
        )
        with patch(
            "multivault.api.prices._price_service.fetch_prices",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            resp = await client.post("/api/v1/prices/batch", json={
                "assets": [
                    {"chain_type": "EVM", "chain_id": 1, "symbol": "ETH"},
                ],
            })
        assert resp.status_code == 200
        body = resp.json()
        assert body["data"]["stale"] is True

    async def test_batch_price_empty_assets(self, client):
        """POST with empty assets list returns 422."""
        resp = await client.post("/api/v1/prices/batch", json={"assets": []})
        assert resp.status_code == 422

    async def test_batch_price_fetch_error(self, client):
        """On internal error, returns empty prices."""
        with patch(
            "multivault.api.prices._price_service.fetch_prices",
            new_callable=AsyncMock,
            return_value=({}, False),
        ):
            resp = await client.post("/api/v1/prices/batch", json={
                "assets": [
                    {"chain_type": "EVM", "chain_id": 1, "symbol": "ETH"},
                ],
            })
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["prices"] == {}
