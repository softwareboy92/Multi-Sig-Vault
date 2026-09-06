"""Wallet API endpoints."""

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from multivault.deps import DbSession
from multivault.models.signer import ChainType
from multivault.models.wallet import WalletStatus
from multivault.schemas.common import ApiResponse, PaginatedResponse, PaginationMeta
from multivault.schemas.signer import ChainTypeEnum
from multivault.schemas.transaction import (
    BTCHistoryImportRequest,
    BTCHistoryImportResponse,
    EVMHistoryImportRequest,
    EVMHistoryImportResponse,
)
from multivault.schemas.wallet import (
    BtcImportPreview,
    SafeDeploymentInfoResponse,
    UpdateSignerHmacRequest,
    WalletActivateRequest,
    WalletCreate,
    WalletImport,
    WalletListItem,
    WalletQuery,
    WalletResponse,
    WalletSignerResponse,
    WalletUpdate,
)
from multivault.services.network_service import NetworkService
from multivault.services.transaction_service import TransactionService
from multivault.services.wallet_service import WalletService
from multivault.errors.exceptions import ValidationError

router = APIRouter()


async def get_wallet_service(db: DbSession) -> WalletService:
    """Dependency to get wallet service."""
    return WalletService(db)


async def get_network_service(db: DbSession) -> NetworkService:
    """Dependency to get network service."""
    return NetworkService(db)


async def get_transaction_service(db: DbSession) -> TransactionService:
    """Dependency to get transaction service."""
    return TransactionService(db)


WalletServiceDep = Annotated[WalletService, Depends(get_wallet_service)]
NetworkServiceDep = Annotated[NetworkService, Depends(get_network_service)]
TransactionServiceDep = Annotated[TransactionService, Depends(get_transaction_service)]


def _wallet_to_response(wallet) -> WalletResponse:
    """Convert wallet model to response schema."""
    from multivault.utils.extra import get_extra, get_extra_field

    signers = []
    for ws in wallet.wallet_signers:
        # Handle both enum and string values from SQLite
        device_type = ws.signer.device_type
        if hasattr(device_type, "value"):
            device_type = device_type.value

        signer_status = ws.signer.status
        if hasattr(signer_status, "value"):
            signer_status = signer_status.value

        signer_extra = get_extra(ws.signer)
        ws_extra = get_extra(ws)

        signers.append(
            WalletSignerResponse(
                id=ws.signer.id,
                name=ws.signer.name,
                device_type=device_type,
                status=signer_status,
                address=ws.signer.address,
                public_key=ws.signer.public_key,
                derivation_path=ws.signer.derivation_path,
                master_fingerprint=signer_extra.get("master_fingerprint"),
                xpub=signer_extra.get("xpub"),
                ledger_policy_hmac=ws_extra.get("ledger_policy_hmac"),
                order_index=ws.order_index,
            )
        )

    wallet_extra = get_extra(wallet)

    verified_count = sum(
        1 for s in signers if s.status == "VERIFIED"
    )

    return WalletResponse(
        id=wallet.id,
        name=wallet.name,
        chain_type=wallet.chain_type,
        threshold=wallet.threshold,
        signer_count=wallet.signer_count,
        verified_signer_count=verified_count,
        address=wallet.address,
        status=wallet.status,
        source=wallet.source,
        deployed_at=wallet.deployed_at,
        extra=wallet_extra or None,
        salt=wallet_extra.get("salt"),
        deployment_tx_hash=wallet_extra.get("deployment_tx_hash"),
        factory_address=wallet_extra.get("factory_address"),
        witness_script=wallet_extra.get("witness_script"),
        redeem_script=wallet_extra.get("redeem_script"),
        network_id=wallet.network_id,
        created_at=wallet.created_at,
        updated_at=wallet.updated_at,
        signers=signers,
    )


