"""API endpoints for transaction simulation."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path

from multivault.deps import DbSession
from multivault.schemas.common import ApiResponse
from multivault.schemas.simulation import (
    SimulationConfigResponse,
    SimulationConfigUpdate,
    SimulationResponse,
)
from multivault.services.simulation_config_service import SimulationConfigService
from multivault.services.simulation_service import SimulationService

router = APIRouter()


async def get_simulation_service(db: DbSession) -> SimulationService:
    return SimulationService(db)


SimulationServiceDep = Annotated[
    SimulationService, Depends(get_simulation_service),
]


@router.get("/config", response_model=ApiResponse[SimulationConfigResponse])
async def get_simulation_config(
    service: SimulationServiceDep,
) -> ApiResponse[SimulationConfigResponse]:
    """Check whether transaction simulation is configured."""
    credentials = await service.get_configuration()
    return ApiResponse(
        data=SimulationConfigResponse(
            configured=credentials.configured,
            enabled=credentials.enabled,
            source=credentials.source,
            access_key_set=bool(credentials.access_key),
            account_slug=credentials.account_slug,
            project_slug=credentials.project_slug,
        ),
    )


@router.put("/config", response_model=ApiResponse[SimulationConfigResponse])
async def update_simulation_config(
    request: SimulationConfigUpdate,
) -> ApiResponse[SimulationConfigResponse]:
    """Save encrypted Tenderly configuration from the security settings UI."""
    credentials = SimulationConfigService().save(
        access_key=request.access_key,
        account_slug=request.account_slug,
        project_slug=request.project_slug,
        enabled=request.enabled,
    )
    return ApiResponse(
        data=SimulationConfigResponse(
            configured=credentials.configured,
            enabled=credentials.enabled,
            source=credentials.source,
            access_key_set=bool(credentials.access_key),
            account_slug=credentials.account_slug,
            project_slug=credentials.project_slug,
        ),
    )


@router.post(
    "/transactions/{transaction_id}/simulate",
    response_model=ApiResponse[SimulationResponse],
)
async def simulate_transaction(
    transaction_id: str = Path(..., description="Transaction UUID"),
    service: SimulationServiceDep = ...,
) -> ApiResponse[SimulationResponse]:
    """Trigger simulation for an EVM Safe transaction.

    Calls Tenderly Simulation API and persists the result.
    Can be called multiple times -- each call overwrites the previous result.
    """
    simulation = await service.simulate_transaction(transaction_id)
    return ApiResponse(data=SimulationResponse.from_orm(simulation))


@router.get(
    "/transactions/{transaction_id}/simulation",
    response_model=ApiResponse[SimulationResponse | None],
)
async def get_simulation(
    transaction_id: str = Path(..., description="Transaction UUID"),
    service: SimulationServiceDep = ...,
) -> ApiResponse[SimulationResponse | None]:
    """Get existing simulation result for a transaction.

    Returns null data if no simulation has been run yet.
    """
    simulation = await service.get_simulation(transaction_id)
    if simulation is None:
        return ApiResponse(data=None)
    return ApiResponse(data=SimulationResponse.from_orm(simulation))
