"""Asset API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path

from multivault.deps import DbSession
from multivault.schemas.asset import AssetCreate, AssetResponse, AssetSyncResponse
from multivault.schemas.common import ApiResponse
from multivault.services.asset_service import AssetService

router = APIRouter()


async def get_asset_service(db: DbSession) -> AssetService:
    """Dependency to get asset service."""
    return AssetService(db)


AssetServiceDep = Annotated[AssetService, Depends(get_asset_service)]


@router.get("/{wallet_id}/assets", response_model=ApiResponse[list[AssetResponse]])
async def get_wallet_assets(
    wallet_id: str = Path(..., description="Wallet UUID"),
    service: AssetServiceDep = ...,
) -> ApiResponse[list[AssetResponse]]:
    """Get all assets for a wallet.

    Returns cached balance data. Call POST /sync to refresh.
    """
    assets = await service.get_wallet_assets(wallet_id)

    items = [
        AssetResponse(
            id=str(a.id),
            wallet_id=a.wallet_id,
            token_address=a.contract_address,
            is_native=a.contract_address is None,
            symbol=a.symbol,
            name=a.name,
            contract_address=a.contract_address,
            decimals=a.decimals,
            balance=a.balance,
            balance_formatted=f"{a.balance_float:.6f}",
            last_synced_at=a.last_synced_at,
        )
        for a in assets
    ]

    return ApiResponse(data=items)


@router.post("/{wallet_id}/assets", response_model=ApiResponse[AssetResponse])
async def add_wallet_token(
    wallet_id: str = Path(..., description="Wallet UUID"),
    body: AssetCreate = ...,
    service: AssetServiceDep = ...,
) -> ApiResponse[AssetResponse]:
    """Add an ERC20 token to wallet's asset list.

    Token info (symbol, name, decimals) will be auto-fetched from chain if not provided.
    """
    asset = await service.add_token(
        wallet_id=wallet_id,
        contract_address=body.contract_address,
        symbol=body.symbol if body.symbol else None,
        name=body.name if body.name else None,
        decimals=body.decimals if body.decimals != 18 else None,
    )

    return ApiResponse(
        data=AssetResponse(
            id=str(asset.id),
            wallet_id=asset.wallet_id,
            token_address=asset.contract_address,
            is_native=asset.contract_address is None,
            symbol=asset.symbol,
            name=asset.name,
            contract_address=asset.contract_address,
            decimals=asset.decimals,
            balance=asset.balance,
            balance_formatted=f"{asset.balance_float:.6f}",
            last_synced_at=asset.last_synced_at,
        )
    )


@router.post("/{wallet_id}/assets/sync", response_model=ApiResponse[AssetSyncResponse])
async def sync_wallet_assets(
    wallet_id: str = Path(..., description="Wallet UUID"),
    service: AssetServiceDep = ...,
) -> ApiResponse[AssetSyncResponse]:
    """Sync assets for a wallet from blockchain.

    Queries the blockchain for current balances and updates the database.
    """
    assets = await service.sync_wallet_assets(wallet_id)

    items = [
        AssetResponse(
            id=str(a.id),
            wallet_id=a.wallet_id,
            token_address=a.contract_address,
            is_native=a.contract_address is None,
            symbol=a.symbol,
            name=a.name,
            contract_address=a.contract_address,
            decimals=a.decimals,
            balance=a.balance,
            balance_formatted=f"{a.balance_float:.6f}",
            last_synced_at=a.last_synced_at,
        )
        for a in assets
    ]

    return ApiResponse(
        data=AssetSyncResponse(
            wallet_id=wallet_id,
            assets=items,
            synced_count=len(items),
        )
    )
