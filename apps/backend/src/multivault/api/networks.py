"""Unified network configuration API endpoints.

Replaces the per-chain EVM/BTC network endpoints with a single set of
parameterized endpoints using ``{chain_type}`` in the path.  The old
paths ``/networks/evm/...`` and ``/networks/btc/...`` naturally map to
the new ``/networks/{chain_type}/...`` route pattern.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.deps import get_db
from multivault.errors.exceptions import NotFoundError, ValidationError
from multivault.schemas.common import ApiResponse
from multivault.schemas.network import (
    NetworkCreate,
    NetworkResponse,
    NetworkTestRequest,
    NetworkTestResponse,
    NetworkUpdate,
    NodeCreate,
    NodeResponse,
    NodeTestResponse,
    NodeUpdate,
    SetDefaultNodeRequest,
)
from multivault.services.network_service import NetworkService

router = APIRouter()

SUPPORTED_CHAIN_TYPES = {"EVM", "BTC", "TRON", "SOL"}


def _validate_chain_type(chain_type: str) -> str:
    """Normalize and validate chain_type path parameter."""
    ct = chain_type.upper()
    if ct not in SUPPORTED_CHAIN_TYPES:
        raise ValidationError(
            message=f"Unsupported chain type: {chain_type}",
            details={"supported": sorted(SUPPORTED_CHAIN_TYPES)},
        )
    return ct


# ============================================================================
# Node endpoints (static prefix "/nodes/..." – MUST be registered before
# the dynamic "/{chain_type}/..." routes so FastAPI matches the literal
# segment "nodes" instead of capturing it as a chain_type parameter)
# ============================================================================


@router.get("/nodes/{node_id}", response_model=ApiResponse[NodeResponse])
async def get_node(
    node_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific node."""
    service = NetworkService(db)
    node = await service.get_node(node_id)
    if not node:
        raise NotFoundError("Node", node_id)
    return ApiResponse(data=NodeResponse.model_validate(node))