@router.get(
    "/safe-info",
    response_model=ApiResponse,
    summary="Query Safe contract info from chain",
)
async def get_safe_info_from_chain(
    address: str = Query(..., description="Safe contract address"),
    network_id: str = Query(..., description="EVM network ID"),
    db: DbSession = None,
) -> ApiResponse:
    """Preview Safe info before import. Returns owners, threshold, nonce."""
    network_service = NetworkService(db)
    network = await network_service.get_network(network_id)
    if not network:
        raise ValidationError(
            message="Network not found",
            details={"network_id": network_id},
        )
    if network.chain_type != "EVM":
        raise ValidationError(
            message="Network is not EVM type",
            details={"chain_type": network.chain_type},
        )

    node = await network_service.get_default_node(network_id)
    rpc_url = node.endpoint_url if node else None
    if not rpc_url:
        raise ValidationError(
            message="No RPC URL configured for network",
            details={"network_id": network_id},
        )

    from multivault.chains.evm.adapter import EVMAdapter

    adapter = EVMAdapter(rpc_url=rpc_url)
    await adapter.connect()

    try:
        is_deployed = await adapter.is_deployed(address)
        if not is_deployed:
            raise ValidationError(
                message="Safe contract not deployed at address",
                details={"address": address},
            )

        safe_info = await adapter.get_safe_info(address)
    finally:
        await adapter.disconnect()

    return ApiResponse(data={
        "address": safe_info["address"],
        "owners": safe_info["owners"],
        "threshold": safe_info["threshold"],
        "nonce": safe_info["nonce"],
        "is_deployed": True,
    })


@router.post(
    "/btc-preview",
    response_model=ApiResponse,
    summary="Preview/verify BTC multisig import",
)
async def preview_btc_import(
    data: BtcImportPreview,
    service: WalletServiceDep,
) -> ApiResponse:
    """Verify BTC multisig params without creating wallet.

    Manual mode: re-derives P2WSH address from pubkeys + threshold.
    Auto mode: extracts multisig params from spending tx on chain.
    Returns verified address, sorted public keys, threshold, witness script.
    """
    result = await service.preview_btc_import(data)
    return ApiResponse(data=result)


@router.post(
    "/import",
    response_model=ApiResponse[WalletResponse],
    status_code=201,
    summary="Import existing multisig wallet",
)
async def import_wallet(
    data: WalletImport,
    service: WalletServiceDep,
) -> ApiResponse[WalletResponse]:
    """Import an existing multisig wallet from chain.

    EVM: reads Safe contract on-chain data (owners, threshold).
    BTC: verifies address from pubkeys or auto-extracts from spending tx.
    """
    wallet = await service.import_wallet(data)
    return ApiResponse(data=_wallet_to_response(wallet))


@router.post("", response_model=ApiResponse[WalletResponse])
async def create_wallet(
    request: WalletCreate,
    service: WalletServiceDep,
) -> ApiResponse[WalletResponse]:
    """Create a new multisig wallet.

    All signers must be verified and belong to the same chain type.
    Threshold must be <= number of signers.
    """
    wallet = await service.create_wallet(request)
    return ApiResponse(data=_wallet_to_response(wallet))


