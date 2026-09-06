"""Integration tests for wallet import workflow.

Full API-level tests using httpx AsyncClient hitting FastAPI routes.
Tests the import endpoint (POST /api/v1/wallets/import) for:
- EVM Safe import (happy path + duplicate detection)
- BTC P2WSH Mode-A import (manual import with pubkeys)
- Imported signer verification (device type, order)
- Request validation (missing fields)
"""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.models.network import NetworkConfig, NetworkNodeConfig


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def evm_network(async_session: AsyncSession) -> NetworkConfig:
    """Create test EVM network with a JSON-RPC node."""
    net = NetworkConfig(
        id="evm-import-test",
        name="Ethereum Mainnet",
        chain_type="EVM",
        enabled=True,
        is_testnet=False,
        extra='{"chain_id": 1}',
    )
    async_session.add(net)
    await async_session.flush()

    node = NetworkNodeConfig(
        network_id=net.id,
        node_type="JSON_RPC",
        endpoint_url="http://localhost:8545",
        priority=100,
        enabled=True,
    )
    async_session.add(node)
    await async_session.flush()

    net.default_node_id = node.id
    await async_session.commit()
    return net


@pytest_asyncio.fixture
async def btc_network(async_session: AsyncSession) -> NetworkConfig:
    """Create test BTC network with an Electrum node."""
    net = NetworkConfig(
        id="btc-import-test",
        name="Bitcoin Mainnet",
        chain_type="BTC",
        enabled=True,
        is_testnet=False,
        extra='{"btc_network": "mainnet"}',
    )
    async_session.add(net)
    await async_session.flush()

    node = NetworkNodeConfig(
        network_id=net.id,
        node_type="ELECTRUM",
        endpoint_url="electrum.example.com:50002:s",
        priority=100,
        enabled=True,
    )
    async_session.add(node)
    await async_session.flush()

    net.default_node_id = node.id
    await async_session.commit()
    return net


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestWalletImportWorkflow:
    """End-to-end import workflow tests."""

    # ---- EVM Safe import: happy path ----

    @pytest.mark.asyncio
    async def test_import_evm_safe(
        self, client: AsyncClient, evm_network: NetworkConfig
    ):
        safe_addr = "0x" + "ab" * 20

        with patch("multivault.services.wallet_service.EVMAdapter") as MockAdapter:
            instance = MockAdapter.return_value
            instance.connect = AsyncMock()
            instance.disconnect = AsyncMock()
            instance.is_deployed = AsyncMock(return_value=True)
            instance.get_safe_info = AsyncMock(
                return_value={
                    "address": safe_addr,
                    "owners": [
                        "0x" + "11" * 20,
                        "0x" + "22" * 20,
                        "0x" + "33" * 20,
                    ],
                    "threshold": 2,
                    "nonce": 5,
                }
            )

            response = await client.post(
                "/api/v1/wallets/import",
                json={
                    "name": "My Safe",
                    "chain_type": "EVM",
                    "network_id": evm_network.id,
                    "safe_address": safe_addr,
                },
            )

        assert response.status_code == 201
        data = response.json()["data"]
        assert data["name"] == "My Safe"
        assert data["chain_type"] == "EVM"
        assert data["threshold"] == 2
        assert data["signer_count"] == 3
        assert data["status"] == "ACTIVE"
        assert data["source"] == "IMPORTED"
        assert data["address"] == safe_addr.lower()
        wallet_id = data["id"]

        # Verify wallet shows up in list
        list_resp = await client.get("/api/v1/wallets")
        assert list_resp.status_code == 200
        wallets = list_resp.json()["data"]
        assert any(w["id"] == wallet_id for w in wallets)

    # ---- EVM duplicate import → 409 ----

    @pytest.mark.asyncio
    async def test_import_evm_duplicate(
        self, client: AsyncClient, evm_network: NetworkConfig
    ):
        safe_addr = "0x" + "dd" * 20

        with patch("multivault.services.wallet_service.EVMAdapter") as MockAdapter:
            instance = MockAdapter.return_value
            instance.connect = AsyncMock()
            instance.disconnect = AsyncMock()
            instance.is_deployed = AsyncMock(return_value=True)
            instance.get_safe_info = AsyncMock(
                return_value={
                    "address": safe_addr,
                    "owners": ["0x" + "11" * 20, "0x" + "22" * 20],
                    "threshold": 2,
                    "nonce": 0,
                }
            )

            # First import succeeds
            resp1 = await client.post(
                "/api/v1/wallets/import",
                json={
                    "name": "Safe 1",
                    "chain_type": "EVM",
                    "network_id": evm_network.id,
                    "safe_address": safe_addr,
                },
            )
            assert resp1.status_code == 201

            # Second import with same address → conflict
            resp2 = await client.post(
                "/api/v1/wallets/import",
                json={
                    "name": "Safe 1 Again",
                    "chain_type": "EVM",
                    "network_id": evm_network.id,
                    "safe_address": safe_addr,
                },
            )
            assert resp2.status_code == 409

    # ---- BTC Mode A import: happy path ----

    @pytest.mark.asyncio
    async def test_import_btc_mode_a(
        self, client: AsyncClient, btc_network: NetworkConfig
    ):
        from multivault.chains.bitcoin.address import (
            BitcoinNetwork,
            derive_p2wsh_address,
        )

        # Use valid 33-byte compressed pubkey hex strings
        pubkeys = [
            "02" + "aa" * 32,
            "02" + "bb" * 32,
            "03" + "cc" * 32,
        ]
        threshold = 2
        address, _ws = derive_p2wsh_address(threshold, pubkeys, BitcoinNetwork.MAINNET)

        response = await client.post(
            "/api/v1/wallets/import",
            json={
                "name": "BTC Multisig",
                "chain_type": "BTC",
                "network_id": btc_network.id,
                "address": address,
                "threshold": threshold,
                "public_keys": pubkeys,
            },
        )

        assert response.status_code == 201
        data = response.json()["data"]
        assert data["chain_type"] == "BTC"
        assert data["threshold"] == 2
        assert data["signer_count"] == 3
        assert data["source"] == "IMPORTED"
        assert data["address"] == address

    # ---- Imported EVM signers: UNKNOWN device type ----

    @pytest.mark.asyncio
    async def test_imported_wallet_signers_are_unknown(
        self, client: AsyncClient, evm_network: NetworkConfig
    ):
        safe_addr = "0x" + "ff" * 20

        with patch("multivault.services.wallet_service.EVMAdapter") as MockAdapter:
            instance = MockAdapter.return_value
            instance.connect = AsyncMock()
            instance.disconnect = AsyncMock()
            instance.is_deployed = AsyncMock(return_value=True)
            instance.get_safe_info = AsyncMock(
                return_value={
                    "address": safe_addr,
                    "owners": ["0x" + "11" * 20, "0x" + "22" * 20],
                    "threshold": 2,
                    "nonce": 0,
                }
            )

            resp = await client.post(
                "/api/v1/wallets/import",
                json={
                    "name": "Check Signers",
                    "chain_type": "EVM",
                    "network_id": evm_network.id,
                    "safe_address": safe_addr,
                },
            )
            assert resp.status_code == 201
            wallet_id = resp.json()["data"]["id"]

        # Get wallet detail and inspect signers
        detail_resp = await client.get(f"/api/v1/wallets/{wallet_id}")
        assert detail_resp.status_code == 200
        data = detail_resp.json()["data"]
        assert len(data["signers"]) == 2
        for signer in data["signers"]:
            assert signer["device_type"] == "UNKNOWN"

    # ---- Validation: missing required fields → 422 ----

    @pytest.mark.asyncio
    async def test_import_evm_missing_safe_address(
        self, client: AsyncClient, evm_network: NetworkConfig
    ):
        response = await client.post(
            "/api/v1/wallets/import",
            json={
                "name": "Bad Import",
                "chain_type": "EVM",
                "network_id": evm_network.id,
            },
        )
        assert response.status_code == 422
