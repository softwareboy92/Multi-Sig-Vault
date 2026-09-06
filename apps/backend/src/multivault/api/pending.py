"""Pending actions API — aggregated view of items requiring user attention."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from multivault.deps import DbSession
from multivault.models.signer import ChainType
from multivault.models.transaction import TransactionStatus
from multivault.models.wallet import WalletStatus
from multivault.schemas.common import ApiResponse
from multivault.services.transaction_service import TransactionService
from multivault.services.wallet_service import WalletService
from multivault.services.network_service import NetworkService

router = APIRouter()


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class PendingActionItem(BaseModel):
    """A single pending-action entry for the drawer UI."""

    id: str
    action_type: str = Field(description="'pending_sign' | 'pending_broadcast' | 'pending_deploy'")
    chain_type: str
    network_name: str
    is_testnet: bool = False
    status: str

    # Wallet info (always present)
    wallet_id: str
    wallet_name: str

    # Transaction-only fields
    to_address: str | None = None
    amount: Decimal | None = None
    token_symbol: str | None = None
    token_decimals: int | None = None
    threshold: int | None = None
    signature_count: int | None = None

    # Wallet-deploy-only fields
    predicted_address: str | None = None

    created_at: datetime


class PendingActionsResponse(BaseModel):
    """Top-level response for pending actions."""

    items: list[PendingActionItem]
    total: int


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


async def get_transaction_service(db: DbSession) -> TransactionService:
    return TransactionService(db)


async def get_wallet_service(db: DbSession) -> WalletService:
    return WalletService(db)


async def get_network_service(db: DbSession) -> NetworkService:
    return NetworkService(db)


TransactionServiceDep = Annotated[TransactionService, Depends(get_transaction_service)]
WalletServiceDep = Annotated[WalletService, Depends(get_wallet_service)]
NetworkServiceDep = Annotated[NetworkService, Depends(get_network_service)]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get("/pending-actions", response_model=ApiResponse[PendingActionsResponse])
async def list_pending_actions(
    tx_svc: TransactionServiceDep,
    wallet_svc: WalletServiceDep,
    network_svc: NetworkServiceDep,
) -> ApiResponse[PendingActionsResponse]:
    """Return all items that need user attention (pending-sign txs + pending-deploy wallets).

    Replaces the N+1 frontend pattern (getWallets + getNetworks×2 + getWalletTransactions×N)
    with a single aggregated query.
    """
    from multivault.schemas.wallet import WalletQuery

    # --- Fetch pending-deploy wallets ---
    wallet_query = WalletQuery(
        status=WalletStatus.PENDING_DEPLOY,
        page=1,
        page_size=100,
    )
    wallets, _total = await wallet_svc.list_wallets(wallet_query)

    # Build network id → name lookup (only for networks we actually need)
    network_ids: set[str] = set()
    for w in wallets:
        network_ids.add(w.network_id)

    # --- Fetch pending transactions (all wallets, no N+1) ---
    pending_txs = await tx_svc.list_pending_transactions()

    # Collect wallet_ids from txs to resolve wallet names + network info
    tx_wallet_ids: set[str] = set()
    for tx in pending_txs:
        tx_wallet_ids.add(tx.wallet_id)
        # Wallet model has network_id but Transaction doesn't carry it directly;
        # we'll resolve via the wallet lookup below.

    # Bulk-fetch wallets needed for tx enrichment (skip those already loaded)
    wallet_map: dict[str, object] = {w.id: w for w in wallets}
    missing_wallet_ids = tx_wallet_ids - set(wallet_map.keys())
    if missing_wallet_ids:
        for wid in missing_wallet_ids:
            try:
                w = await wallet_svc.get_wallet(wid)
                wallet_map[w.id] = w
                network_ids.add(w.network_id)
            except Exception:
                pass  # wallet deleted / archived — skip

    # Bulk resolve network names
    for w in wallets:
        network_ids.add(w.network_id)
    network_name_map: dict[str, str] = {}
    network_is_testnet_map: dict[str, bool] = {}
    for nid in network_ids:
        try:
            net = await network_svc.get_network(nid)
            network_name_map[nid] = net.name
            network_is_testnet_map[nid] = net.is_testnet
        except Exception:
            network_name_map[nid] = "Unknown"
            network_is_testnet_map[nid] = False

    # --- Build unified items ---
    items: list[PendingActionItem] = []

    for w in wallets:
        items.append(PendingActionItem(
            id=w.id,
            action_type="pending_deploy",
            chain_type=w.chain_type.value if isinstance(w.chain_type, ChainType) else str(w.chain_type),
            network_name=network_name_map.get(w.network_id, "Unknown"),
            is_testnet=network_is_testnet_map.get(w.network_id, False),
            status=w.status.value if isinstance(w.status, WalletStatus) else str(w.status),
            wallet_id=w.id,
            wallet_name=w.name,
            predicted_address=w.address,
            created_at=w.created_at,
        ))

    from multivault.utils.extra import get_extra

    for tx in pending_txs:
        w = wallet_map.get(tx.wallet_id)
        tx_extra = get_extra(tx)
        action = (
            "pending_broadcast"
            if tx.status == TransactionStatus.SIGNED
            else "pending_sign"
        )
        items.append(PendingActionItem(
            id=tx.id,
            action_type=action,
            chain_type=w.chain_type.value if w and isinstance(w.chain_type, ChainType) else (str(w.chain_type) if w else ""),
            network_name=network_name_map.get(w.network_id, "Unknown") if w else "Unknown",
            is_testnet=network_is_testnet_map.get(w.network_id, False) if w else False,
            status=tx.status.value if isinstance(tx.status, TransactionStatus) else str(tx.status),
            wallet_id=tx.wallet_id,
            wallet_name=w.name if w else "Unknown",
            to_address=tx.to_address,
            amount=tx.amount,
            token_symbol=tx_extra.get("token_symbol"),
            token_decimals=tx_extra.get("token_decimals"),
            threshold=tx.threshold,
            signature_count=tx.signature_count,
            created_at=tx.created_at,
        ))

    # Sort descending by created_at
    items.sort(key=lambda x: x.created_at, reverse=True)

    return ApiResponse(data=PendingActionsResponse(items=items, total=len(items)))
