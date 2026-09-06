"""
Unit tests for EVM adapter.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

from eth_abi import encode

from multivault.chains.evm.adapter import (
    EVMAdapter,
    EVMAdapterError,
    EVMConnectionError,
    EVMTransactionError,
    SafeWalletConfig,
)
from multivault.chains.evm.safe import Operation, SafeTransaction
from multivault.chains.evm.web3_client import EVMNetwork
from multivault.chains.base import Balance, WalletConfig


# Test addresses
TEST_OWNERS = [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
]


def mock_adapter_connected(adapter):
    """Helper to mock a connected adapter."""
    adapter._connected = True
    adapter._client._connected = True
    adapter._client._chain_id = 1
    adapter._client._web3 = MagicMock()
    
    # Initialize Safe manager and Multicall with mocks if not set
    if adapter._safe_manager is None:
        from multivault.chains.evm.safe import SafeManager
        adapter._safe_manager = MagicMock(spec=SafeManager)
    
    if adapter._multicall is None:
        from multivault.chains.evm.multicall import Multicall3
        adapter._multicall = MagicMock(spec=Multicall3)


@pytest.fixture
def evm_adapter():
    """Create an EVM adapter for testing."""
    return EVMAdapter(network=EVMNetwork.LOCAL)


class TestEVMAdapterInit:
    """Tests for EVM adapter initialization."""

    def test_default_network(self):
        """Default network is LOCAL."""
        adapter = EVMAdapter()
        assert adapter._network == EVMNetwork.LOCAL

    def test_custom_network(self):
        """Custom network is set."""
        adapter = EVMAdapter(network=EVMNetwork.MAINNET)
        assert adapter._network == EVMNetwork.MAINNET

    def test_not_connected_initially(self):
        """Adapter is not connected on init."""
        adapter = EVMAdapter()
        assert not adapter.is_connected

    def test_chain_name(self):
        """Chain name includes network."""
        adapter = EVMAdapter(network=EVMNetwork.MAINNET)
        assert "EVM" in adapter.chain_name
        assert "mainnet" in adapter.chain_name


class TestEVMAdapterConnect:
    """Tests for connection management."""

    @pytest.mark.asyncio
    async def test_connect_sets_state(self, evm_adapter):
        """Connect initializes Safe manager and Multicall."""
        evm_adapter._client.connect = AsyncMock()
        evm_adapter._client._chain_id = 1

        await evm_adapter.connect()

        assert evm_adapter._connected
        assert evm_adapter._safe_manager is not None
        assert evm_adapter._multicall is not None

    @pytest.mark.asyncio
    async def test_connect_already_connected(self, evm_adapter):
        """Connect is idempotent."""
        evm_adapter._connected = True
        evm_adapter._client.connect = AsyncMock()

        await evm_adapter.connect()

        evm_adapter._client.connect.assert_not_called()

    @pytest.mark.asyncio
    async def test_disconnect(self, evm_adapter):
        """Disconnect clears state."""
        mock_adapter_connected(evm_adapter)
        evm_adapter._safe_manager = MagicMock()
        evm_adapter._multicall = MagicMock()
        evm_adapter._wallet_configs["0x1234"] = MagicMock()
        
        # Mock the provider's disconnect method as AsyncMock
        if hasattr(evm_adapter._client._web3, "provider"):
            provider = evm_adapter._client._web3.provider
            provider.disconnect = AsyncMock()
            provider._session = MagicMock()
            provider._session.closed = True

        await evm_adapter.disconnect()

        assert not evm_adapter._connected
        assert evm_adapter._safe_manager is None
        assert evm_adapter._multicall is None
        assert len(evm_adapter._wallet_configs) == 0

    @pytest.mark.asyncio
    async def test_context_manager(self, evm_adapter):
        """Context manager calls connect/disconnect."""
        evm_adapter.connect = AsyncMock()
        evm_adapter.disconnect = AsyncMock()

        async with evm_adapter:
            evm_adapter.connect.assert_called_once()

        evm_adapter.disconnect.assert_called_once()


class TestCreateMultisig:
    """Tests for multisig wallet creation."""

    @pytest.fixture
    def connected_adapter(self, evm_adapter):
        """Create a connected adapter with mocked Safe manager."""
        mock_adapter_connected(evm_adapter)

        from multivault.chains.evm.safe import SafeDeploymentInfo, SafeManager

        mock_manager = MagicMock(spec=SafeManager)
        mock_manager.get_deployment_info = AsyncMock(
            return_value=SafeDeploymentInfo(
                address="0xSafeAddress000000000000000000000000000000",
                owners=sorted(TEST_OWNERS, key=str.lower),
                threshold=2,
                salt_nonce=0,
                factory_address="0xFactory",
                singleton_address="0xSingleton",
                fallback_handler="0xHandler",
                is_deployed=False,
            )
        )
        evm_adapter._safe_manager = mock_manager
        return evm_adapter

    @pytest.mark.asyncio
    async def test_create_multisig_success(self, connected_adapter):
        """Create multisig returns WalletConfig."""
        config = await connected_adapter.create_multisig(
            addresses=TEST_OWNERS,
            threshold=2,
        )

        assert isinstance(config, WalletConfig)
        assert config.address == "0xSafeAddress000000000000000000000000000000"
        assert config.status == "PENDING_DEPLOY"
        assert config.extra_data["threshold"] == 2

    @pytest.mark.asyncio
    async def test_create_multisig_deployed(self, connected_adapter):
        """Create multisig for deployed Safe returns ACTIVE."""
        connected_adapter._safe_manager.get_deployment_info.return_value.is_deployed = True

        config = await connected_adapter.create_multisig(
            addresses=TEST_OWNERS,
            threshold=2,
        )

        assert config.status == "ACTIVE"

    @pytest.mark.asyncio
    async def test_create_multisig_caches_config(self, connected_adapter):
        """Created wallet config is cached."""
        config = await connected_adapter.create_multisig(
            addresses=TEST_OWNERS,
            threshold=2,
        )

        cached = connected_adapter.get_registered_wallet(config.address)
        assert cached is not None
        assert cached.threshold == 2

    @pytest.mark.asyncio
    async def test_create_multisig_threshold_too_high(self, connected_adapter):
        """Threshold > owners raises error."""
        with pytest.raises(ValueError, match="Threshold"):
            await connected_adapter.create_multisig(
                addresses=TEST_OWNERS,
                threshold=5,  # Only 3 owners
            )

    @pytest.mark.asyncio
    async def test_create_multisig_threshold_zero(self, connected_adapter):
        """Threshold < 1 raises error."""
        with pytest.raises(ValueError, match="at least 1"):
            await connected_adapter.create_multisig(
                addresses=TEST_OWNERS,
                threshold=0,
            )

    @pytest.mark.asyncio
    async def test_create_multisig_not_connected(self, evm_adapter):
        """Create multisig when not connected raises error."""
        with pytest.raises(EVMConnectionError):
            await evm_adapter.create_multisig(
                addresses=TEST_OWNERS,
                threshold=2,
            )


class TestGetBalance:
    """Tests for balance queries."""

    @pytest.fixture
    def connected_adapter(self, evm_adapter):
        """Create a connected adapter."""
        mock_adapter_connected(evm_adapter)
        evm_adapter._client.get_balance = AsyncMock(return_value=1000000000000000000)
        return evm_adapter

    @pytest.mark.asyncio
    async def test_get_balance(self, connected_adapter):
        """Get balance returns Balance object."""
        balance = await connected_adapter.get_balance("0x1234")

        assert isinstance(balance, Balance)
        assert balance.confirmed == 1000000000000000000
        assert balance.unconfirmed == 0

    @pytest.mark.asyncio
    async def test_get_balance_not_connected(self, evm_adapter):
        """Get balance when not connected raises error."""
        with pytest.raises(EVMConnectionError):
            await evm_adapter.get_balance("0x1234")


class TestGetTokenBalances:
    """Tests for ERC20 balance queries."""

    @pytest.fixture
    def connected_adapter(self, evm_adapter):
        """Create a connected adapter with mocked Multicall."""
        mock_adapter_connected(evm_adapter)

        from multivault.chains.evm.multicall import BalanceResult, Multicall3

        mock_multicall = MagicMock(spec=Multicall3)
        mock_multicall.get_balances = AsyncMock(
            return_value=[
                BalanceResult(
                    address="0x1234",
                    token="0xUSDC",
                    balance=1000 * 10**6,
                    success=True,
                ),
                BalanceResult(
                    address="0x1234",
                    token="0xDAI",
                    balance=500 * 10**18,
                    success=True,
                ),
            ]
        )
        evm_adapter._multicall = mock_multicall
        return evm_adapter

    @pytest.mark.asyncio
    async def test_get_token_balances(self, connected_adapter):
        """Get multiple token balances."""
        balances = await connected_adapter.get_token_balances(
            address="0x1234",
            tokens=["0xUSDC", "0xDAI"],
        )

        assert len(balances) == 2
        assert "0xUSDC" in balances
        assert balances["0xUSDC"] == 1000 * 10**6

    @pytest.mark.asyncio
    async def test_get_token_balances_empty(self, connected_adapter):
        """Empty tokens list returns empty dict."""
        balances = await connected_adapter.get_token_balances(
            address="0x1234",
            tokens=[],
        )
        assert balances == {}


class TestBuildTransaction:
    """Tests for transaction building."""

    @pytest.fixture
    def connected_adapter(self, evm_adapter):
        """Create a connected adapter with mocked Safe manager."""
        mock_adapter_connected(evm_adapter)

        from multivault.chains.evm.safe import SafeManager

        mock_tx = SafeTransaction(
            to="0xAAAA111111111111111111111111111111111111",
            value=1000000000000000000,
            data=b"",
            operation=Operation.CALL,
            nonce=5,
            safe_address="0xBBBB222222222222222222222222222222222222",
            chain_id=1,
            tx_hash=b"\x01" * 32,
        )

        mock_manager = MagicMock(spec=SafeManager)
        mock_manager.build_safe_transaction = AsyncMock(return_value=mock_tx)
        evm_adapter._safe_manager = mock_manager

        return evm_adapter

    @pytest.mark.asyncio
    async def test_build_transaction(self, connected_adapter):
        """Build transaction returns UnsignedTransaction."""
        from multivault.chains.base import UnsignedTransaction

        tx = await connected_adapter.build_transaction(
            from_address="0xBBBB222222222222222222222222222222222222",
            to_address="0xAAAA111111111111111111111111111111111111",
            amount=1000000000000000000,
        )

        assert isinstance(tx, UnsignedTransaction)
        assert tx.payload == ("01" * 32)  # tx_hash hex
        assert tx.metadata["nonce"] == 5
        assert "typed_data" in tx.metadata

    @pytest.mark.asyncio
    async def test_build_transaction_with_data(self, connected_adapter):
        """Build transaction with call data."""
        tx = await connected_adapter.build_transaction(
            from_address="0xBBBB222222222222222222222222222222222222",
            to_address="0xCCCC333333333333333333333333333333333333",
            amount=0,
            data=b"\x12\x34\x56\x78",
        )

        assert tx is not None

    @pytest.mark.asyncio
    async def test_build_transaction_not_connected(self, evm_adapter):
        """Build transaction when not connected raises error."""
        with pytest.raises(EVMConnectionError):
            await evm_adapter.build_transaction(
                from_address="0xBBBB222222222222222222222222222222222222",
                to_address="0xAAAA111111111111111111111111111111111111",
                amount=1000,
            )


class TestVerifySignature:
    """Tests for signature verification."""

    @pytest.mark.asyncio
    async def test_verify_signature_invalid(self, evm_adapter):
        """Invalid signature returns False."""
        result = await evm_adapter.verify_signature(
            message=b"\x00" * 32,
            signature=b"\x00" * 65,
            public_key="0x1234567890123456789012345678901234567890",
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_verify_signature_wrong_length(self, evm_adapter):
        """Wrong signature length returns False."""
        result = await evm_adapter.verify_signature(
            message=b"\x00" * 32,
            signature=b"\x00" * 64,  # Wrong length
            public_key="0x1234",
        )
        assert result is False


class TestBroadcast:
    """Tests for transaction broadcasting."""

    @pytest.fixture
    def connected_adapter(self, evm_adapter):
        """Create a connected adapter."""
        mock_adapter_connected(evm_adapter)
        evm_adapter._client.send_raw_transaction = AsyncMock(
            return_value="0x" + "ab" * 32
        )
        return evm_adapter

    @pytest.mark.asyncio
    async def test_broadcast_success(self, connected_adapter):
        """Successful broadcast returns tx hash."""
        result = await connected_adapter.broadcast(b"\x00" * 100)

        assert result.success is True
        assert result.tx_hash == "0x" + "ab" * 32

    @pytest.mark.asyncio
    async def test_broadcast_failure(self, connected_adapter):
        """Failed broadcast returns error."""
        from multivault.chains.evm.web3_client import Web3RPCException

        connected_adapter._client.send_raw_transaction = AsyncMock(
            side_effect=Web3RPCException("Transaction reverted")
        )

        result = await connected_adapter.broadcast(b"\x00" * 100)

        assert result.success is False
        assert "reverted" in result.error.lower()


class TestSafeSpecificMethods:
    """Tests for Safe-specific methods."""

    @pytest.fixture
    def connected_adapter(self, evm_adapter):
        """Create a connected adapter."""
        mock_adapter_connected(evm_adapter)
        evm_adapter._safe_manager = MagicMock()
        return evm_adapter

    @pytest.mark.asyncio
    async def test_is_deployed_true(self, connected_adapter):
        """Check deployed Safe."""
        connected_adapter._client.web3.eth.get_code = AsyncMock(
            return_value=b"\x60\x80\x60\x40"
        )

        result = await connected_adapter.is_deployed("0xAAAA111111111111111111111111111111111111")
        assert result is True

    @pytest.mark.asyncio
    async def test_is_deployed_false(self, connected_adapter):
        """Check non-deployed Safe."""
        connected_adapter._client.web3.eth.get_code = AsyncMock(return_value=b"")

        result = await connected_adapter.is_deployed("0xAAAA111111111111111111111111111111111111")
        assert result is False

    def test_register_wallet(self, connected_adapter):
        """Register wallet config."""
        config = SafeWalletConfig(
            address="0xAAAA111111111111111111111111111111111111",
            owners=TEST_OWNERS,
            threshold=2,
            salt_nonce=0,
            is_deployed=False,
            factory_address="0xBBBB222222222222222222222222222222222222",
            singleton_address="0xCCCC333333333333333333333333333333333333",
        )

        connected_adapter.register_wallet(config)

        cached = connected_adapter.get_registered_wallet("0xAAAA111111111111111111111111111111111111")
        assert cached == config

    def test_get_unregistered_wallet(self, connected_adapter):
        """Get unregistered wallet returns None."""
        result = connected_adapter.get_registered_wallet("0xUnknown")
        assert result is None


class TestProperties:
    """Tests for adapter properties."""

    def test_chain_id(self, evm_adapter):
        """Chain ID from client."""
        evm_adapter._client._chain_id = 137
        assert evm_adapter.chain_id == 137

    def test_client(self, evm_adapter):
        """Access underlying client."""
        assert evm_adapter.client is evm_adapter._client

    def test_safe_manager(self, evm_adapter):
        """Access Safe manager."""
        evm_adapter._safe_manager = MagicMock()
        assert evm_adapter.safe_manager is evm_adapter._safe_manager

    def test_multicall(self, evm_adapter):
        """Access Multicall instance."""
        evm_adapter._multicall = MagicMock()
        assert evm_adapter.multicall is evm_adapter._multicall


class TestBuildPolicyChangeTransaction:
    """Tests for EVMAdapter.build_policy_change_transaction()."""

    @pytest.mark.asyncio
    async def test_add_owner_builds_safe_tx(self, evm_adapter):
        """add_owner builds a SafeTransaction targeting the Safe itself."""
        mock_adapter_connected(evm_adapter)
        safe_address = "0xSafe0000000000000000000000000000000000ab"

        # Mock get_safe_info
        evm_adapter.get_safe_info = AsyncMock(return_value={
            "address": safe_address,
            "owners": [
                "0x1111111111111111111111111111111111111111",
                "0x2222222222222222222222222222222222222222",
            ],
            "threshold": 2,
            "nonce": 5,
        })

        # Mock build_policy_change_data to return dummy calldata
        evm_adapter._safe_manager.build_policy_change_data = MagicMock(
            return_value=b"\x01\x02\x03\x04",
        )

        # Mock build_safe_transaction
        mock_safe_tx = MagicMock(spec=SafeTransaction)
        evm_adapter._safe_manager.build_safe_transaction = AsyncMock(
            return_value=mock_safe_tx,
        )

        result = await evm_adapter.build_policy_change_transaction(
            wallet_address=safe_address,
            action="add_owner",
            params={
                "new_owner": "0x4444444444444444444444444444444444444444",
                "new_threshold": 2,
            },
            safe_nonce=5,
        )

        assert result is mock_safe_tx
        # Verify build_safe_transaction called with to=safe_address, value=0
        call_kwargs = evm_adapter._safe_manager.build_safe_transaction.call_args
        assert call_kwargs.kwargs["to"] == safe_address
        assert call_kwargs.kwargs["value"] == 0

    @pytest.mark.asyncio
    async def test_add_owner_rejects_existing_owner(self, evm_adapter):
        """add_owner rejects an address already in owners."""
        mock_adapter_connected(evm_adapter)
        safe_address = "0xSafe0000000000000000000000000000000000ab"

        evm_adapter.get_safe_info = AsyncMock(return_value={
            "address": safe_address,
            "owners": ["0x1111111111111111111111111111111111111111"],
            "threshold": 1,
            "nonce": 0,
        })

        with pytest.raises(ValueError, match="already an owner"):
            await evm_adapter.build_policy_change_transaction(
                wallet_address=safe_address,
                action="add_owner",
                params={
                    "new_owner": "0x1111111111111111111111111111111111111111",
                    "new_threshold": 1,
                },
                safe_nonce=0,
            )

    @pytest.mark.asyncio
    async def test_remove_owner_rejects_last_owner(self, evm_adapter):
        """remove_owner rejects when only 1 owner remains."""
        mock_adapter_connected(evm_adapter)
        safe_address = "0xSafe0000000000000000000000000000000000ab"

        evm_adapter.get_safe_info = AsyncMock(return_value={
            "address": safe_address,
            "owners": ["0x1111111111111111111111111111111111111111"],
            "threshold": 1,
            "nonce": 0,
        })

        with pytest.raises(ValueError, match="Cannot remove.*only owner"):
            await evm_adapter.build_policy_change_transaction(
                wallet_address=safe_address,
                action="remove_owner",
                params={
                    "removed_owner": "0x1111111111111111111111111111111111111111",
                    "new_threshold": 1,
                },
                safe_nonce=0,
            )

    @pytest.mark.asyncio
    async def test_change_threshold_rejects_same_value(self, evm_adapter):
        """change_threshold rejects when new == current."""
        mock_adapter_connected(evm_adapter)
        safe_address = "0xSafe0000000000000000000000000000000000ab"

        evm_adapter.get_safe_info = AsyncMock(return_value={
            "address": safe_address,
            "owners": [
                "0x1111111111111111111111111111111111111111",
                "0x2222222222222222222222222222222222222222",
            ],
            "threshold": 2,
            "nonce": 0,
        })

        with pytest.raises(ValueError, match="same as current"):
            await evm_adapter.build_policy_change_transaction(
                wallet_address=safe_address,
                action="change_threshold",
                params={"new_threshold": 2},
                safe_nonce=0,
            )

    @pytest.mark.asyncio
    async def test_swap_owner_validates_and_builds(self, evm_adapter):
        """swap_owner validates old owner exists and new doesn't."""
        mock_adapter_connected(evm_adapter)
        safe_address = "0xSafe0000000000000000000000000000000000ab"

        evm_adapter.get_safe_info = AsyncMock(return_value={
            "address": safe_address,
            "owners": [
                "0x1111111111111111111111111111111111111111",
                "0x2222222222222222222222222222222222222222",
            ],
            "threshold": 1,
            "nonce": 0,
        })
        evm_adapter._safe_manager.build_policy_change_data = MagicMock(
            return_value=b"\x01\x02\x03\x04",
        )
        mock_safe_tx = MagicMock(spec=SafeTransaction)
        evm_adapter._safe_manager.build_safe_transaction = AsyncMock(
            return_value=mock_safe_tx,
        )

        result = await evm_adapter.build_policy_change_transaction(
            wallet_address=safe_address,
            action="swap_owner",
            params={
                "removed_owner": "0x1111111111111111111111111111111111111111",
                "new_owner": "0x4444444444444444444444444444444444444444",
            },
            safe_nonce=0,
        )

        assert result is mock_safe_tx
