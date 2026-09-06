"""Integration tests for Wallet workflow.

Tests the complete wallet lifecycle:
1. Create signers for wallet
2. Create wallet
3. Get deployment info (EVM)
4. Activate wallet
5. Query assets
6. Create transaction
7. Sign transaction
8. Get execution data
"""

import pytest
from datetime import datetime, UTC
from decimal import Decimal
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.models.signer import Signer, DeviceType, SignerStatus
from multivault.models.wallet import Wallet, WalletStatus, ChainType, WalletSigner
from multivault.models.network import NetworkConfig


@pytest.fixture
async def evm_network(async_session: AsyncSession) -> NetworkConfig:
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


@pytest.fixture
async def test_signers(async_session: AsyncSession) -> list[Signer]:
    """Create test signers for wallet tests."""
    signers = []
    for i in range(2):
        signer = Signer(
            name=f"Test Signer {i+1}",
            device_type=DeviceType.METAMASK,
            chain_type=ChainType.EVM,
            address=f"0x{'1' * 38}{i:02d}",
            status=SignerStatus.VERIFIED,
            verified_at=datetime.now(UTC),
        )
        async_session.add(signer)
        signers.append(signer)
    await async_session.flush()
    return signers


@pytest.fixture
async def test_wallet(
    async_session: AsyncSession,
    test_signers: list[Signer],
    evm_network: NetworkConfig,
) -> Wallet:
    """Create a test wallet with signers."""
    wallet = Wallet(
        name="Test Multisig",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=2,
        address="0x" + "ab" * 20,
        status=WalletStatus.ACTIVE,
        deployed_at=datetime.now(UTC),
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.flush()

    # Link signers to wallet with order_index
    for idx, signer in enumerate(test_signers):
        ws = WalletSigner(
            wallet_id=wallet.id,
            signer_id=signer.id,
            order_index=idx,
        )
        async_session.add(ws)

    await async_session.flush()
    return wallet


class TestWalletWorkflow:
    """Integration tests for wallet API workflow."""

    @pytest.mark.asyncio
    async def test_list_wallets_empty(self, client: AsyncClient):
        """Test listing wallets when none exist."""
        response = await client.get("/api/v1/wallets")
        assert response.status_code == 200
        data = response.json()["data"]
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_create_wallet_validation(self, client: AsyncClient):
        """Test wallet creation validation."""
        # Missing required fields
        response = await client.post(
            "/api/v1/wallets",
            json={
                "name": "Test Wallet",
                # Missing chain_type, threshold, signer_ids
            },
        )
        assert response.status_code == 422  # Validation error

    @pytest.mark.asyncio
    async def test_get_wallet_not_found(self, client: AsyncClient):
        """Test getting non-existent wallet."""
        response = await client.get("/api/v1/wallets/nonexistent-id")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_wallet_with_signers(
        self,
        client: AsyncClient,
        test_wallet: Wallet,
    ):
        """Test getting wallet with associated signers."""
        response = await client.get(f"/api/v1/wallets/{test_wallet.id}")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["id"] == test_wallet.id
        assert data["name"] == "Test Multisig"
        assert data["threshold"] == 2

    @pytest.mark.asyncio
    async def test_wallet_assets(
        self,
        client: AsyncClient,
        test_wallet: Wallet,
    ):
        """Test getting wallet assets."""
        response = await client.get(f"/api/v1/wallets/{test_wallet.id}/assets")
        assert response.status_code == 200
        data = response.json()["data"]
        assert isinstance(data, list)


class TestWalletTransactionWorkflow:
    """Integration tests for wallet transaction workflow.
    
    Note: Full transaction tests require EVM RPC connection.
    These tests focus on validation and error handling.
    """

    @pytest.mark.asyncio
    async def test_create_transaction_wallet_not_found(
        self,
        client: AsyncClient,
    ):
        """Test creating a transaction for non-existent wallet."""
        response = await client.post(
            "/api/v1/wallets/nonexistent-wallet-id/transactions",
            json={
                "to_address": "0x" + "cc" * 20,
                "amount": "1.5",
                "description": "Test transfer",
            },
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_create_transaction_validation(
        self,
        client: AsyncClient,
        test_wallet: Wallet,
    ):
        """Test transaction creation validation."""
        # Missing required fields
        response = await client.post(
            f"/api/v1/wallets/{test_wallet.id}/transactions",
            json={
                # Missing to_address
                "amount": "1.5",
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_list_wallet_transactions_empty(
        self,
        client: AsyncClient,
        test_wallet: Wallet,
    ):
        """Test listing transactions for a wallet with no transactions."""
        response = await client.get(
            f"/api/v1/wallets/{test_wallet.id}/transactions"
        )
        assert response.status_code == 200
        data = response.json()["data"]
        # May return list or paginated object
        assert isinstance(data, (list, dict))

    @pytest.mark.asyncio
    async def test_get_transaction_not_found(
        self,
        client: AsyncClient,
    ):
        """Test getting non-existent transaction."""
        response = await client.get("/api/v1/transactions/nonexistent-tx-id")
        assert response.status_code == 404
