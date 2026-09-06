"""Signer API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from multivault.deps import DbSession
from multivault.schemas.common import ApiResponse, PaginatedResponse, PaginationMeta
from multivault.schemas.signer import (
    ChallengeRequest,
    ChallengeResponse,
    ChainTypeEnum,
    DeviceTypeEnum,
    KeyVaultProtocolRequest,
    KeyVaultProtocolResponse,
    SignerCreate,
    SignerQueryParams,
    SignerResponse,
    SignerStatusEnum,
    SignerUpdate,
    SignerVerify,
)
from multivault.services.signer_service import SignerService

router = APIRouter()


async def get_signer_service(db: DbSession) -> SignerService:
    """Dependency to get signer service."""
    return SignerService(db)


SignerServiceDep = Annotated[SignerService, Depends(get_signer_service)]


@router.post("/challenge", response_model=ApiResponse[ChallengeResponse])
async def create_challenge(
    request: ChallengeRequest,
    service: SignerServiceDep,
) -> ApiResponse[ChallengeResponse]:
    """Generate a verification challenge for signer registration.

    The challenge must be signed by the signer's private key to prove ownership.
    Challenge expires after 5 minutes.
    """
    result = await service.create_challenge(
        chain_type=request.chain_type,
        address=request.address,
        public_key=request.public_key,
    )
    return ApiResponse(data=result)


@router.post(
    "/keyvault/protocol",
    response_model=ApiResponse[KeyVaultProtocolResponse],
)
async def generate_keyvault_protocol(
    request: KeyVaultProtocolRequest,
    service: SignerServiceDep,
) -> ApiResponse[KeyVaultProtocolResponse]:
    """Generate KeyVault address import protocol payload for QR display.

    Returns a JSON payload for BR-UR encoding. Frontend should pass
    chain_type_value for EVM (e.g. ETH, ARBITRUM) to avoid backend DB lookup.
    """
    result = await service.generate_keyvault_protocol(request)
    return ApiResponse(data=result)


@router.post("", response_model=ApiResponse[SignerResponse])
async def create_signer(
    request: SignerCreate,
    service: SignerServiceDep,
) -> ApiResponse[SignerResponse]:
    """Create a new signer with verification.

    All signer types require valid challenge signature verification.
    First call POST /signers/challenge to get a challenge, sign it with
    the signer's private key, then submit it here.
    """
    signer = await service.create_signer(request)
    return ApiResponse(data=SignerResponse.model_validate(signer))


@router.get("", response_model=PaginatedResponse[SignerResponse])
async def list_signers(
    service: SignerServiceDep,
    chain_type: ChainTypeEnum | None = Query(default=None),
    device_type: DeviceTypeEnum | None = Query(default=None),
    status: SignerStatusEnum | None = Query(default=None),
    script_type: str | None = Query(default=None, pattern="^(p2wsh|p2sh-p2wsh)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> PaginatedResponse[SignerResponse]:
    """List all signers with optional filtering.

    Supports filtering by chain_type, device_type, status, and script_type.
    Results are paginated.
    """
    params = SignerQueryParams(
        chain_type=chain_type,
        device_type=device_type,
        status=status,
        script_type=script_type,
        page=page,
        page_size=page_size,
    )

    signers, total = await service.list_signers(params)
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0

    return PaginatedResponse(
        data=[SignerResponse.model_validate(s) for s in signers],
        pagination=PaginationMeta(
            page=page,
            page_size=page_size,
            total=total,
            total_pages=total_pages,
        ),
    )


@router.get("/{signer_id}", response_model=ApiResponse[SignerResponse])
async def get_signer(
    signer_id: str,
    service: SignerServiceDep,
) -> ApiResponse[SignerResponse]:
    """Get a signer by ID."""
    signer = await service.get_signer(signer_id)
    return ApiResponse(data=SignerResponse.model_validate(signer))


@router.patch("/{signer_id}", response_model=ApiResponse[SignerResponse])
async def update_signer(
    signer_id: str,
    request: SignerUpdate,
    service: SignerServiceDep,
) -> ApiResponse[SignerResponse]:
    """Update a signer's name."""
    signer = await service.update_signer(signer_id, request)
    return ApiResponse(data=SignerResponse.model_validate(signer))


@router.post("/{signer_id}/verify", response_model=ApiResponse[SignerResponse])
async def verify_signer(
    signer_id: str,
    request: SignerVerify,
    service: SignerServiceDep,
) -> ApiResponse[SignerResponse]:
    """Verify an existing signer using a signed challenge."""
    signer = await service.verify_signer(
        signer_id=signer_id,
        challenge=request.challenge,
        signature=request.signature,
        device_type=request.device_type.value if request.device_type else None,
        derivation_path=request.derivation_path,
        master_fingerprint=request.master_fingerprint,
        xpub=request.xpub,
    )
    return ApiResponse(data=SignerResponse.model_validate(signer))


@router.delete("/{signer_id}", status_code=204)
async def delete_signer(
    signer_id: str,
    service: SignerServiceDep,
) -> None:
    """Soft delete a signer.

    The signer will be marked as deleted but not removed from the database.
    """
    await service.delete_signer(signer_id)


@router.post("/{signer_id}/revoke", response_model=ApiResponse[SignerResponse])
async def revoke_signer(
    signer_id: str,
    service: SignerServiceDep,
) -> ApiResponse[SignerResponse]:
    """Revoke a signer's verification status.

    This marks the signer as REVOKED, preventing it from being used
    in new wallet configurations. Returns a warning message if any
    active wallet's verified signer count drops below its threshold.
    """
    signer, affected = await service.revoke_signer(signer_id)
    message = None
    if affected:
        names = ", ".join(w["wallet_name"] for w in affected)
        message = (
            f"Warning: {len(affected)} wallet(s) now below signing threshold: {names}"
        )
    return ApiResponse(data=SignerResponse.model_validate(signer), message=message)
