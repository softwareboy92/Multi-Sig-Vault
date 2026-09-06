"""Tests for TransactionSimulation model."""

import json

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.models.simulation import SimulationStatus, TransactionSimulation
from multivault.models.base import generate_uuid


@pytest.mark.asyncio
async def test_create_simulation(async_session: AsyncSession):
    """TransactionSimulation can be created and queried."""
    sim = TransactionSimulation(
        id=generate_uuid(),
        transaction_id=generate_uuid(),
        status=SimulationStatus.SUCCESS,
        chain_type="evm",
        result=json.dumps({"asset_changes": [], "gas_estimate": 21000}),
        gas_used=21000,
    )
    async_session.add(sim)
    await async_session.commit()

    row = await async_session.execute(
        select(TransactionSimulation).where(
            TransactionSimulation.id == sim.id,
        ),
    )
    fetched = row.scalar_one()
    assert fetched.status == SimulationStatus.SUCCESS
    assert fetched.chain_type == "evm"
    assert json.loads(fetched.result)["gas_estimate"] == 21000


@pytest.mark.asyncio
async def test_simulation_upsert(async_session: AsyncSession):
    """Simulation record can be updated in place (matching service upsert logic)."""
    tx_id = generate_uuid()

    sim = TransactionSimulation(
        id=generate_uuid(),
        transaction_id=tx_id,
        status=SimulationStatus.SUCCESS,
        chain_type="evm",
        result=json.dumps({"gas_estimate": 50000}),
        gas_used=50000,
    )
    async_session.add(sim)
    await async_session.commit()

    # Update in place (same pattern as SimulationService._upsert_simulation)
    row = await async_session.execute(
        select(TransactionSimulation).where(
            TransactionSimulation.transaction_id == tx_id,
        ),
    )
    existing = row.scalar_one()
    existing.status = SimulationStatus.FAILURE
    existing.result = json.dumps({"revert_reason": "insufficient balance"})
    existing.error_message = "insufficient balance"
    existing.gas_used = None
    await async_session.commit()

    rows = await async_session.execute(
        select(TransactionSimulation).where(
            TransactionSimulation.transaction_id == tx_id,
        ),
    )
    results = rows.scalars().all()
    assert len(results) == 1
    assert results[0].status == SimulationStatus.FAILURE
    assert results[0].error_message == "insufficient balance"
