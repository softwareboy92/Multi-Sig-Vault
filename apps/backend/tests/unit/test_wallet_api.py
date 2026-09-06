"""Unit tests for Wallet API endpoints."""

import pytest
from datetime import UTC, datetime

from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus
from multivault.models.network import NetworkConfig


@pytest.fixture
async def verified_signers(async_session):
    """Create verified signers for testing."""
    signers = []
    for i in range(3):
        signer = Signer(
            name=f"API Signer {i + 1}",
            device_type=DeviceType.METAMASK,
            chain_type=ChainType.EVM,
            address=f"0x{'a' * 39}{i}",
            status=SignerStatus.VERIFIED,
            verified_at=datetime.now(UTC),
        )
        async_session.add(signer)
        signers.append(signer)
    await async_session.commit()
    for s in signers:
        await async_session.refresh(s)
    return signers


@pytest.fixture
async def evm_network(async_session):
    """Create test EVM network configuration."""
    network = NetworkConfig(
        chain_type="EVM",
        name="Ethereum Mainnet",
        explorer_url="https://etherscan.io",
        enabled=True,
        is_testnet=False,
        extra='{"chain_id": 1}',
    )
    async_session.add(network)
    await async_session.commit()
    await async_session.refresh(network)
    return network


@pytest.mark.asyncio
async def test_create_wallet(client, verified_signers, evm_network):
    """Test POST /api/v1/wallets."""
    signer_ids = [s.id for s in verified_signers[:2]]

    response = await client.post(
        "/api/v1/wallets",
        json={
            "name": "New Multisig",
            "chain_type": "EVM",
            "threshold": 2,
            "signer_ids": signer_ids,
            "network_id": evm_network.id,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == "New Multisig"
    assert data["data"]["threshold"] == 2
    assert data["data"]["signer_count"] == 2
    assert data["data"]["status"] == "PENDING_DEPLOY"
    assert len(data["data"]["signers"]) == 2


@pytest.mark.asyncio
async def test_create_wallet_invalid_threshold(client, verified_signers, evm_network):
    """Test validation: threshold > signer count."""
    response = await client.post(
        "/api/v1/wallets",
        json={
            "name": "Invalid",
            "chain_type": "EVM",
            "threshold": 5,  # Only 1 signer
            "signer_ids": [verified_signers[0].id],
            "network_id": evm_network.id,
        },
    )

    assert response.status_code == 400
    data = response.json()
    assert data["success"] is False
    assert "threshold" in data["error"]["message"].lower()


@pytest.mark.asyncio
async def test_create_wallet_duplicate_signers(client, verified_signers, evm_network):
    """Test validation: duplicate signer IDs."""
    signer_id = verified_signers[0].id

    response = await client.post(
        "/api/v1/wallets",
        json={
            "name": "Duplicate",
            "chain_type": "EVM",
            "threshold": 2,
            "signer_ids": [signer_id, signer_id],
            "network_id": evm_network.id,
        },
    )

    assert response.status_code == 422  # Pydantic validation
    data = response.json()
    assert "unique" in str(data).lower()


@pytest.mark.asyncio
async def test_list_wallets(client, verified_signers, evm_network):
    """Test GET /api/v1/wallets."""
    # Create a wallet first
    signer_ids = [s.id for s in verified_signers[:2]]
    await client.post(
        "/api/v1/wallets",
        json={
            "name": "List Test Wallet",
            "chain_type": "EVM",
            "threshold": 2,
            "signer_ids": signer_ids,
            "network_id": evm_network.id,
        },
    )

    response = await client.get("/api/v1/wallets")

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert len(data["data"]) >= 1
    assert data["pagination"]["total"] >= 1


@pytest.mark.asyncio
async def test_list_wallets_filter_chain_type(client, verified_signers, evm_network):
    """Test GET /api/v1/wallets with chain_type filter."""
    # Create a wallet first
    signer_ids = [s.id for s in verified_signers[:2]]
    await client.post(
        "/api/v1/wallets",
        json={
            "name": "Filter Test",
            "chain_type": "EVM",
            "threshold": 2,
            "signer_ids": signer_ids,
            "network_id": evm_network.id,
        },
    )

    response = await client.get("/api/v1/wallets?chain_type=EVM")

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    for wallet in data["data"]:
        assert wallet["chain_type"] == "EVM"


@pytest.mark.asyncio
async def test_list_wallets_pagination(client, verified_signers, evm_network):
    """Test pagination parameters."""
    # Create a wallet first
    signer_ids = [s.id for s in verified_signers[:2]]
    await client.post(
        "/api/v1/wallets",
        json={
            "name": "Pagination Test",
            "chain_type": "EVM",
            "threshold": 2,
            "signer_ids": signer_ids,
            "network_id": evm_network.id,
        },
    )

    response = await client.get("/api/v1/wallets?page=1&page_size=5")

    assert response.status_code == 200
    data = response.json()
    assert data["pagination"]["page"] == 1
    assert data["pagination"]["page_size"] == 5


@pytest.mark.asyncio
async def test_get_wallet(client, verified_signers, evm_network):
    """Test GET /api/v1/wallets/{id}."""
    # Create a wallet first
    signer_ids = [s.id for s in verified_signers[:2]]
    create_response = await client.post(
        "/api/v1/wallets",
        json={
            "name": "Get Test",
            "chain_type": "EVM",
            "threshold": 2,
            "signer_ids": signer_ids,
            "network_id": evm_network.id,
        },
    )
    wallet_id = create_response.json()["data"]["id"]

    response = await client.get(f"/api/v1/wallets/{wallet_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["id"] == wallet_id
    assert data["data"]["name"] == "Get Test"
    assert len(data["data"]["signers"]) == 2


@pytest.mark.asyncio
async def test_get_wallet_not_found(client):
    """Test GET /api/v1/wallets/{id} with non-existent ID."""
    response = await client.get("/api/v1/wallets/non-existent-id")

    assert response.status_code == 404
    data = response.json()
    assert data["success"] is False


@pytest.mark.asyncio
async def test_update_wallet(client, verified_signers, evm_network):
    """Test PATCH /api/v1/wallets/{id}."""
    # First create a wallet via API
    signer_ids = [s.id for s in verified_signers[:2]]
    create_response = await client.post(
        "/api/v1/wallets",
        json={
            "name": "To Update",
            "chain_type": "EVM",
            "threshold": 2,
            "signer_ids": signer_ids,
            "network_id": evm_network.id,
        },
    )
    wallet_id = create_response.json()["data"]["id"]

    # Then update it
    response = await client.patch(
        f"/api/v1/wallets/{wallet_id}",
        json={"name": "Updated Name"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == "Updated Name"


@pytest.mark.asyncio
async def test_archive_wallet(client, verified_signers, evm_network):
    """Test DELETE /api/v1/wallets/{id}."""
    # First create a wallet via API
    signer_ids = [s.id for s in verified_signers[:2]]
    create_response = await client.post(
        "/api/v1/wallets",
        json={
            "name": "To Archive",
            "chain_type": "EVM",
            "threshold": 2,
            "signer_ids": signer_ids,
            "network_id": evm_network.id,
        },
    )
    wallet_id = create_response.json()["data"]["id"]

    response = await client.delete(f"/api/v1/wallets/{wallet_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["status"] == "ARCHIVED"


@pytest.mark.asyncio
async def test_get_wallet_signers(client, verified_signers, evm_network):
    """Test GET /api/v1/wallets/{id}/signers."""
    # Create a wallet first
    signer_ids = [s.id for s in verified_signers]
    create_response = await client.post(
        "/api/v1/wallets",
        json={
            "name": "Signers Test",
            "chain_type": "EVM",
            "threshold": 2,
            "signer_ids": signer_ids,
            "network_id": evm_network.id,
        },
    )
    wallet_id = create_response.json()["data"]["id"]

    response = await client.get(f"/api/v1/wallets/{wallet_id}/signers")

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert len(data["data"]) == 3

    # Verify order
    for i, signer in enumerate(data["data"]):
        assert signer["order_index"] == i
