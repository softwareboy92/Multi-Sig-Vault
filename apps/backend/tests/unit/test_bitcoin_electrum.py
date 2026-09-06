"""
Unit tests for Electrum client.

Tests the Electrum protocol client with mocked server responses.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from multivault.chains.bitcoin.electrum import (
    ElectrumClient,
    ElectrumConnectionError,
    ElectrumRPCError,
    ElectrumTxInfo,
    ElectrumUTXO,
)


@pytest.fixture
def electrum_client():
    """Create an Electrum client for testing."""
    return ElectrumClient(
        host="test.electrum.server",
        port=50002,
        use_ssl=True,
        timeout=5.0,
    )


class TestElectrumClientInit:
    """Tests for client initialization."""

    def test_default_values(self):
        """Test default configuration."""
        client = ElectrumClient()
        assert client.host == "electrum.blockstream.info"
        assert client.port == 50002
        assert client.use_ssl is True
        assert client.timeout == 30.0

    def test_custom_values(self, electrum_client):
        """Test custom configuration."""
        assert electrum_client.host == "test.electrum.server"
        assert electrum_client.port == 50002
        assert electrum_client.timeout == 5.0

    def test_not_connected_initially(self, electrum_client):
        """Client is not connected on init."""
        assert electrum_client.is_connected is False


class TestScripthashConversion:
    """Tests for address to scripthash conversion."""

    def test_bech32_address(self):
        """Convert bech32 (P2WPKH) address to scripthash."""
        # This is a known address
        address = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
        scripthash = ElectrumClient.address_to_scripthash(address)

        # Scripthash should be 64 hex chars (32 bytes)
        assert len(scripthash) == 64
        assert all(c in "0123456789abcdef" for c in scripthash)

    def test_same_address_same_scripthash(self):
        """Same address always produces same scripthash."""
        address = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
        sh1 = ElectrumClient.address_to_scripthash(address)
        sh2 = ElectrumClient.address_to_scripthash(address)
        assert sh1 == sh2

    def test_different_addresses_different_scripthash(self):
        """Different addresses produce different scripthashes."""
        addr1 = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
        addr2 = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        sh1 = ElectrumClient.address_to_scripthash(addr1)
        sh2 = ElectrumClient.address_to_scripthash(addr2)
        assert sh1 != sh2


class TestElectrumRPCCalls:
    """Tests for RPC method calls with mocked I/O."""

    @pytest.mark.asyncio
    async def test_get_balance(self, electrum_client):
        """Test get_balance RPC call."""
        # Mock the _call method
        electrum_client._call = AsyncMock(
            return_value={"confirmed": 100000, "unconfirmed": 5000}
        )
        electrum_client._connected = True

        result = await electrum_client.get_balance(
            "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
        )

        assert result["confirmed"] == 100000
        assert result["unconfirmed"] == 5000
        electrum_client._call.assert_called_once()

    @pytest.mark.asyncio
    async def test_list_unspent(self, electrum_client):
        """Test list_unspent RPC call."""
        electrum_client._call = AsyncMock(
            return_value=[
                {"tx_hash": "a" * 64, "tx_pos": 0, "value": 50000, "height": 700000},
                {"tx_hash": "b" * 64, "tx_pos": 1, "value": 75000, "height": 700001},
            ]
        )
        electrum_client._connected = True

        result = await electrum_client.list_unspent(
            "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
        )

        assert len(result) == 2
        assert isinstance(result[0], ElectrumUTXO)
        assert result[0].txid == "a" * 64
        assert result[0].vout == 0
        assert result[0].value == 50000
        assert result[1].value == 75000

    @pytest.mark.asyncio
    async def test_get_history(self, electrum_client):
        """Test get_history RPC call."""
        electrum_client._call = AsyncMock(
            return_value=[
                {"tx_hash": "abc123" + "0" * 58, "height": 700000},
                {"tx_hash": "def456" + "0" * 58, "height": 700001},
            ]
        )
        electrum_client._connected = True

        result = await electrum_client.get_history(
            "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
        )

        assert len(result) == 2
        assert isinstance(result[0], ElectrumTxInfo)

    @pytest.mark.asyncio
    async def test_broadcast_transaction(self, electrum_client):
        """Test broadcast_transaction RPC call."""
        expected_txid = "c" * 64
        electrum_client._call = AsyncMock(return_value=expected_txid)
        electrum_client._connected = True

        raw_tx = "0100000001..."
        result = await electrum_client.broadcast_transaction(raw_tx)

        assert result == expected_txid
        electrum_client._call.assert_called_with(
            "blockchain.transaction.broadcast", [raw_tx]
        )

    @pytest.mark.asyncio
    async def test_get_fee_estimate(self, electrum_client):
        """Test fee estimation."""
        # Return 0.0001 BTC/kB
        electrum_client._call = AsyncMock(return_value=0.0001)
        electrum_client._connected = True

        result = await electrum_client.get_fee_estimate(6)
        assert result == 0.0001

    @pytest.mark.asyncio
    async def test_get_fee_estimate_sat_vb(self, electrum_client):
        """Test fee estimation in sat/vB."""
        # 0.0001 BTC/kB = 10 sat/vB
        electrum_client._call = AsyncMock(return_value=0.0001)
        electrum_client._connected = True

        result = await electrum_client.get_fee_estimate_sat_vb(6)
        assert result == 10

    @pytest.mark.asyncio
    async def test_get_fee_estimate_fallback(self, electrum_client):
        """Test fallback when fee estimation unavailable."""
        electrum_client._call = AsyncMock(return_value=-1)
        electrum_client._connected = True

        result = await electrum_client.get_fee_estimate_sat_vb(6)
        assert result == 10  # Default fallback


class TestElectrumErrors:
    """Tests for error handling."""

    @pytest.mark.asyncio
    async def test_call_when_not_connected(self, electrum_client):
        """Raise error when calling without connection."""
        # Use a valid address format
        address = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
        with pytest.raises(ElectrumConnectionError, match="Not connected"):
            await electrum_client.get_balance(address)

    @pytest.mark.asyncio
    async def test_rpc_error_handling(self, electrum_client):
        """Handle RPC error responses."""
        electrum_client._connected = True
        electrum_client._writer = MagicMock()
        electrum_client._writer.write = MagicMock()
        electrum_client._writer.drain = AsyncMock()

        error_response = json.dumps(
            {"jsonrpc": "2.0", "id": 1, "error": {"code": -1, "message": "Not found"}}
        ).encode() + b"\n"

        electrum_client._reader = AsyncMock()
        electrum_client._reader.readline = AsyncMock(return_value=error_response)

        with pytest.raises(ElectrumRPCError) as exc_info:
            await electrum_client._call("test.method", [])

        assert exc_info.value.code == -1
        assert "Not found" in str(exc_info.value)


class TestElectrumContextManager:
    """Tests for async context manager."""

    @pytest.mark.asyncio
    async def test_context_manager(self, electrum_client):
        """Test async context manager connect/disconnect."""
        electrum_client.connect = AsyncMock()
        electrum_client.disconnect = AsyncMock()

        async with electrum_client:
            electrum_client.connect.assert_called_once()

        electrum_client.disconnect.assert_called_once()


class TestElectrumPing:
    """Tests for ping functionality."""

    @pytest.mark.asyncio
    async def test_ping_success(self, electrum_client):
        """Ping returns True when server responds."""
        electrum_client._call = AsyncMock(return_value=None)
        electrum_client._connected = True

        result = await electrum_client.ping()
        assert result is True

    @pytest.mark.asyncio
    async def test_ping_failure(self, electrum_client):
        """Ping returns False when server doesn't respond."""
        electrum_client._call = AsyncMock(side_effect=ElectrumConnectionError("timeout"))
        electrum_client._connected = True

        result = await electrum_client.ping()
        assert result is False
