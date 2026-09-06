"""Tests for exception classes."""

import pytest

from multivault.errors.exceptions import (
    ChainError,
    ConflictError,
    InsufficientSignaturesError,
    InvalidSignatureError,
    MultiVaultError,
    NotFoundError,
    SignerNotVerifiedError,
    ValidationError,
    WalletNotActiveError,
)


class TestMultiVaultError:
    """Tests for base MultiVaultError."""

    def test_default_values(self):
        """Test default error values."""
        error = MultiVaultError()

        assert error.error_code == "INTERNAL_ERROR"
        assert error.status_code == 500
        assert error.message == "An internal error occurred"
        assert error.details == {}

    def test_custom_message(self):
        """Test custom error message."""
        error = MultiVaultError(message="Custom error")

        assert error.message == "Custom error"

    def test_to_dict(self):
        """Test conversion to dict."""
        error = MultiVaultError(
            message="Test error",
            details={"key": "value"},
        )

        result = error.to_dict()

        assert result["code"] == "INTERNAL_ERROR"
        assert result["message"] == "Test error"
        assert result["details"] == {"key": "value"}


class TestNotFoundError:
    """Tests for NotFoundError."""

    def test_not_found_error(self):
        """Test NotFoundError with resource details."""
        error = NotFoundError(resource="Signer", identifier="123")

        assert error.error_code == "NOT_FOUND"
        assert error.status_code == 404
        assert error.message == "Signer not found"
        assert error.details["resource"] == "Signer"
        assert error.details["identifier"] == "123"


class TestSignerNotVerifiedError:
    """Tests for SignerNotVerifiedError."""

    def test_signer_not_verified_error(self):
        """Test SignerNotVerifiedError."""
        error = SignerNotVerifiedError(signer_id="abc-123")

        assert error.error_code == "SIGNER_NOT_VERIFIED"
        assert error.status_code == 400
        assert "verified" in error.message.lower()
        assert error.details["signer_id"] == "abc-123"


class TestInsufficientSignaturesError:
    """Tests for InsufficientSignaturesError."""

    def test_insufficient_signatures(self):
        """Test InsufficientSignaturesError."""
        error = InsufficientSignaturesError(required=3, collected=1)

        assert error.error_code == "INSUFFICIENT_SIGNATURES"
        assert error.details["required"] == 3
        assert error.details["collected"] == 1


class TestWalletNotActiveError:
    """Tests for WalletNotActiveError."""

    def test_wallet_not_active(self):
        """Test WalletNotActiveError."""
        error = WalletNotActiveError(
            wallet_id="wallet-123",
            current_status="ARCHIVED",
        )

        assert error.error_code == "WALLET_NOT_ACTIVE"
        assert error.details["wallet_id"] == "wallet-123"
        assert error.details["status"] == "ARCHIVED"
