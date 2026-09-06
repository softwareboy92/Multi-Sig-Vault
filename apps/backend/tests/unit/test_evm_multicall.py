"""
Unit tests for Multicall3 client.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from eth_abi import encode

from multivault.chains.evm.multicall import (
    BalanceQuery,
    BalanceResult,
    Call,
    CallResult,
    Multicall3,
    MulticallError,
    MULTICALL3_ADDRESS,
)
from multivault.chains.evm.web3_client import Web3Client


@pytest.fixture
def mock_client():
    """Create a mock Web3 client."""
    client = MagicMock(spec=Web3Client)
    client.is_connected = True
    client.chain_id = 1
    client.call = AsyncMock()
    client.web3 = MagicMock()
    return client


@pytest.fixture
def multicall(mock_client):
    """Create Multicall3 instance with mock client."""
    return Multicall3(client=mock_client)


class TestMulticallInit:
    """Tests for Multicall3 initialization."""

    def test_default_address(self, mock_client):
        """Uses default Multicall3 address."""
        mc = Multicall3(mock_client)
        assert mc._address == MULTICALL3_ADDRESS

    def test_custom_address(self, mock_client):
        """Accepts custom Multicall3 address."""
        custom = "0x1234567890123456789012345678901234567890"
        mc = Multicall3(mock_client, multicall_address=custom)
        assert mc._address.lower() == custom.lower()

    def test_custom_batch_size(self, mock_client):
        """Accepts custom batch size."""
        mc = Multicall3(mock_client, batch_size=50)
        assert mc._batch_size == 50


class TestAggregate:
    """Tests for aggregate function."""

    @pytest.mark.asyncio
    async def test_aggregate_empty(self, multicall):
        """Empty calls returns empty results."""
        results = await multicall.aggregate([])
        assert results == []

    @pytest.mark.asyncio
    async def test_aggregate_single_call(self, multicall, mock_client):
        """Single call is aggregated correctly."""
        # Mock response: [(true, bytes)]
        mock_client.call.return_value = encode(
            ["(bool,bytes)[]"],
            [[(True, b"\x00" * 32)]],
        )

        calls = [Call(target="0x1234567890123456789012345678901234567890", call_data=b"\x00\x01\x02\x03")]
        results = await multicall.aggregate(calls)

        assert len(results) == 1
        assert results[0].success is True
        assert len(results[0].return_data) == 32

    @pytest.mark.asyncio
    async def test_aggregate_multiple_calls(self, multicall, mock_client):
        """Multiple calls are aggregated."""
        mock_client.call.return_value = encode(
            ["(bool,bytes)[]"],
            [
                [
                    (True, encode(["uint256"], [100])),
                    (True, encode(["uint256"], [200])),
                    (False, b""),
                ]
            ],
        )

        calls = [
            Call(target="0x1111111111111111111111111111111111111111", call_data=b"\x01"),
            Call(target="0x2222222222222222222222222222222222222222", call_data=b"\x02"),
            Call(target="0x3333333333333333333333333333333333333333", call_data=b"\x03"),
        ]
        results = await multicall.aggregate(calls)

        assert len(results) == 3
        assert results[0].success is True
        assert results[1].success is True
        assert results[2].success is False

    @pytest.mark.asyncio
    async def test_aggregate_batch_splitting(self, multicall, mock_client):
        """Large call lists are split into batches."""
        multicall._batch_size = 2

        # First batch response
        response1 = encode(
            ["(bool,bytes)[]"],
            [[(True, b"\x01" * 32), (True, b"\x02" * 32)]],
        )
        # Second batch response
        response2 = encode(
            ["(bool,bytes)[]"],
            [[(True, b"\x03" * 32)]],
        )
        mock_client.call.side_effect = [response1, response2]

        calls = [
            Call(target="0x1111111111111111111111111111111111111111", call_data=b"\x01"),
            Call(target="0x2222222222222222222222222222222222222222", call_data=b"\x02"),
            Call(target="0x3333333333333333333333333333333333333333", call_data=b"\x03"),
        ]
        results = await multicall.aggregate(calls)

        assert len(results) == 3
        assert mock_client.call.call_count == 2

    @pytest.mark.asyncio
    async def test_aggregate_failure_returns_empty_results(self, multicall, mock_client):
        """Failed batch returns failure results for all calls."""
        mock_client.call.side_effect = Exception("RPC error")

        calls = [
            Call(target="0x1111111111111111111111111111111111111111", call_data=b"\x01"),
            Call(target="0x2222222222222222222222222222222222222222", call_data=b"\x02"),
        ]
        results = await multicall.aggregate(calls)

        assert len(results) == 2
        assert all(not r.success for r in results)


class TestGetBalances:
    """Tests for balance queries."""

    @pytest.mark.asyncio
    async def test_get_balances_empty(self, multicall):
        """Empty queries returns empty results."""
        results = await multicall.get_balances([])
        assert results == []

    @pytest.mark.asyncio
    async def test_get_eth_balances(self, multicall, mock_client):
        """Get native ETH balances."""
        # Mock getEthBalance responses
        mock_client.call.return_value = encode(
            ["(bool,bytes)[]"],
            [
                [
                    (True, encode(["uint256"], [1000000000000000000])),
                    (True, encode(["uint256"], [2000000000000000000])),
                ]
            ],
        )

        queries = [
            BalanceQuery(address="0x1111111111111111111111111111111111111111"),
            BalanceQuery(address="0x2222222222222222222222222222222222222222"),
        ]
        results = await multicall.get_balances(queries)

        assert len(results) == 2
        assert results[0].balance == 1000000000000000000
        assert results[1].balance == 2000000000000000000
        assert all(r.token is None for r in results)

    @pytest.mark.asyncio
    async def test_get_token_balances(self, multicall, mock_client):
        """Get ERC20 token balances."""
        mock_client.call.return_value = encode(
            ["(bool,bytes)[]"],
            [
                [
                    (True, encode(["uint256"], [500 * 10**18])),
                ]
            ],
        )

        queries = [
            BalanceQuery(
                address="0x1111111111111111111111111111111111111111",
                token="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",  # USDC
            ),
        ]
        results = await multicall.get_balances(queries)

        assert len(results) == 1
        assert results[0].balance == 500 * 10**18
        assert results[0].token is not None

    @pytest.mark.asyncio
    async def test_get_mixed_balances(self, multicall, mock_client):
        """Get both ETH and token balances."""
        # First call for ETH balances
        eth_response = encode(
            ["(bool,bytes)[]"],
            [[(True, encode(["uint256"], [1 * 10**18]))]],
        )
        # Second call for token balances
        token_response = encode(
            ["(bool,bytes)[]"],
            [[(True, encode(["uint256"], [1000 * 10**6]))]],
        )
        mock_client.call.side_effect = [eth_response, token_response]

        queries = [
            BalanceQuery(address="0x1111111111111111111111111111111111111111"),
            BalanceQuery(
                address="0x1111111111111111111111111111111111111111",
                token="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            ),
        ]
        results = await multicall.get_balances(queries)

        assert len(results) == 2

    @pytest.mark.asyncio
    async def test_get_balances_partial_failure(self, multicall, mock_client):
        """Handle partial failures gracefully."""
        mock_client.call.return_value = encode(
            ["(bool,bytes)[]"],
            [
                [
                    (True, encode(["uint256"], [1000])),
                    (False, b""),  # Failed
                ]
            ],
        )

        queries = [
            BalanceQuery(
                address="0x1111111111111111111111111111111111111111",
                token="0xAAAA111111111111111111111111111111111111",
            ),
            BalanceQuery(
                address="0x2222222222222222222222222222222222222222",
                token="0xBBBB222222222222222222222222222222222222",
            ),
        ]
        results = await multicall.get_balances(queries)

        assert len(results) == 2
        assert results[0].success is True
        assert results[1].success is False


class TestGetTokenInfo:
    """Tests for token metadata queries."""

    @pytest.mark.asyncio
    async def test_get_token_info_empty(self, multicall):
        """Empty token list returns empty results."""
        results = await multicall.get_token_info([])
        assert results == []

    @pytest.mark.asyncio
    async def test_get_token_info(self, multicall, mock_client):
        """Get token name, symbol, decimals."""
        # Mock responses for name, symbol, decimals
        mock_client.call.return_value = encode(
            ["(bool,bytes)[]"],
            [
                [
                    (True, encode(["string"], ["USD Coin"])),
                    (True, encode(["string"], ["USDC"])),
                    (True, encode(["uint8"], [6])),
                ]
            ],
        )

        results = await multicall.get_token_info(["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"])

        assert len(results) == 1
        assert results[0]["name"] == "USD Coin"
        assert results[0]["symbol"] == "USDC"
        assert results[0]["decimals"] == 6

    @pytest.mark.asyncio
    async def test_get_token_info_multiple(self, multicall, mock_client):
        """Get info for multiple tokens."""
        mock_client.call.return_value = encode(
            ["(bool,bytes)[]"],
            [
                [
                    # Token 1
                    (True, encode(["string"], ["Wrapped Ether"])),
                    (True, encode(["string"], ["WETH"])),
                    (True, encode(["uint8"], [18])),
                    # Token 2
                    (True, encode(["string"], ["Dai Stablecoin"])),
                    (True, encode(["string"], ["DAI"])),
                    (True, encode(["uint8"], [18])),
                ]
            ],
        )

        results = await multicall.get_token_info(["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "0x6B175474E89094C44Da98b954EedeAC495271d0F"])

        assert len(results) == 2
        assert results[0]["symbol"] == "WETH"
        assert results[1]["symbol"] == "DAI"

    @pytest.mark.asyncio
    async def test_get_token_info_partial_failure(self, multicall, mock_client):
        """Handle failed metadata calls."""
        mock_client.call.return_value = encode(
            ["(bool,bytes)[]"],
            [
                [
                    (False, b""),  # name failed
                    (True, encode(["string"], ["???"])),
                    (False, b""),  # decimals failed
                ]
            ],
        )

        results = await multicall.get_token_info(["0xBAD0000000000000000000000000000000000000"])

        assert len(results) == 1
        assert results[0]["name"] is None
        assert results[0]["symbol"] == "???"
        assert results[0]["decimals"] == 18  # Default


class TestCheckDeployed:
    """Tests for deployment check."""

    @pytest.mark.asyncio
    async def test_check_deployed_true(self, multicall, mock_client):
        """Returns True when contract exists."""
        mock_client.web3.eth.get_code = AsyncMock(return_value=b"\x60\x80\x60\x40")

        result = await multicall.check_deployed()
        assert result is True

    @pytest.mark.asyncio
    async def test_check_deployed_false(self, multicall, mock_client):
        """Returns False when no contract."""
        mock_client.web3.eth.get_code = AsyncMock(return_value=b"")

        result = await multicall.check_deployed()
        assert result is False

    @pytest.mark.asyncio
    async def test_check_deployed_error(self, multicall, mock_client):
        """Returns False on error."""
        mock_client.web3.eth.get_code = AsyncMock(side_effect=Exception("RPC error"))

        result = await multicall.check_deployed()
        assert result is False
