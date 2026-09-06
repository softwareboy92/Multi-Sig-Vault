"""Address book endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy import select

from multivault.deps import get_db
from multivault.models.address_book import AddressBookEntry
from multivault.models.signer import ChainType
from multivault.schemas.address_book import (
    AddressBookCreate,
    AddressBookResponse,
    AddressBookUpdate,
)
from multivault.schemas.common import ApiResponse
from multivault.utils.address import validate_btc_address, validate_evm_address

router = APIRouter()


@router.get("", response_model=ApiResponse[list[AddressBookResponse]])
async def list_address_book(
    db = Depends(get_db),
    chain_type: ChainType | None = Query(None),
    btc_network: str | None = Query(None),
) -> ApiResponse[list[AddressBookResponse]]:
    stmt = select(AddressBookEntry)
    if chain_type:
        stmt = stmt.where(AddressBookEntry.chain_type == chain_type)
    if btc_network:
        stmt = stmt.where(AddressBookEntry.btc_network == btc_network)

    result = await db.execute(stmt)
    entries = list(result.scalars().all())
    return ApiResponse(data=entries)


@router.post("", response_model=ApiResponse[AddressBookResponse])
async def create_address_book(
    request: AddressBookCreate,
    db = Depends(get_db),
) -> ApiResponse[AddressBookResponse]:
    if request.chain_type == ChainType.EVM:
        from multivault.errors.exceptions import ValidationError

        try:
            validate_evm_address(request.address)
        except ValueError as exc:
            raise ValidationError(message=str(exc), details={"address": request.address}) from exc
    if request.chain_type == ChainType.BTC:
        from multivault.errors.exceptions import ValidationError

        if not request.btc_network:
            raise ValidationError(
                message="BTC network is required",
                details={"btc_network": request.btc_network},
            )

        try:
            validate_btc_address(request.address, request.btc_network)
        except ValueError as exc:
            raise ValidationError(message=str(exc), details={"address": request.address}) from exc
    entry = AddressBookEntry(
        name=request.name,
        address=request.address,
        chain_type=request.chain_type,
        btc_network=request.btc_network,
        note=request.note,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return ApiResponse(data=entry)


@router.put("/{entry_id}", response_model=ApiResponse[AddressBookResponse])
async def update_address_book(
    entry_id: str = Path(..., description="Address book entry UUID"),
    request: AddressBookUpdate = ...,
    db = Depends(get_db),
) -> ApiResponse[AddressBookResponse]:
    if request.chain_type == ChainType.EVM:
        from multivault.errors.exceptions import ValidationError

        try:
            validate_evm_address(request.address)
        except ValueError as exc:
            raise ValidationError(message=str(exc), details={"address": request.address}) from exc
    if request.chain_type == ChainType.BTC:
        from multivault.errors.exceptions import ValidationError

        if not request.btc_network:
            raise ValidationError(
                message="BTC network is required",
                details={"btc_network": request.btc_network},
            )

        try:
            validate_btc_address(request.address, request.btc_network)
        except ValueError as exc:
            raise ValidationError(message=str(exc), details={"address": request.address}) from exc
    stmt = select(AddressBookEntry).where(AddressBookEntry.id == entry_id)
    result = await db.execute(stmt)
    entry = result.scalar_one_or_none()
    if not entry:
        from multivault.errors.exceptions import NotFoundError

        raise NotFoundError("AddressBookEntry", entry_id)

    entry.name = request.name
    entry.address = request.address
    entry.chain_type = request.chain_type
    entry.btc_network = request.btc_network
    entry.note = request.note

    await db.commit()
    await db.refresh(entry)
    return ApiResponse(data=entry)


@router.delete("/{entry_id}", response_model=ApiResponse[dict])
async def delete_address_book(
    entry_id: str = Path(..., description="Address book entry UUID"),
    db = Depends(get_db),
) -> ApiResponse[dict]:
    stmt = select(AddressBookEntry).where(AddressBookEntry.id == entry_id)
    result = await db.execute(stmt)
    entry = result.scalar_one_or_none()
    if not entry:
        from multivault.errors.exceptions import NotFoundError

        raise NotFoundError("AddressBookEntry", entry_id)

    await db.delete(entry)
    await db.commit()
    return ApiResponse(data={"deleted": True})