@router.put("/nodes/{node_id}", response_model=ApiResponse[NodeResponse])
async def update_node(
    node_id: str,
    data: NodeUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a node."""
    service = NetworkService(db)
    node = await service.get_node(node_id)
    if not node:
        raise NotFoundError("Node", node_id)
    updated = await service.update_node(
        node=node,
        endpoint_url=data.endpoint_url,
        priority=data.priority,
        enabled=data.enabled,
        extra=data.extra,
    )
    return ApiResponse(data=NodeResponse.model_validate(updated))


@router.delete("/nodes/{node_id}", status_code=204)
async def delete_node(
    node_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a node."""
    service = NetworkService(db)
    node = await service.get_node(node_id)
    if not node:
        raise NotFoundError("Node", node_id)
    await service.delete_node(node)


@router.post("/nodes/{node_id}/test", response_model=ApiResponse[NodeTestResponse])
async def test_node(
    node_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Test node connectivity."""
    service = NetworkService(db)
    result = await service.test_node(node_id)
    return ApiResponse(
        data=NodeTestResponse(
            success=result["success"],
            latency_ms=result.get("latency_ms"),
        )
    )


# ============================================================================
# Network endpoints (dynamic "/{chain_type}/..." routes)
# ============================================================================


@router.get("/{chain_type}", response_model=ApiResponse[list[NetworkResponse]])
async def list_networks(
    chain_type: str,
    db: AsyncSession = Depends(get_db),
):
    """List all networks for a chain type."""
    ct = _validate_chain_type(chain_type)
    service = NetworkService(db)
    networks = await service.list_networks(chain_type=ct)
    return ApiResponse(data=[NetworkResponse.model_validate(n) for n in networks])


@router.post("/{chain_type}", response_model=ApiResponse[NetworkResponse], status_code=201)
async def create_network(
    chain_type: str,
    data: NetworkCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new network."""
    ct = _validate_chain_type(chain_type)
    if data.chain_type.upper() != ct:
        raise ValidationError(
            message="chain_type in body does not match URL",
            details={"url": ct, "body": data.chain_type},
        )
    service = NetworkService(db)
    network = await service.create_network(
        chain_type=ct,
        name=data.name,
        explorer_url=data.explorer_url,
        enabled=data.enabled,
        is_testnet=data.is_testnet,
        extra=data.extra,
    )
    return ApiResponse(data=NetworkResponse.model_validate(network))


@router.post("/{chain_type}/test", response_model=ApiResponse[NetworkTestResponse])
async def test_endpoint(
    chain_type: str,
    data: NetworkTestRequest,
    db: AsyncSession = Depends(get_db),
):
    """Test a network endpoint before creating a network/node."""
    ct = _validate_chain_type(chain_type)
    service = NetworkService(db)
    try:
        result = await service.validate_endpoint(
            chain_type=ct,
            node_type=data.node_type,
            endpoint_url=data.endpoint_url,
            network_extra=data.extra,
        )
        latency_ms = result.pop("latency_ms", None)
        return ApiResponse(
            data=NetworkTestResponse(
                success=True,
                latency_ms=latency_ms,
                chain_info=result,
            )
        )
    except Exception:
        return ApiResponse(data=NetworkTestResponse(success=False, chain_info=None))


@router.get("/{chain_type}/{network_id}", response_model=ApiResponse[NetworkResponse])
async def get_network(
    chain_type: str,
    network_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific network."""
    _validate_chain_type(chain_type)
    service = NetworkService(db)
    network = await service.get_network(network_id)
    if not network:
        raise NotFoundError("Network", network_id)
    return ApiResponse(data=NetworkResponse.model_validate(network))


@router.put("/{chain_type}/{network_id}", response_model=ApiResponse[NetworkResponse])
async def update_network(
    chain_type: str,
    network_id: str,
    data: NetworkUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a network."""
    _validate_chain_type(chain_type)
    service = NetworkService(db)
    network = await service.get_network(network_id)
    if not network:
        raise NotFoundError("Network", network_id)
    updated = await service.update_network(
        network=network,
        name=data.name,
        explorer_url=data.explorer_url,
        enabled=data.enabled,
        is_testnet=data.is_testnet,
        extra=data.extra,
    )
    return ApiResponse(data=NetworkResponse.model_validate(updated))


@router.delete("/{chain_type}/{network_id}", status_code=204)
async def delete_network(
    chain_type: str,
    network_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a network and its nodes."""
    _validate_chain_type(chain_type)
    service = NetworkService(db)
    network = await service.get_network(network_id)
    if not network:
        raise NotFoundError("Network", network_id)
    await service.delete_network(network)


@router.post("/{chain_type}/{network_id}/default-node", status_code=204)
async def set_default_node(
    chain_type: str,
    network_id: str,
    data: SetDefaultNodeRequest,
    db: AsyncSession = Depends(get_db),
):
    """Set the default node for a network."""
    _validate_chain_type(chain_type)
    service = NetworkService(db)
    network = await service.get_network(network_id)
    if not network:
        raise NotFoundError("Network", network_id)
    await service.set_default_node(network, data.node_id)


@router.get("/{chain_type}/{network_id}/nodes", response_model=ApiResponse[list[NodeResponse]])
async def list_nodes(
    chain_type: str,
    network_id: str,
    db: AsyncSession = Depends(get_db),
):
    """List all nodes for a network."""
    _validate_chain_type(chain_type)
    service = NetworkService(db)
    nodes = await service.list_nodes(network_id)
    return ApiResponse(data=[NodeResponse.model_validate(n) for n in nodes])


@router.post(
    "/{chain_type}/{network_id}/nodes",
    response_model=ApiResponse[NodeResponse],
    status_code=201,
)
async def create_node(
    chain_type: str,
    network_id: str,
    data: NodeCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new node for a network."""
    _validate_chain_type(chain_type)
    service = NetworkService(db)
    network = await service.get_network(network_id)
    if not network:
        raise NotFoundError("Network", network_id)
    node = await service.create_node(
        network=network,
        node_type=data.node_type,
        endpoint_url=data.endpoint_url,
        priority=data.priority,
        enabled=data.enabled,
        extra=data.extra,
    )
    return ApiResponse(data=NodeResponse.model_validate(node))
