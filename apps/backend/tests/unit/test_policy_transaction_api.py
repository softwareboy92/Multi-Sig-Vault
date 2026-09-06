"""Tests for POST /wallets/{id}/policy-changes endpoint.

Covers:
  - Schema validation (PolicyChangeCreate)
  - Wallet guard rails (BTC rejected, PENDING rejected, missing RPC)
  - All four policy actions via mocked EVMAdapter
  - Policy metadata stored in transaction.extra
"""

import json
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from multivault.chains.evm.safe import SafeTransaction
from multivault.models.network import NetworkConfig, NetworkNodeConfig
from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus
from multivault.models.transaction import TransactionStatus, TransactionType
from multivault.models.wallet import Wallet, WalletSigner, WalletSource, WalletStatus
from multivault.schemas.transaction import PolicyChangeCreate


# ---------------------------------------------------------------------------
# URL helper
# ---------------------------------------------------------------------------

POLICY_URL = "/api/v1/wallets/{wallet_id}/policy-changes"


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def evm_network(async_session):
    """Create test EVM network with a JSON-RPC node."""
    network = NetworkConfig(
        chain_type="EVM",
        name="Ethereum Mainnet",
        explorer_url="https://etherscan.io",
        enabled=True,
        is_testnet=False,
        extra='{"chain_id": 1}',
    )
    async_session.add(network)
    await async_session.flush()

    node = NetworkNodeConfig(
        network_id=network.id,
        node_type="JSON_RPC",
        endpoint_url="https://rpc.example.com",
        priority=100,
        enabled=True,
        is_healthy=True,
    )
    async_session.add(node)
    await async_session.flush()

    network.default_node_id = node.id
    await async_session.commit()
    await async_session.refresh(network)
    return network


@pytest.fixture
async def evm_network_no_node(async_session):
    """EVM network without any RPC node configured."""
    network = NetworkConfig(
        chain_type="EVM",
        name="No-Node Net",
        explorer_url="https://etherscan.io",
        enabled=True,
        is_testnet=False,
        extra='{"chain_id": 42}',
    )
    async_session.add(network)
    await async_session.commit()
    await async_session.refresh(network)
    return network


@pytest.fixture
async def btc_network(async_session):
    """Create test BTC network."""
    network = NetworkConfig(
        chain_type="BTC",
        name="Bitcoin Mainnet",
        explorer_url="https://mempool.space",
        enabled=True,
        is_testnet=False,
        extra='{"btc_network": "mainnet"}',
    )
    async_session.add(network)
    await async_session.commit()
    await async_session.refresh(network)
    return network


