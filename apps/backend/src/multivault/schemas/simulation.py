"""Schemas for transaction simulation."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

from multivault.models.simulation import SimulationStatus


class SimulationResponse(BaseModel):
    """Response for a simulation result."""

    id: str
    transaction_id: str
    status: SimulationStatus
    chain_type: str
    result: dict[str, Any] = Field(description="Structured simulation result")
    error_message: str | None = None
    gas_used: int | None = None
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm(cls, sim) -> SimulationResponse:
        result_dict = {}
        if sim.result:
            try:
                result_dict = json.loads(sim.result)
            except (json.JSONDecodeError, TypeError):
                result_dict = {}

        return cls(
            id=sim.id,
            transaction_id=sim.transaction_id,
            status=sim.status,
            chain_type=sim.chain_type,
            result=result_dict,
            error_message=sim.error_message,
            gas_used=sim.gas_used,
            created_at=sim.created_at.isoformat() if sim.created_at else "",
            updated_at=sim.updated_at.isoformat() if sim.updated_at else "",
        )


class SimulationConfigResponse(BaseModel):
    """Response for simulation configuration status."""

    configured: bool = Field(description="Whether Tenderly API is configured")
    enabled: bool = Field(description="Whether transaction simulation is enabled")
    source: str = Field(description="Configuration source: settings, environment, or none")
    access_key_set: bool = Field(description="Whether an API key is stored")
    account_slug: str = Field(default="", description="Tenderly account slug")
    project_slug: str = Field(default="", description="Tenderly project slug")


class SimulationConfigUpdate(BaseModel):
    """User-editable Tenderly security settings."""

    enabled: bool = True
    access_key: str | None = Field(
        default=None,
        max_length=512,
        description="Tenderly API key; omit or leave blank to preserve the existing key",
    )
    account_slug: str = Field(default="", max_length=200)
    project_slug: str = Field(default="", max_length=200)
