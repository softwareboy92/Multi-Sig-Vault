"""Unified network configuration schemas.

Replaces the per-chain schemas (EVM/BTC) with a single set of
``NetworkCreate`` / ``NetworkResponse`` / ``NodeCreate`` / ``NodeResponse``
classes that work for any chain type.
"""

import json
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


# ============================================================================
# Network Schemas
# ============================================================================


class NetworkCreate(BaseModel):
    """Create a new network."""

    chain_type: str = Field(..., description="Chain type: BTC / EVM / TRON / SOL")
    name: str = Field(..., min_length=1, max_length=100)
    explorer_url: str | None = Field(None, max_length=500)
    enabled: bool = True
    is_testnet: bool = False
    extra: dict | None = Field(None, description="Chain-specific metadata")


class NetworkUpdate(BaseModel):
    """Update network metadata (chain_type immutable)."""

    name: str = Field(..., min_length=1, max_length=100)
    explorer_url: str | None = Field(None, max_length=500)
    enabled: bool = True
    is_testnet: bool = False
    extra: dict | None = Field(None, description="Chain-specific metadata")


class NetworkResponse(BaseModel):
    """Network detail response."""

    id: str
    chain_type: str
    name: str
    explorer_url: str | None
    enabled: bool
    is_testnet: bool
    default_node_id: str | None
    extra: dict | None = None
    created_at: datetime
    updated_at: datetime

    # Convenience fields extracted from extra
    chain_id: int | None = None
    btc_network: str | None = None

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _extract_extra_fields(cls, data: object) -> object:
        """Extract convenience fields from extra JSON."""
        # Handle both dict input and ORM objects
        if hasattr(data, "__dict__"):
            # ORM model – read extra from attribute
            raw_extra = getattr(data, "extra", None)
        elif isinstance(data, dict):
            raw_extra = data.get("extra")
        else:
            return data

        if raw_extra is None:
            return data

        extra = raw_extra if isinstance(raw_extra, dict) else json.loads(raw_extra)

        # Populate convenience fields into the dict representation
        if hasattr(data, "__dict__"):
            # ORM model: convert to dict for Pydantic
            d = {
                key: getattr(data, key)
                for key in (
                    "id",
                    "chain_type",
                    "name",
                    "explorer_url",
                    "enabled",
                    "is_testnet",
                    "default_node_id",
                    "created_at",
                    "updated_at",
                )
            }
            d["extra"] = extra
            d["chain_id"] = extra.get("chain_id")
            d["btc_network"] = extra.get("btc_network")
            return d
        else:
            data = dict(data) if not isinstance(data, dict) else data
            if isinstance(data.get("extra"), str):
                data["extra"] = extra
            data.setdefault("chain_id", extra.get("chain_id"))
            data.setdefault("btc_network", extra.get("btc_network"))
            return data


class NetworkTestRequest(BaseModel):
    """Test a network endpoint (pre-create validation)."""

    chain_type: str
    endpoint_url: str = Field(..., min_length=1, max_length=500)
    node_type: str = Field("JSON_RPC")
    extra: dict | None = None


class NetworkTestResponse(BaseModel):
    """Network endpoint test result."""

    success: bool
    latency_ms: float | None = Field(None, description="Round-trip latency in milliseconds")
    chain_info: dict | None = None


# ============================================================================
# Node Schemas
# ============================================================================


class NodeCreate(BaseModel):
    """Create a network node."""

    node_type: str = Field(
        ..., description="Node connection type: JSON_RPC / ELECTRUM / GRPC / WEBSOCKET"
    )
    endpoint_url: str = Field(..., min_length=1, max_length=500)
    priority: int = Field(100, ge=0, le=1000)
    enabled: bool = True
    extra: dict | None = None


class NodeUpdate(BaseModel):
    """Update a network node."""

    endpoint_url: str = Field(..., min_length=1, max_length=500)
    priority: int = Field(100, ge=0, le=1000)
    enabled: bool = True
    extra: dict | None = None


class NodeResponse(BaseModel):
    """Network node detail response."""

    id: str
    network_id: str
    node_type: str
    endpoint_url: str
    priority: int
    enabled: bool
    is_healthy: bool
    last_health_check: datetime | None
    extra: dict | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _parse_extra(cls, data: object) -> object:
        """Parse extra JSON string from ORM model."""
        if hasattr(data, "__dict__"):
            raw = getattr(data, "extra", None)
            d = {
                key: getattr(data, key)
                for key in (
                    "id",
                    "network_id",
                    "node_type",
                    "endpoint_url",
                    "priority",
                    "enabled",
                    "is_healthy",
                    "last_health_check",
                    "created_at",
                    "updated_at",
                )
            }
            d["extra"] = json.loads(raw) if isinstance(raw, str) else raw
            return d
        elif isinstance(data, dict):
            raw = data.get("extra")
            if isinstance(raw, str):
                data["extra"] = json.loads(raw)
            return data
        return data


class NodeTestResponse(BaseModel):
    """Node connectivity test result."""

    success: bool
    latency_ms: float | None = Field(None, description="Round-trip latency in milliseconds")


class SetDefaultNodeRequest(BaseModel):
    """Set default node for a network."""

    node_id: str