@pytest.fixture
async def evm_signers(async_session):
    """Create two verified EVM signers."""
    signers = []
    for i in range(2):
        signer = Signer(
            name=f"EVM Signer {i + 1}",
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


def _make_wallet_signers(async_session, wallet, signers):
    """Helper: link signers to wallet via WalletSigner."""
    for i, signer in enumerate(signers):
        ws = WalletSigner(
            wallet_id=wallet.id,
            signer_id=signer.id,
            order_index=i,
        )
        async_session.add(ws)


@pytest.fixture
async def active_evm_wallet(async_session, evm_network, evm_signers):
    """Create an ACTIVE EVM wallet with signers and a network node."""
    wallet = Wallet(
        name="Test Safe",
        chain_type=ChainType.EVM,
        network_id=evm_network.id,
        address="0x" + "b" * 40,
        threshold=2,
        signer_count=2,
        status=WalletStatus.ACTIVE,
        source=WalletSource.CREATED,
    )
    async_session.add(wallet)
    await async_session.flush()
    _make_wallet_signers(async_session, wallet, evm_signers)
    await async_session.commit()
    await async_session.refresh(wallet)
    return wallet


@pytest.fixture
async def active_evm_wallet_no_node(async_session, evm_network_no_node, evm_signers):
    """ACTIVE EVM wallet whose network has no RPC node."""
    wallet = Wallet(
        name="No-Node Safe",
        chain_type=ChainType.EVM,
        network_id=evm_network_no_node.id,
        address="0x" + "d" * 40,
        threshold=1,
        signer_count=2,
        status=WalletStatus.ACTIVE,
        source=WalletSource.CREATED,
    )
    async_session.add(wallet)
    await async_session.flush()
    _make_wallet_signers(async_session, wallet, evm_signers)
    await async_session.commit()
    await async_session.refresh(wallet)
    return wallet


@pytest.fixture
async def pending_evm_wallet(async_session, evm_network, evm_signers):
    """PENDING_DEPLOY EVM wallet."""
    wallet = Wallet(
        name="Pending Safe",
        chain_type=ChainType.EVM,
        network_id=evm_network.id,
        address="0x" + "c" * 40,
        threshold=2,
        signer_count=2,
        status=WalletStatus.PENDING_DEPLOY,
        source=WalletSource.CREATED,
    )
    async_session.add(wallet)
    await async_session.flush()
    _make_wallet_signers(async_session, wallet, evm_signers)
    await async_session.commit()
    await async_session.refresh(wallet)
    return wallet


@pytest.fixture
async def btc_wallet(async_session, btc_network):
    """Create an ACTIVE BTC wallet."""
    signer = Signer(
        name="BTC Signer",
        device_type=DeviceType.LEDGER,
        chain_type=ChainType.BTC,
        public_key="02" + "a" * 64,
        status=SignerStatus.VERIFIED,
        verified_at=datetime.now(UTC),
    )
    async_session.add(signer)
    await async_session.flush()

    wallet = Wallet(
        name="BTC Vault",
        chain_type=ChainType.BTC,
        network_id=btc_network.id,
        address="bc1q" + "a" * 38,
        threshold=1,
        signer_count=1,
        status=WalletStatus.ACTIVE,
        source=WalletSource.CREATED,
    )
    async_session.add(wallet)
    await async_session.flush()
    ws = WalletSigner(wallet_id=wallet.id, signer_id=signer.id, order_index=0)
    async_session.add(ws)
    await async_session.commit()
    await async_session.refresh(wallet)
    return wallet


# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------

SAFE_ADDRESS = "0x" + "b" * 40
OWNER_A = "0x1111111111111111111111111111111111111111"
OWNER_B = "0x2222222222222222222222222222222222222222"
OWNER_C = "0x3333333333333333333333333333333333333333"
NEW_OWNER = "0x4444444444444444444444444444444444444444"


def _make_safe_tx(nonce: int = 0) -> SafeTransaction:
    """Build a minimal SafeTransaction for mocking."""
    return SafeTransaction(
        to=SAFE_ADDRESS,
        value=0,
        data=b"\x01\x02\x03",
        nonce=nonce,
        safe_address=SAFE_ADDRESS,
        chain_id=1,
        tx_hash=b"\xab" * 32,
    )


def _mock_adapter(safe_info: dict | None = None, safe_nonce: int = 0):
    """Return a context-manager patch for the EVMAdapter used inside the endpoint.

    Patches multivault.api.transactions.EVMAdapter so that
    connect/disconnect are noops and build_policy_change_transaction
    returns a deterministic SafeTransaction.
    """
    default_info = {
        "address": SAFE_ADDRESS,
        "owners": [OWNER_A, OWNER_B],
        "threshold": 2,
        "nonce": safe_nonce,
    }
    info = safe_info or default_info

    instance = MagicMock()
    instance.connect = AsyncMock()
    instance.disconnect = AsyncMock()
    instance.get_safe_info = AsyncMock(return_value=info)
    instance.build_policy_change_transaction = AsyncMock(
        return_value=_make_safe_tx(safe_nonce),
    )
    klass = MagicMock(return_value=instance)
    return patch("multivault.chains.evm.adapter.EVMAdapter", klass)


# ============================================================================
# 1. Schema validation (pure, no IO)
# ============================================================================


class TestPolicyChangeCreateSchema:
    """Validate PolicyChangeCreate pydantic model."""

    def test_add_owner_valid(self):
        obj = PolicyChangeCreate(
            action="add_owner", new_owner=OWNER_A, new_threshold=2
        )
        assert obj.action == "add_owner"

    def test_add_owner_missing_new_owner(self):
        with pytest.raises(ValueError, match="new_owner"):
            PolicyChangeCreate(action="add_owner", new_threshold=2)

    def test_add_owner_missing_threshold(self):
        with pytest.raises(ValueError, match="new_threshold"):
            PolicyChangeCreate(action="add_owner", new_owner=OWNER_A)

    def test_remove_owner_valid(self):
        obj = PolicyChangeCreate(
            action="remove_owner", removed_owner=OWNER_A, new_threshold=1
        )
        assert obj.removed_owner == OWNER_A

    def test_remove_owner_missing_removed(self):
        with pytest.raises(ValueError, match="removed_owner"):
            PolicyChangeCreate(action="remove_owner", new_threshold=1)

    def test_remove_owner_missing_threshold(self):
        with pytest.raises(ValueError, match="new_threshold"):
            PolicyChangeCreate(action="remove_owner", removed_owner=OWNER_A)

    def test_swap_owner_valid(self):
        obj = PolicyChangeCreate(
            action="swap_owner", removed_owner=OWNER_A, new_owner=NEW_OWNER
        )
        assert obj.new_owner == NEW_OWNER

    def test_swap_owner_missing_new(self):
        with pytest.raises(ValueError, match="new_owner"):
            PolicyChangeCreate(action="swap_owner", removed_owner=OWNER_A)

    def test_swap_owner_missing_removed(self):
        with pytest.raises(ValueError, match="removed_owner"):
            PolicyChangeCreate(action="swap_owner", new_owner=NEW_OWNER)

    def test_change_threshold_valid(self):
        obj = PolicyChangeCreate(action="change_threshold", new_threshold=1)
        assert obj.new_threshold == 1

    def test_change_threshold_missing_value(self):
        with pytest.raises(ValueError, match="new_threshold"):
            PolicyChangeCreate(action="change_threshold")

    def test_invalid_action_rejected(self):
        with pytest.raises(ValueError):
            PolicyChangeCreate(action="destroy_wallet", new_threshold=1)

    def test_threshold_min_1(self):
        with pytest.raises(ValueError):
            PolicyChangeCreate(action="change_threshold", new_threshold=0)

    def test_optional_description(self):
        obj = PolicyChangeCreate(
            action="change_threshold", new_threshold=1, description="lower threshold"
        )
        assert obj.description == "lower threshold"


# ============================================================================
# 2. Wallet guard rails (via HTTP client)
# ============================================================================


class TestPolicyTransactionGuardRails:
    """Endpoint rejects invalid wallets before touching EVM."""

    @pytest.mark.asyncio
    async def test_btc_wallet_rejected(self, client, btc_wallet):
        """BTC wallet cannot create policy transactions."""
        response = await client.post(
            POLICY_URL.format(wallet_id=btc_wallet.id),
            json={"action": "change_threshold", "new_threshold": 1},
        )
        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert "evm" in body["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_pending_wallet_rejected(self, client, pending_evm_wallet):
        """PENDING_DEPLOY wallet cannot create policy transactions."""
        response = await client.post(
            POLICY_URL.format(wallet_id=pending_evm_wallet.id),
            json={"action": "change_threshold", "new_threshold": 1},
        )
        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert "active" in body["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_nonexistent_wallet_404(self, client):
        """Unknown wallet ID returns 404."""
        response = await client.post(
            POLICY_URL.format(wallet_id="00000000-0000-0000-0000-000000000000"),
            json={"action": "change_threshold", "new_threshold": 1},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_no_rpc_node_rejected(self, client, active_evm_wallet_no_node):
        """Wallet on network without RPC node returns 400."""
        response = await client.post(
            POLICY_URL.format(wallet_id=active_evm_wallet_no_node.id),
            json={"action": "change_threshold", "new_threshold": 1},
        )
        assert response.status_code == 400
        body = response.json()
        assert "rpc" in body["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_invalid_action_422(self, client, active_evm_wallet):
        """Invalid action value results in 422."""
        response = await client.post(
            POLICY_URL.format(wallet_id=active_evm_wallet.id),
            json={"action": "nuke_wallet", "new_threshold": 1},
        )
        assert response.status_code == 422


# ============================================================================
# 3. Happy-path: all four policy actions
# ============================================================================


class TestPolicyTransactionHappyPath:
    """Each action creates a PENDING_SIGN SAFE_POLICY_CHANGE transaction."""

    @pytest.mark.asyncio
    async def test_add_owner(self, client, active_evm_wallet):
        with _mock_adapter():
            response = await client.post(
                POLICY_URL.format(wallet_id=active_evm_wallet.id),
                json={
                    "action": "add_owner",
                    "new_owner": NEW_OWNER,
                    "new_threshold": 2,
                },
            )
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["tx_type"] == "SAFE_POLICY_CHANGE"
        assert data["status"] == "PENDING_SIGN"
        assert data["to_address"] == active_evm_wallet.address
        assert Decimal(data["amount"]) == 0
        # extra stores policy metadata
        extra = data.get("extra") or {}
        assert extra.get("policy_action") == "add_owner"
        assert extra.get("new_owner") == NEW_OWNER

    @pytest.mark.asyncio
    async def test_remove_owner(self, client, active_evm_wallet):
        info = {
            "address": active_evm_wallet.address,
            "owners": [OWNER_A, OWNER_B],
            "threshold": 2,
            "nonce": 0,
        }
        with _mock_adapter(safe_info=info):
            response = await client.post(
                POLICY_URL.format(wallet_id=active_evm_wallet.id),
                json={
                    "action": "remove_owner",
                    "removed_owner": OWNER_B,
                    "new_threshold": 1,
                },
            )
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["tx_type"] == "SAFE_POLICY_CHANGE"
        extra = data.get("extra") or {}
        assert extra.get("policy_action") == "remove_owner"
        assert extra.get("removed_owner") == OWNER_B
        assert extra.get("new_threshold") == 1

    @pytest.mark.asyncio
    async def test_swap_owner(self, client, active_evm_wallet):
        with _mock_adapter():
            response = await client.post(
                POLICY_URL.format(wallet_id=active_evm_wallet.id),
                json={
                    "action": "swap_owner",
                    "removed_owner": OWNER_A,
                    "new_owner": NEW_OWNER,
                },
            )
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["tx_type"] == "SAFE_POLICY_CHANGE"
        extra = data.get("extra") or {}
        assert extra.get("policy_action") == "swap_owner"
        assert extra.get("removed_owner") == OWNER_A
        assert extra.get("new_owner") == NEW_OWNER

    @pytest.mark.asyncio
    async def test_change_threshold(self, client, active_evm_wallet):
        with _mock_adapter():
            response = await client.post(
                POLICY_URL.format(wallet_id=active_evm_wallet.id),
                json={"action": "change_threshold", "new_threshold": 1},
            )
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["tx_type"] == "SAFE_POLICY_CHANGE"
        extra = data.get("extra") or {}
        assert extra.get("policy_action") == "change_threshold"
        assert extra.get("new_threshold") == 1

    @pytest.mark.asyncio
    async def test_response_contains_payload_and_hash(self, client, active_evm_wallet):
        """Payload (EIP-712 JSON) and payload_hash are persisted."""
        with _mock_adapter():
            response = await client.post(
                POLICY_URL.format(wallet_id=active_evm_wallet.id),
                json={"action": "change_threshold", "new_threshold": 1},
            )
        data = response.json()["data"]
        # payload should be parseable JSON (EIP-712 typed data)
        assert data["payload"] is not None
        parsed = json.loads(data["payload"])
        assert "types" in parsed
        assert "SafeTx" in parsed["types"]
        # payload_hash should be hex
        assert data["payload_hash"].startswith("0x")

    @pytest.mark.asyncio
    async def test_safe_nonce_allocated(self, client, active_evm_wallet):
        """Transaction should have a safe_nonce field."""
        with _mock_adapter(safe_nonce=7):
            response = await client.post(
                POLICY_URL.format(wallet_id=active_evm_wallet.id),
                json={"action": "change_threshold", "new_threshold": 1},
            )
        data = response.json()["data"]
        assert data["safe_nonce"] is not None

    @pytest.mark.asyncio
    async def test_description_stored(self, client, active_evm_wallet):
        """Optional description is persisted."""
        with _mock_adapter():
            response = await client.post(
                POLICY_URL.format(wallet_id=active_evm_wallet.id),
                json={
                    "action": "change_threshold",
                    "new_threshold": 1,
                    "description": "lower to single-sig",
                },
            )
        data = response.json()["data"]
        assert data["description"] == "lower to single-sig"

    @pytest.mark.asyncio
    async def test_old_owners_snapshot_in_extra(self, client, active_evm_wallet):
        """old_owners and old_threshold from on-chain state are stored."""
        info = {
            "address": active_evm_wallet.address,
            "owners": [OWNER_A, OWNER_B, OWNER_C],
            "threshold": 2,
            "nonce": 0,
        }
        with _mock_adapter(safe_info=info):
            response = await client.post(
                POLICY_URL.format(wallet_id=active_evm_wallet.id),
                json={"action": "change_threshold", "new_threshold": 1},
            )
        extra = response.json()["data"].get("extra") or {}
        assert extra.get("old_threshold") == 2
        assert extra.get("old_owners") == [OWNER_A, OWNER_B, OWNER_C]

    @pytest.mark.asyncio
    async def test_adapter_error_propagated(self, client, active_evm_wallet):
        """If adapter raises ValueError (e.g. invalid params), it surfaces as error."""
        instance = MagicMock()
        instance.connect = AsyncMock()
        instance.disconnect = AsyncMock()
        instance.get_safe_info = AsyncMock(return_value={
            "address": active_evm_wallet.address,
            "owners": [OWNER_A],
            "threshold": 1,
            "nonce": 0,
        })
        instance.build_policy_change_transaction = AsyncMock(
            side_effect=ValueError("Cannot remove the only owner"),
        )
        klass = MagicMock(return_value=instance)

        with patch("multivault.chains.evm.adapter.EVMAdapter", klass):
            response = await client.post(
                POLICY_URL.format(wallet_id=active_evm_wallet.id),
                json={
                    "action": "remove_owner",
                    "removed_owner": OWNER_A,
                    "new_threshold": 1,
                },
            )
        # Should propagate as an error status
        assert response.status_code >= 400


# ===========================================================================
# Sync-policy endpoint tests
# ===========================================================================

SYNC_URL = "/api/v1/wallets/{wallet_id}/sync-policy"


class TestSyncWalletPolicy:
    """Tests for POST /wallets/{wallet_id}/sync-policy endpoint."""

    @pytest.mark.asyncio
    async def test_sync_updates_threshold_and_owners(
        self, client, async_session, active_evm_wallet
    ):
        """Sync should update wallet threshold, signer_count and signers from chain."""
        new_owner = "0x" + "f" * 40
        instance = MagicMock()
        instance.connect = AsyncMock()
        instance.disconnect = AsyncMock()
        instance.get_safe_info = AsyncMock(return_value={
            "address": active_evm_wallet.address,
            "owners": [OWNER_A, OWNER_B, new_owner],
            "threshold": 3,
            "nonce": 5,
        })
        klass = MagicMock(return_value=instance)

        with patch("multivault.chains.evm.adapter.EVMAdapter", klass):
            response = await client.post(
                SYNC_URL.format(wallet_id=active_evm_wallet.id),
            )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["synced"] is True

        # Verify DB was updated
        await async_session.refresh(active_evm_wallet)
        assert active_evm_wallet.threshold == 3
        assert active_evm_wallet.signer_count == 3

    @pytest.mark.asyncio
    async def test_sync_btc_wallet_rejected(self, client, btc_wallet):
        """Sync should reject non-EVM wallets."""
        response = await client.post(
            SYNC_URL.format(wallet_id=btc_wallet.id),
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_sync_pending_wallet_rejected(self, client, pending_evm_wallet):
        """Sync should reject non-ACTIVE wallets."""
        response = await client.post(
            SYNC_URL.format(wallet_id=pending_evm_wallet.id),
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_sync_no_rpc_node_rejected(self, client, active_evm_wallet_no_node):
        """Sync should reject wallets with no RPC node."""
        response = await client.post(
            SYNC_URL.format(wallet_id=active_evm_wallet_no_node.id),
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_sync_nonexistent_wallet_404(self, client):
        """Sync should return 404 for nonexistent wallet."""
        import uuid

        response = await client.post(
            SYNC_URL.format(wallet_id=str(uuid.uuid4())),
        )
        assert response.status_code == 404
