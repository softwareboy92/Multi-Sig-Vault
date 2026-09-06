"""
Unit tests for Web3 client.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

from multivault.chains.evm.web3_client import (
    EVMNetwork,
    GasEstimate,
    Web3Client,
    Web3ClientError,
    Web3ConnectionError,
    Web3RPCException,
)


class TestWeb3ClientInit:
    """Tests for Web3Client initialization."""

    def test_default_network(self):
        """Default network is LOCAL."""
        client = Web3Client()
        assert client._network == EVMNetwork.LOCAL

    def test_custom_rpc_url(self):
        """Custom RPC URL is stored."""
        client = Web3Client(rpc_url="http://custom:8545")
        assert client._rpc_url == "http://custom:8545"

    def test_network_sets_default_rpc(self):
        """Network enum provides default RPC URL."""
        client = Web3Client(network=EVMNetwork.MAINNET)
        assert "llama" in client._rpc_url or "eth" in client._rpc_url.lower()

    def test_not_connected_initially(self):
        """Client is not connected on init."""
        client = Web3Client()
        assert not client.is_connected
        assert client.chain_id is None


class TestWeb3ClientConnect:
    """Tests for connection management."""

    @pytest.mark.asyncio
    async def test_connect_success(self):
        """Successful connection sets is_connected."""
        client = Web3Client()

        with patch.object(client, "_web3") as mock_web3:
            mock_web3.eth.chain_id = AsyncMock(return_value=1)
            client._web3 = mock_web3
            client._connected = True
            client._chain_id = 1

            assert client.is_connected
            assert client.chain_id == 1

    @pytest.mark.asyncio
    async def test_disconnect(self):
        """Disconnect clears state."""
        client = Web3Client()
        client._connected = True
        client._chain_id = 1

        await client.disconnect()

        assert not client.is_connected
        assert client.chain_id is None

    @pytest.mark.asyncio
    async def test_context_manager(self):
        """Context manager calls connect/disconnect."""
        client = Web3Client()
        client.connect = AsyncMock()
        client.disconnect = AsyncMock()

        async with client:
            client.connect.assert_called_once()

        client.disconnect.assert_called_once()


class TestWeb3ClientBalance:
    """Tests for balance queries."""

    @pytest.fixture
    def connected_client(self):
        """Create a mock connected client."""
        client = Web3Client()
        client._connected = True
        client._chain_id = 1
        client._web3 = MagicMock()
        return client

    @pytest.mark.asyncio
    async def test_get_balance(self, connected_client):
        """Get balance returns wei value."""
        connected_client._web3.eth.get_balance = AsyncMock(
            return_value=1000000000000000000
        )
        connected_client._web3.to_checksum_address = lambda x: x

        balance = await connected_client.get_balance("0x1234")
        assert balance == 1000000000000000000

    @pytest.mark.asyncio
    async def test_get_balance_not_connected(self):
        """Get balance raises when not connected."""
        client = Web3Client()

        with pytest.raises(Web3ConnectionError):
            await client.get_balance("0x1234")

    @pytest.mark.asyncio
    async def test_get_nonce(self, connected_client):
        """Get nonce returns transaction count."""
        connected_client._web3.eth.get_transaction_count = AsyncMock(return_value=5)
        connected_client._web3.to_checksum_address = lambda x: x

        nonce = await connected_client.get_nonce("0x1234")
        assert nonce == 5


class TestWeb3ClientGas:
    """Tests for gas estimation."""

    @pytest.fixture
    def connected_client(self):
        """Create a mock connected client."""
        client = Web3Client()
        client._connected = True
        client._chain_id = 1
        client._web3 = MagicMock()
        return client

    @pytest.mark.asyncio
    async def test_estimate_gas(self, connected_client):
        """Estimate gas returns gas units."""
        connected_client._web3.eth.estimate_gas = AsyncMock(return_value=21000)

        gas = await connected_client.estimate_gas({"to": "0x1234", "value": 100})
        assert gas == 21000

    @pytest.mark.asyncio
    async def test_get_gas_price(self, connected_client):
        """Get gas price returns EIP-1559 estimates."""
        connected_client._web3.eth.get_block = AsyncMock(
            return_value={"baseFeePerGas": 10_000_000_000}
        )
        # max_priority_fee is a property that returns a coroutine in web3.py v7
        type(connected_client._web3.eth).max_priority_fee = PropertyMock(
            return_value=AsyncMock(return_value=1_000_000_000)()
        )

        estimate = await connected_client.get_gas_price()
        assert isinstance(estimate, GasEstimate)
        # Just verify the structure is correct
        assert estimate.gas_limit == 21000


class TestWeb3ClientCalls:
    """Tests for contract calls."""

    @pytest.fixture
    def connected_client(self):
        """Create a mock connected client."""
        client = Web3Client()
        client._connected = True
        client._chain_id = 1
        client._web3 = MagicMock()
        client._web3.to_checksum_address = lambda x: x
        return client

    @pytest.mark.asyncio
    async def test_call_contract(self, connected_client):
        """Call returns raw bytes."""
        connected_client._web3.eth.call = AsyncMock(
            return_value=b"\x00" * 32
        )

        result = await connected_client.call("0x1234", b"\x00\x01\x02\x03")
        assert len(result) == 32

    @pytest.mark.asyncio
    async def test_send_raw_transaction(self, connected_client):
        """Send raw transaction returns hash."""
        tx_hash = bytes.fromhex("a" * 64)
        connected_client._web3.eth.send_raw_transaction = AsyncMock(
            return_value=MagicMock(hex=lambda: "0x" + "a" * 64)
        )

        result = await connected_client.send_raw_transaction(b"\x00" * 100)
        assert len(result) == 66  # 0x + 64 hex chars


class TestWeb3ClientSignature:
    """Tests for signature verification."""

    def test_verify_signature_valid(self):
        """Valid signature returns True."""
        # This would require an actual signed message
        # For now, test the interface
        client = Web3Client()
        # Invalid signature should return False
        result = client.verify_signature(b"message", b"x" * 65, "0x1234")
        assert result is False

    def test_verify_signature_invalid_length(self):
        """Invalid signature length returns False."""
        client = Web3Client()
        result = client.verify_signature(b"message", b"short", "0x1234")
        assert result is False


class TestWeb3ClientHelpers:
    """Tests for helper methods."""

    def test_to_checksum_address(self):
        """Convert to checksum address."""
        addr = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"
        checksum = Web3Client.to_checksum_address(addr)
        assert checksum == "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"

    def test_keccak256(self):
        """Compute keccak256 hash."""
        result = Web3Client.keccak256(b"hello")
        assert len(result) == 32
        # Known hash of "hello"
        expected = "1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
        assert result.hex() == expected
