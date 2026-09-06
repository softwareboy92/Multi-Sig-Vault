"""Tests for Signer API endpoints."""

import pytest
from httpx import AsyncClient


class TestChallengeEndpoint:
    """Tests for POST /signers/challenge."""

    @pytest.mark.asyncio
    async def test_create_evm_challenge(self, client: AsyncClient):
        """Test creating challenge for EVM chain."""
        response = await client.post(
            "/api/v1/signers/challenge",
            json={
                "chain_type": "EVM",
                "address": "0x742d35cc6634c0532925a3b844bc9e7595f1e3c7",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "challenge" in data["data"]
        assert "expires_at" in data["data"]

    @pytest.mark.asyncio
    async def test_create_btc_challenge(self, client: AsyncClient):
        """Test creating challenge for BTC chain."""
        response = await client.post(
            "/api/v1/signers/challenge",
            json={
                "chain_type": "BTC",
                "public_key": "02" + "a" * 64,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "challenge" in data["data"]

    @pytest.mark.asyncio
    async def test_evm_missing_address(self, client: AsyncClient):
        """Test EVM chain requires address."""
        response = await client.post(
            "/api/v1/signers/challenge",
            json={
                "chain_type": "EVM",
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Address is required" in data["error"]["message"]


class TestCreateSignerEndpoint:
    """Tests for POST /signers."""

    @pytest.mark.asyncio
    async def test_create_watch_only_signer(self, client: AsyncClient):
        """Test creating signer requires challenge and signature."""
        response = await client.post(
            "/api/v1/signers",
            json={
                "name": "Test Watch Only",
                "device_type": "LEDGER",
                "chain_type": "EVM",
                "address": "0x742d35cc6634c0532925a3b844bc9e7595f1e3c7",
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Challenge and signature are required" in data["error"]["message"]

    @pytest.mark.asyncio
    async def test_create_signer_invalid_address(self, client: AsyncClient):
        """Test validation of invalid address."""
        response = await client.post(
            "/api/v1/signers",
            json={
                "name": "Invalid",
                "device_type": "LEDGER",
                "chain_type": "EVM",
                "address": "invalid-address",
            },
        )

        assert response.status_code == 422  # Pydantic validation error

    @pytest.mark.asyncio
    async def test_create_signer_missing_identifier(self, client: AsyncClient):
        """Test EVM chain requires address."""
        response = await client.post(
            "/api/v1/signers",
            json={
                "name": "No Address",
                "device_type": "LEDGER",
                "chain_type": "EVM",
            },
        )

        assert response.status_code == 400


class TestListSignersEndpoint:
    """Tests for GET /signers."""

    @pytest.mark.asyncio
    async def test_list_empty(self, client: AsyncClient):
        """Test listing when empty."""
        response = await client.get("/api/v1/signers")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"] == []
        assert data["pagination"]["total"] == 0

    @pytest.mark.asyncio
    async def test_list_with_pagination(self, client: AsyncClient, create_db_signer):
        """Test listing with pagination params."""
        # Create some signers directly in DB
        from multivault.schemas.signer import ChainTypeEnum
        for i in range(3):
            await create_db_signer(
                name=f"Signer {i}",
                chain_type=ChainTypeEnum.EVM,
                address=f"0x{'a' * 39}{i}",
            )

        response = await client.get("/api/v1/signers?page=1&page_size=2")

        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 2
        assert data["pagination"]["total"] == 3
        assert data["pagination"]["page"] == 1
        assert data["pagination"]["page_size"] == 2

    @pytest.mark.asyncio
    async def test_list_filter_by_chain_type(self, client: AsyncClient, create_db_signer):
        """Test filtering by chain type."""
        # Create EVM signer directly in DB
        from multivault.schemas.signer import ChainTypeEnum
        await create_db_signer(
            name="EVM Signer",
            chain_type=ChainTypeEnum.EVM,
            address="0x" + "a" * 40,
        )

        # Create BTC signer
        await client.post(
            "/api/v1/signers",
            json={
                "name": "BTC Signer",
                "device_type": "LEDGER",
                "chain_type": "BTC",
                "public_key": "02" + "b" * 64,
            },
        )

        response = await client.get("/api/v1/signers?chain_type=EVM")

        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 1
        assert data["data"][0]["chain_type"] == "EVM"


class TestGetSignerEndpoint:
    """Tests for GET /signers/{id}."""

    @pytest.mark.asyncio
    async def test_get_existing_signer(self, client: AsyncClient, create_db_signer):
        """Test getting an existing signer."""
        # Create directly in DB
        from multivault.schemas.signer import ChainTypeEnum
        created = await create_db_signer(
            name="Test Get",
            chain_type=ChainTypeEnum.EVM,
            address="0x" + "a" * 40,
        )
        signer_id = created.id

        # Get
        response = await client.get(f"/api/v1/signers/{signer_id}")

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["id"] == signer_id
        assert data["data"]["name"] == "Test Get"

    @pytest.mark.asyncio
    async def test_get_nonexistent_signer(self, client: AsyncClient):
        """Test getting nonexistent signer returns 404."""
        response = await client.get("/api/v1/signers/nonexistent-id")

        assert response.status_code == 404
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "NOT_FOUND"


class TestUpdateSignerEndpoint:
    """Tests for PATCH /signers/{id}."""

    @pytest.mark.asyncio
    async def test_update_name(self, client: AsyncClient, create_db_signer):
        """Test updating signer name."""
        # Create directly in DB
        from multivault.schemas.signer import ChainTypeEnum
        created = await create_db_signer(
            name="Original Name",
            chain_type=ChainTypeEnum.EVM,
            address="0x" + "a" * 40,
        )
        signer_id = created.id

        # Update
        response = await client.patch(
            f"/api/v1/signers/{signer_id}",
            json={"name": "New Name"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["name"] == "New Name"


class TestDeleteSignerEndpoint:
    """Tests for DELETE /signers/{id}."""

    @pytest.mark.asyncio
    async def test_delete_signer(self, client: AsyncClient, create_db_signer):
        """Test deleting signer."""
        # Create directly in DB
        from multivault.schemas.signer import ChainTypeEnum
        created = await create_db_signer(
            name="To Delete",
            chain_type=ChainTypeEnum.EVM,
            address="0x" + "a" * 40,
        )
        signer_id = created.id

        # Delete
        response = await client.delete(f"/api/v1/signers/{signer_id}")
        assert response.status_code == 204

        # Verify deleted
        get_response = await client.get(f"/api/v1/signers/{signer_id}")
        assert get_response.status_code == 404


class TestRevokeSignerEndpoint:
    """Tests for POST /signers/{id}/revoke."""

    @pytest.mark.asyncio
    async def test_revoke_signer(self, client: AsyncClient, create_db_signer):
        """Test revoking a signer."""
        # Create directly in DB
        from multivault.schemas.signer import ChainTypeEnum
        created = await create_db_signer(
            name="To Revoke",
            chain_type=ChainTypeEnum.EVM,
            address="0x" + "a" * 40,
        )
        signer_id = created.id

        # Revoke
        response = await client.post(f"/api/v1/signers/{signer_id}/revoke")

        assert response.status_code == 200
        data = response.json()
        assert data["data"]["status"] == "REVOKED"
@pytest.fixture
async def create_db_signer(async_session):
    """Helper to create signers directly in DB bypassing verification."""
    from multivault.models.signer import Signer, ChainType, DeviceType, SignerStatus
    from datetime import datetime, UTC
    from multivault.schemas.signer import ChainTypeEnum, DeviceTypeEnum
    
    async def _create(name: str, chain_type: ChainTypeEnum, 
                     address: str = None, public_key: str = None,
                     device_type: DeviceTypeEnum = DeviceTypeEnum.LEDGER):
        signer = Signer(
            name=name,
            device_type=DeviceType[device_type.value],
            chain_type=ChainType[chain_type.value],
            address=address,
            public_key=public_key,
            status=SignerStatus.VERIFIED,
            verified_at=datetime.now(UTC),
        )
        async_session.add(signer)
        await async_session.commit()
        await async_session.refresh(signer)
        return signer
    
    return _create



