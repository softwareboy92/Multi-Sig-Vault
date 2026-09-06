"""Address book schemas."""

from datetime import datetime

from pydantic import BaseModel, Field

from multivault.models.signer import ChainType


class AddressBookCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    address: str = Field(..., min_length=1, max_length=128)
    chain_type: ChainType
    btc_network: str | None = None
    note: str | None = Field(None, max_length=200)


class AddressBookUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    address: str = Field(..., min_length=1, max_length=128)
    chain_type: ChainType
    btc_network: str | None = None
    note: str | None = Field(None, max_length=200)


class AddressBookResponse(BaseModel):
    id: str
    name: str
    address: str
    chain_type: ChainType
    btc_network: str | None = None
    note: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
