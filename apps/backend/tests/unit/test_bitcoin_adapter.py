"""
Unit tests for Bitcoin Adapter.

Tests the BitcoinAdapter implementation.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from multivault.chains.base import Balance, BroadcastResult, WalletConfig
from multivault.chains.bitcoin.adapter import BitcoinAdapter, BitcoinAdapterError
from multivault.chains.bitcoin.address import BitcoinNetwork
from multivault.chains.bitcoin.electrum import ElectrumUTXO


# Test public keys
TEST_PUBKEYS = [
    "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    "03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556",
]


def mock_electrum_connected(adapter):
    """Helper to mock the adapter as fully connected."""
    adapter._electrum._connected = True
    adapter._electrum._writer = MagicMock()  # Needed for is_connected check
    adapter._connected = True


@pytest.fixture
def bitcoin_adapter():
    """Create a Bitcoin adapter for testing."""
    adapter = BitcoinAdapter(
        electrum_host="test.electrum.server",
        electrum_port=50002,
        network=BitcoinNetwork.MAINNET,
    )
    return adapter


class TestBitcoinAdapterProperties:
    """Tests for adapter properties."""

    def test_chain_name(self, bitcoin_adapter):
        """Adapter returns correct chain name."""
        assert bitcoin_adapter.chain_name == "BTC"

    def test_not_connected_initially(self, bitcoin_adapter):
        """Adapter is not connected on init."""
        assert bitcoin_adapter.is_connected is False


class TestCreateMultisig:
    """Tests for multisig wallet creation."""

    @pytest.mark.asyncio
    async def test_create_2_of_3_multisig(self, bitcoin_adapter):
        """Create a 2-of-3 multisig wallet."""
        config = await bitcoin_adapter.create_multisig(
            public_keys_or_addresses=TEST_PUBKEYS,
            threshold=2,
        )

        assert isinstance(config, WalletConfig)
        assert config.address.startswith("bc1q")  # P2WSH mainnet
        assert config.status == "ACTIVE"
        assert config.extra_data["script_type"] == "p2wsh"
        assert "witness_script" in config.extra_data
        assert len(config.extra_data["sorted_pubkeys"]) == 3

    @pytest.mark.asyncio
    async def test_create_multisig_testnet(self):
        """Create multisig on testnet."""
        adapter = BitcoinAdapter(network=BitcoinNetwork.TESTNET)
        config = await adapter.create_multisig(TEST_PUBKEYS, threshold=2)

        assert config.address.startswith("tb1q")  # Testnet

    @pytest.mark.asyncio
    async def test_create_multisig_deterministic(self, bitcoin_adapter):
        """Same keys produce same address regardless of order."""
        config1 = await bitcoin_adapter.create_multisig(TEST_PUBKEYS, threshold=2)
        config2 = await bitcoin_adapter.create_multisig(
            list(reversed(TEST_PUBKEYS)), threshold=2
        )

        assert config1.address == config2.address

    @pytest.mark.asyncio
    async def test_create_multisig_invalid_key(self, bitcoin_adapter):
        """Reject invalid public key."""
        invalid_keys = ["not_a_valid_pubkey", TEST_PUBKEYS[1]]

        with pytest.raises(ValueError, match="Invalid public key"):
            await bitcoin_adapter.create_multisig(invalid_keys, threshold=1)

    @pytest.mark.asyncio
    async def test_create_multisig_threshold_too_high(self, bitcoin_adapter):
        """Reject threshold exceeding key count."""
        with pytest.raises(ValueError, match="exceeds"):
            await bitcoin_adapter.create_multisig(TEST_PUBKEYS[:2], threshold=3)

    @pytest.mark.asyncio
    async def test_create_multisig_registers_wallet(self, bitcoin_adapter):
        """Created wallet is registered for later use."""
        config = await bitcoin_adapter.create_multisig(TEST_PUBKEYS, threshold=2)

        assert config.address in bitcoin_adapter._wallet_configs
        stored_config = bitcoin_adapter._wallet_configs[config.address]
        assert stored_config.threshold == 2
        assert len(stored_config.public_keys) == 3

    @pytest.mark.asyncio
    async def test_create_p2sh_p2wsh_multisig(self, bitcoin_adapter):
        """P2SH-P2WSH should produce a 3... address on mainnet."""
        config = await bitcoin_adapter.create_multisig(
            TEST_PUBKEYS, threshold=2, script_type="p2sh-p2wsh"
        )
        assert config.address.startswith("3"), f"Expected P2SH address, got {config.address}"
        assert config.extra_data["script_type"] == "p2sh-p2wsh"
        assert "redeem_script" in config.extra_data
        assert "witness_script" in config.extra_data

    @pytest.mark.asyncio
    async def test_create_multisig_default_is_p2wsh(self, bitcoin_adapter):
        """Default (no script_type) should produce P2WSH bc1q address."""
        config = await bitcoin_adapter.create_multisig(TEST_PUBKEYS, threshold=2)
        assert config.address.startswith("bc1q")
        assert config.extra_data["script_type"] == "p2wsh"
        assert "redeem_script" not in config.extra_data

    @pytest.mark.asyncio
    async def test_create_multisig_invalid_script_type(self, bitcoin_adapter):
        """Unsupported script_type raises ValueError."""
        with pytest.raises(ValueError, match="Unsupported script_type"):
            await bitcoin_adapter.create_multisig(
                TEST_PUBKEYS, threshold=2, script_type="p2tr"
            )


class TestRegisterWallet:
    """Tests for wallet registration."""

    def test_register_wallet_with_script(self, bitcoin_adapter):
        """Register wallet with witness script."""
        address = "bc1q..."
        witness_script = "5221" + "02" * 33 + "21" + "02" * 33 + "52ae"

        bitcoin_adapter.register_wallet(
            address=address,
            threshold=2,
            public_keys=TEST_PUBKEYS[:2],
            witness_script=witness_script,
        )

        assert address in bitcoin_adapter._wallet_configs
        config = bitcoin_adapter._wallet_configs[address]
        assert config.threshold == 2

    def test_register_wallet_without_script(self, bitcoin_adapter):
        """Register wallet auto-builds witness script."""
        address = "bc1q..."

        bitcoin_adapter.register_wallet(
            address=address,
            threshold=2,
            public_keys=TEST_PUBKEYS[:2],
        )

        config = bitcoin_adapter._wallet_configs[address]
        assert len(config.witness_script) > 0


class TestRegisterWalletP2SHP2WSH:
    """Test register_wallet with P2SH-P2WSH parameters."""

    def test_register_with_redeem_script(self, bitcoin_adapter):
        """register_wallet accepts redeem_script and script_type."""
        bitcoin_adapter.register_wallet(
            address="3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
            threshold=2,
            public_keys=TEST_PUBKEYS[:2],
            witness_script=b"\x00" * 71,
            redeem_script=b"\x00\x20" + b"\xaa" * 32,
            script_type="p2sh-p2wsh",
        )
        config = bitcoin_adapter._wallet_configs["3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"]
        assert config.redeem_script == b"\x00\x20" + b"\xaa" * 32
        assert config.script_type == "p2sh-p2wsh"


class TestGetBalance:
    """Tests for balance queries."""

    @pytest.mark.asyncio
    async def test_get_balance(self, bitcoin_adapter):
        """Get balance for an address."""
        # Mock electrum client
        bitcoin_adapter._electrum.get_balance = AsyncMock(
            return_value={"confirmed": 100000, "unconfirmed": 5000}
        )
        mock_electrum_connected(bitcoin_adapter)

        balance = await bitcoin_adapter.get_balance("bc1q...")

        assert isinstance(balance, Balance)
        assert balance.confirmed == 100000
        assert balance.unconfirmed == 5000
        assert balance.total == 105000

    @pytest.mark.asyncio
    async def test_get_balance_not_connected(self, bitcoin_adapter):
        """Raise error when not connected."""
        with pytest.raises(ConnectionError, match="Not connected"):
            await bitcoin_adapter.get_balance("bc1q...")


class TestListUnspent:
    """Tests for UTXO listing."""

    @pytest.mark.asyncio
    async def test_list_unspent(self, bitcoin_adapter):
        """List UTXOs for an address."""
        bitcoin_adapter._electrum.list_unspent = AsyncMock(
            return_value=[
                ElectrumUTXO(txid="a" * 64, vout=0, value=50000, height=700000),
                ElectrumUTXO(txid="b" * 64, vout=1, value=75000, height=700001),
            ]
        )
        mock_electrum_connected(bitcoin_adapter)

        utxos = await bitcoin_adapter.list_unspent("bc1q...")

        assert len(utxos) == 2
        assert utxos[0].value == 50000
        assert utxos[1].value == 75000


class TestBuildTransaction:
    """Tests for transaction building."""

    @pytest.mark.asyncio
    async def test_build_transaction(self, bitcoin_adapter):
        """Build a transaction."""
        # Create and register wallet
        config = await bitcoin_adapter.create_multisig(TEST_PUBKEYS, threshold=2)

        # Mock electrum
        bitcoin_adapter._electrum.list_unspent = AsyncMock(
            return_value=[
                ElectrumUTXO(txid="a" * 64, vout=0, value=100000, height=700000),
            ]
        )
        bitcoin_adapter._electrum.get_fee_estimate_sat_vb = AsyncMock(return_value=10)
        mock_electrum_connected(bitcoin_adapter)

        tx = await bitcoin_adapter.build_transaction(
            from_address=config.address,
            to_address="bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
            amount=50000,
        )

        assert tx.payload  # PSBT base64
        assert tx.fee > 0
        assert tx.metadata["format"] == "psbt_base64"
        assert tx.metadata["input_count"] >= 1

    @pytest.mark.asyncio
    async def test_build_transaction_unregistered_wallet(self, bitcoin_adapter):
        """Fail when wallet not registered."""
        mock_electrum_connected(bitcoin_adapter)

        with pytest.raises(ValueError, match="Wallet not registered"):
            await bitcoin_adapter.build_transaction(
                from_address="bc1q_unknown...",
                to_address="bc1q...",
                amount=50000,
            )

    @pytest.mark.asyncio
    async def test_build_transaction_no_utxos(self, bitcoin_adapter):
        """Fail when no UTXOs available."""
        config = await bitcoin_adapter.create_multisig(TEST_PUBKEYS, threshold=2)

        bitcoin_adapter._electrum.list_unspent = AsyncMock(return_value=[])
        bitcoin_adapter._electrum.get_fee_estimate_sat_vb = AsyncMock(return_value=10)
        mock_electrum_connected(bitcoin_adapter)

        with pytest.raises(BitcoinAdapterError, match="No UTXOs"):
            await bitcoin_adapter.build_transaction(
                from_address=config.address,
                to_address="bc1q...",
                amount=50000,
            )


class TestBroadcast:
    """Tests for transaction broadcasting."""

    @pytest.mark.asyncio
    async def test_broadcast_success(self, bitcoin_adapter):
        """Broadcast a transaction successfully."""
        expected_txid = "c" * 64
        bitcoin_adapter._electrum.broadcast_transaction = AsyncMock(
            return_value=expected_txid
        )
        mock_electrum_connected(bitcoin_adapter)

        result = await bitcoin_adapter.broadcast("0100000001...")

        assert isinstance(result, BroadcastResult)
        assert result.success is True
        assert result.tx_hash == expected_txid
        assert result.error is None

    @pytest.mark.asyncio
    async def test_broadcast_failure(self, bitcoin_adapter):
        """Handle broadcast failure."""
        from multivault.chains.bitcoin.electrum import ElectrumRPCError

        bitcoin_adapter._electrum.broadcast_transaction = AsyncMock(
            side_effect=ElectrumRPCError(-1, "bad-txns-inputs-spent")
        )
        mock_electrum_connected(bitcoin_adapter)

        result = await bitcoin_adapter.broadcast("0100000001...")

        assert result.success is False
        assert result.tx_hash == ""
        assert "bad-txns" in result.error


class TestContextManager:
    """Tests for async context manager."""

    @pytest.mark.asyncio
    async def test_context_manager(self, bitcoin_adapter):
        """Test connect/disconnect via context manager."""
        bitcoin_adapter._electrum.connect = AsyncMock()
        bitcoin_adapter._electrum.disconnect = AsyncMock()

        async with bitcoin_adapter:
            assert bitcoin_adapter._connected is True

        bitcoin_adapter._electrum.disconnect.assert_called_once()
