"""Tests for common schemas."""

from datetime import datetime

import pytest
from pydantic import ValidationError as PydanticValidationError

from multivault.schemas.common import (
    ApiResponse,
    ErrorDetail,
    ErrorResponse,
    PaginatedResponse,
    PaginationMeta,
    PaginationParams,
)


class TestApiResponse:
    """Tests for ApiResponse schema."""

    def test_success_response(self):
        """Test creating a success response."""
        response = ApiResponse(data={"key": "value"})

        assert response.success is True
        assert response.data == {"key": "value"}
        assert response.meta.timestamp is not None

    def test_typed_response_with_dict(self):
        """Test typed response with dict data."""
        response = ApiResponse[dict](data={"name": "test", "count": 42})

        assert response.success is True
        assert response.data["name"] == "test"
        assert response.data["count"] == 42


class TestErrorResponse:
    """Tests for ErrorResponse schema."""

    def test_error_response(self):
        """Test creating an error response."""
        response = ErrorResponse(
            error=ErrorDetail(
                code="TEST_ERROR",
                message="Test error message",
                details={"field": "value"},
            )
        )

        assert response.success is False
        assert response.error.code == "TEST_ERROR"
        assert response.error.message == "Test error message"
        assert response.error.details == {"field": "value"}


class TestPaginationParams:
    """Tests for PaginationParams schema."""

    def test_default_values(self):
        """Test default pagination values."""
        params = PaginationParams()

        assert params.page == 1
        assert params.page_size == 20
        assert params.offset == 0
        assert params.limit == 20

    def test_offset_calculation(self):
        """Test offset calculation for different pages."""
        params = PaginationParams(page=3, page_size=10)

        assert params.offset == 20  # (3-1) * 10
        assert params.limit == 10

    def test_validation_constraints(self):
        """Test validation of pagination constraints."""
        # Page must be >= 1
        with pytest.raises(PydanticValidationError):
            PaginationParams(page=0)

        # Page size must be >= 1
        with pytest.raises(PydanticValidationError):
            PaginationParams(page_size=0)

        # Page size must be <= 100
        with pytest.raises(PydanticValidationError):
            PaginationParams(page_size=101)


class TestPaginatedResponse:
    """Tests for PaginatedResponse schema."""

    def test_paginated_response(self):
        """Test creating a paginated response."""
        response = PaginatedResponse(
            data=[1, 2, 3],
            pagination=PaginationMeta(
                page=1,
                page_size=20,
                total=100,
                total_pages=5,
            ),
        )

        assert response.success is True
        assert len(response.data) == 3
        assert response.pagination.page == 1
        assert response.pagination.total == 100


class TestPolicyChangeCreateSchema:
    """Tests for PolicyChangeCreate validation."""

    def test_add_owner_valid(self):
        from multivault.schemas.transaction import PolicyChangeCreate
        data = PolicyChangeCreate(
            action="add_owner",
            new_owner="0x1111111111111111111111111111111111111111",
            new_threshold=2,
        )
        assert data.action == "add_owner"

    def test_remove_owner_valid(self):
        from multivault.schemas.transaction import PolicyChangeCreate
        data = PolicyChangeCreate(
            action="remove_owner",
            removed_owner="0x1111111111111111111111111111111111111111",
            new_threshold=1,
        )
        assert data.action == "remove_owner"

    def test_swap_owner_valid(self):
        from multivault.schemas.transaction import PolicyChangeCreate
        data = PolicyChangeCreate(
            action="swap_owner",
            removed_owner="0x1111111111111111111111111111111111111111",
            new_owner="0x2222222222222222222222222222222222222222",
        )
        assert data.action == "swap_owner"

    def test_change_threshold_valid(self):
        from multivault.schemas.transaction import PolicyChangeCreate
        data = PolicyChangeCreate(
            action="change_threshold",
            new_threshold=3,
        )
        assert data.action == "change_threshold"

    def test_add_owner_requires_new_owner(self):
        from multivault.schemas.transaction import PolicyChangeCreate
        with pytest.raises(ValueError, match="new_owner.*required"):
            PolicyChangeCreate(action="add_owner", new_threshold=2)

    def test_add_owner_requires_threshold(self):
        from multivault.schemas.transaction import PolicyChangeCreate
        with pytest.raises(ValueError, match="new_threshold.*required"):
            PolicyChangeCreate(
                action="add_owner",
                new_owner="0x1111111111111111111111111111111111111111",
            )

    def test_invalid_action_rejected(self):
        from multivault.schemas.transaction import PolicyChangeCreate
        with pytest.raises(ValueError):
            PolicyChangeCreate(action="invalid_action", new_threshold=1)
