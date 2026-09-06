"""Custom exception definitions."""

from typing import Any


class MultiVaultError(Exception):
    """Base exception for all MultiVault errors."""

    error_code: str = "INTERNAL_ERROR"
    status_code: int = 500
    message: str = "An internal error occurred"

    def __init__(
        self,
        message: str | None = None,
        details: dict[str, Any] | None = None,
    ):
        self.message = message or self.__class__.message
        self.details = details or {}
        super().__init__(self.message)

    def to_dict(self) -> dict[str, Any]:
        """Convert to error response dict."""
        return {
            "code": self.error_code,
            "message": self.message,
            "details": self.details if self.details else None,
        }


class NotFoundError(MultiVaultError):
    """Resource not found error."""

    error_code = "NOT_FOUND"
    status_code = 404
    message = "Resource not found"

    def __init__(self, resource: str, identifier: str):
        super().__init__(
            message=f"{resource} not found",
            details={"resource": resource, "identifier": identifier},
        )


class ValidationError(MultiVaultError):
    """Validation error for invalid input."""

    error_code = "VALIDATION_ERROR"
    status_code = 400
    message = "Validation failed"


class ConflictError(MultiVaultError):
    """Conflict error for duplicate resources."""

    error_code = "CONFLICT"
    status_code = 409
    message = "Resource already exists"


class ChainError(MultiVaultError):
    """Chain interaction error."""

    error_code = "CHAIN_ERROR"
    status_code = 502
    message = "Chain interaction failed"


class SignerNotVerifiedError(MultiVaultError):
    """Signer must be verified before operation."""

    error_code = "SIGNER_NOT_VERIFIED"
    status_code = 400
    message = "Signer must be verified before this operation"

    def __init__(self, signer_id: str):
        super().__init__(
            message="Signer must be verified before adding to wallet",
            details={"signer_id": signer_id},
        )


class InsufficientSignaturesError(MultiVaultError):
    """Not enough signatures to complete transaction."""

    error_code = "INSUFFICIENT_SIGNATURES"
    status_code = 400
    message = "Insufficient signatures"

    def __init__(self, required: int, collected: int):
        super().__init__(
            message=f"Need {required} signatures, but only {collected} collected",
            details={"required": required, "collected": collected},
        )


class InvalidSignatureError(MultiVaultError):
    """Signature verification failed."""

    error_code = "INVALID_SIGNATURE"
    status_code = 400
    message = "Invalid signature"


class WalletNotActiveError(MultiVaultError):
    """Wallet is not in active state."""

    error_code = "WALLET_NOT_ACTIVE"
    status_code = 400
    message = "Wallet is not active"

    def __init__(self, wallet_id: str, current_status: str):
        super().__init__(
            message=f"Wallet is not active (current status: {current_status})",
            details={"wallet_id": wallet_id, "status": current_status},
        )