@router.get("", response_model=PaginatedResponse[WalletListItem])
async def list_wallets(
    service: WalletServiceDep,
    chain_type: ChainTypeEnum | None = Query(None, description="Filter by chain type"),
    status: WalletStatus | None = Query(None, description="Filter by status"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> PaginatedResponse[WalletListItem]:
    """List wallets with optional filtering and pagination."""
    query = WalletQuery(
        chain_type=chain_type,
        status=status,
        page=page,
        page_size=page_size,
    )
    wallets, total = await service.list_wallets(query)

    items = []
    for w in wallets:
        verified = 0
        if hasattr(w, "wallet_signers") and w.wallet_signers:
            for ws in w.wallet_signers:
                st = ws.signer.status
                if hasattr(st, "value"):
                    st = st.value
                if st == "VERIFIED":
                    verified += 1
        items.append(
            WalletListItem(
                id=w.id,
                name=w.name,
                chain_type=w.chain_type,
                threshold=w.threshold,
                signer_count=w.signer_count,
                verified_signer_count=verified,
                address=w.address,
                status=w.status,
                network_id=w.network_id,
                created_at=w.created_at,
            )
        )

    total_pages = (total + page_size - 1) // page_size

    return PaginatedResponse(
        data=items,
        pagination=PaginationMeta(
            page=page,
            page_size=page_size,
            total=total,
            total_pages=total_pages,
        ),
    )


@router.get("/{wallet_id}", response_model=ApiResponse[WalletResponse])
async def get_wallet(
    wallet_id: str,
    service: WalletServiceDep,
    tx_service: TransactionServiceDep,
) -> ApiResponse[WalletResponse]:
    """Get wallet details with signer information."""
    wallet = await service.get_wallet(wallet_id)
    resp = _wallet_to_response(wallet)

    # For BTC wallets, annotate each cached UTXO with locked status
    if (
        wallet.chain_type == "BTC"
        and resp.extra
        and resp.extra.get("utxos")
    ):
        locked_set = await tx_service.get_locked_utxo_outpoints(wallet_id)
        for utxo in resp.extra["utxos"]:
            utxo["locked"] = (utxo["txid"], utxo["vout"]) in locked_set

    return ApiResponse(data=resp)


@router.patch("/{wallet_id}", response_model=ApiResponse[WalletResponse])
async def update_wallet(
    wallet_id: str,
    request: WalletUpdate,
    service: WalletServiceDep,
) -> ApiResponse[WalletResponse]:
    """Update wallet name."""
    wallet = await service.update_wallet(wallet_id, request)
    return ApiResponse(data=_wallet_to_response(wallet))


@router.delete("/{wallet_id}", response_model=ApiResponse[WalletResponse])
async def archive_wallet(
    wallet_id: str,
    service: WalletServiceDep,
) -> ApiResponse[WalletResponse]:
    """Archive (soft delete) a wallet.

    Archived wallets are not returned in list queries.
    This operation can be reversed by updating the wallet status.
    """
    wallet = await service.archive_wallet(wallet_id)
    return ApiResponse(data=_wallet_to_response(wallet))


@router.get("/{wallet_id}/signers", response_model=ApiResponse[list[WalletSignerResponse]])
async def get_wallet_signers(
    wallet_id: str,
    service: WalletServiceDep,
) -> ApiResponse[list[WalletSignerResponse]]:
    """Get ordered list of signers for a wallet."""
    from multivault.utils.extra import get_extra

    wallet = await service.get_wallet(wallet_id)
    signers = []
    for ws in wallet.wallet_signers:
        device_type = ws.signer.device_type
        if hasattr(device_type, "value"):
            device_type = device_type.value

        signer_status = ws.signer.status
        if hasattr(signer_status, "value"):
            signer_status = signer_status.value

        signer_extra = get_extra(ws.signer)
        ws_extra = get_extra(ws)

        signers.append(
            WalletSignerResponse(
                id=ws.signer.id,
                name=ws.signer.name,
                device_type=device_type,
                status=signer_status,
                address=ws.signer.address,
                public_key=ws.signer.public_key,
                derivation_path=ws.signer.derivation_path,
                master_fingerprint=signer_extra.get("master_fingerprint"),
                xpub=signer_extra.get("xpub"),
                ledger_policy_hmac=ws_extra.get("ledger_policy_hmac"),
                order_index=ws.order_index,
            )
        )
    return ApiResponse(data=signers)


@router.post(
    "/{wallet_id}/btc/history/import",
    response_model=ApiResponse[BTCHistoryImportResponse],
)
async def import_btc_history(
    wallet_id: str,
    request: BTCHistoryImportRequest,
    wallet_service: WalletServiceDep,
    network_service: NetworkServiceDep,
    tx_service: TransactionServiceDep,
) -> ApiResponse[BTCHistoryImportResponse]:
    """Import BTC address history into transactions table (read-only records)."""
    wallet = await wallet_service.get_wallet(wallet_id)

    chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)
    if chain_type != ChainType.BTC.value:
        raise ValidationError(
            message="Wallet is not BTC",
            details={"wallet_id": wallet_id, "chain_type": chain_type},
        )

    if not wallet.network_id:
        raise ValidationError(
            message="Network ID not configured for wallet",
            details={"wallet_id": wallet_id},
        )

    btc_network = await network_service.get_network(wallet.network_id)
    if not btc_network or not btc_network.enabled:
        raise ValidationError(
            message="BTC network not found or disabled",
            details={"network_id": wallet.network_id},
        )

    btc_node = await network_service.get_default_node(btc_network.id)
    if not btc_node:
        raise ValidationError(
            message="No default BTC node configured",
            details={"network_id": btc_network.id},
        )

    result = await tx_service.import_btc_history(
        wallet=wallet,
        btc_network=btc_network,
        btc_node=btc_node,
        limit=request.limit,
        confirmed_only=request.confirmed_only,
    )
    return ApiResponse(data=result)


@router.post(
    "/{wallet_id}/evm/history/import",
    response_model=ApiResponse[EVMHistoryImportResponse],
)
async def import_evm_safe_history(
    wallet_id: str,
    request: EVMHistoryImportRequest,
    wallet_service: WalletServiceDep,
    network_service: NetworkServiceDep,
    tx_service: TransactionServiceDep,
) -> ApiResponse[EVMHistoryImportResponse]:
    """Import EVM Safe wallet transaction history from Safe Transaction Service."""
    wallet = await wallet_service.get_wallet(wallet_id)

    chain_type = wallet.chain_type.value if hasattr(wallet.chain_type, "value") else str(wallet.chain_type)
    if chain_type != ChainType.EVM.value:
        raise ValidationError(
            message="Wallet is not EVM",
            details={"wallet_id": wallet_id, "chain_type": chain_type},
        )

    if not wallet.network_id:
        raise ValidationError(
            message="Network ID not configured for wallet",
            details={"wallet_id": wallet_id},
        )

    network = await network_service.get_network(wallet.network_id)
    if not network or not network.enabled:
        raise ValidationError(
            message="Network not found or disabled",
            details={"network_id": wallet.network_id},
        )

    extra = json.loads(network.extra) if isinstance(network.extra, str) else (network.extra or {})
    chain_id = extra.get("chain_id")
    if not chain_id:
        raise ValidationError(
            message="Network missing chain_id in extra config",
            details={"network_id": network.id},
        )

    rpc_url = extra.get("rpc_url")

    result = await tx_service.import_evm_safe_history(
        wallet=wallet,
        chain_id=chain_id,
        limit=request.limit,
        include_incoming=request.include_incoming,
        rpc_url=rpc_url,
    )
    return ApiResponse(data=result)


@router.patch(
    "/{wallet_id}/signers/{signer_id}/hmac",
    response_model=ApiResponse[WalletSignerResponse],
)
async def update_signer_hmac(
    wallet_id: str,
    signer_id: str,
    request: UpdateSignerHmacRequest,
    service: WalletServiceDep,
) -> ApiResponse[WalletSignerResponse]:
    """Update signer's Ledger wallet policy HMAC.

    After registering a multisig wallet policy on a Ledger device,
    the returned HMAC must be stored for future signing operations.
    This endpoint stores the HMAC for a specific signer in the wallet context.
    """
    wallet_signer = await service.update_signer_hmac(
        wallet_id=wallet_id,
        signer_id=signer_id,
        hmac=request.hmac,
    )
    device_type = wallet_signer.signer.device_type
    if hasattr(device_type, "value"):
        device_type = device_type.value

    from multivault.utils.extra import get_extra
    signer_extra = get_extra(wallet_signer.signer)
    ws_extra = get_extra(wallet_signer)

    return ApiResponse(
        data=WalletSignerResponse(
            id=wallet_signer.signer.id,
            name=wallet_signer.signer.name,
            device_type=device_type,
            address=wallet_signer.signer.address,
            public_key=wallet_signer.signer.public_key,
            derivation_path=wallet_signer.signer.derivation_path,
            master_fingerprint=signer_extra.get("master_fingerprint"),
            xpub=signer_extra.get("xpub"),
            ledger_policy_hmac=ws_extra.get("ledger_policy_hmac"),
            order_index=wallet_signer.order_index,
        )
    )


@router.get("/{wallet_id}/deployment", response_model=ApiResponse[SafeDeploymentInfoResponse])
async def get_deployment_info(
    wallet_id: str,
    service: WalletServiceDep,
) -> ApiResponse[SafeDeploymentInfoResponse]:
    """Get Safe deployment information for an EVM wallet.

    Returns the predicted address and deployment transaction data.
    Only available for EVM wallets in PENDING_DEPLOY status.
    """
    info = await service.get_deployment_info(wallet_id)
    return ApiResponse(data=info)


@router.post("/{wallet_id}/activate", response_model=ApiResponse[WalletResponse])
async def activate_wallet(
    wallet_id: str,
    request: WalletActivateRequest,
    service: WalletServiceDep,
) -> ApiResponse[WalletResponse]:
    """Activate a wallet after deployment.

    For EVM wallets: Call this after the Safe deployment transaction is mined.
    For BTC wallets: Call this after address derivation is complete.
    """
    wallet = await service.activate_wallet(
        wallet_id=wallet_id,
        address=request.address,
        tx_hash=request.tx_hash,
        salt=request.salt,
        factory_address=request.factory_address,
        witness_script=request.witness_script,
        redeem_script=request.redeem_script,
    )
    return ApiResponse(data=_wallet_to_response(wallet))
