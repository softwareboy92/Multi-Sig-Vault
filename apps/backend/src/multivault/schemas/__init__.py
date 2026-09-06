"""Pydantic schemas for request/response validation."""

from multivault.schemas.asset import (
    AssetCreate,
    AssetResponse,
    AssetSyncResponse,
    BatchBalanceQuery,
    TokenInfo,
    WalletBalance,
)
from multivault.schemas.common import (
    ApiResponse,
    ErrorDetail,
    ErrorResponse,
    PaginatedResponse,
    PaginationMeta,
    PaginationParams,
)
from multivault.schemas.transaction import (
    PSBTInfo,
    SafeTransactionInfo,
    SignatureInfo,
    SignatureSubmit,
    TransactionCreate,
    TransactionListItem,
    TransactionQuery,
    TransactionResponse,
)

__all__ = [
    "ApiResponse",
    "ErrorResponse",
    "ErrorDetail",
    "PaginatedResponse",
    "PaginationMeta",
    "PaginationParams",
    # Asset schemas
    "AssetCreate",
    "AssetResponse",
    "BatchBalanceQuery",
    "TokenInfo",
    "WalletBalance",
    # Transaction schemas
    "TransactionCreate",
    "TransactionQuery",
    "TransactionResponse",
    "TransactionListItem",
    "SignatureSubmit",
    "SignatureInfo",
    "PSBTInfo",
    "SafeTransactionInfo",
]
