"""Unit tests for SafeTxServiceClient."""

import asyncio

import httpx
import pytest

from multivault.chains.evm.safe_tx_service import (
    SafeTxServiceClient,
    SafeTxServiceError,
)


class TestSafeTxServiceClientInit:
    """Tests for SafeTxServiceClient initialization and network routing."""

    def test_supported_chain_ethereum_mainnet(self):
        client = SafeTxServiceClient(chain_id=1)
        assert client.is_supported()
        assert client._base_api_url == "https://api.safe.global/tx-service/eth/api/v1"

    def test_supported_chain_sepolia(self):
        client = SafeTxServiceClient(chain_id=11155111)
        assert client.is_supported()
        assert client._base_api_url == "https://api.safe.global/tx-service/sep/api/v1"

    def test_supported_chain_polygon(self):
        client = SafeTxServiceClient(chain_id=137)
        assert client.is_supported()
        assert "matic" in client._base_api_url

    def test_supported_chain_arbitrum(self):
        client = SafeTxServiceClient(chain_id=42161)
        assert client.is_supported()
        assert "arb" in client._base_api_url

    def test_supported_chain_base(self):
        client = SafeTxServiceClient(chain_id=8453)
        assert client.is_supported()
        assert "base" in client._base_api_url

    def test_unsupported_chain(self):
        client = SafeTxServiceClient(chain_id=999999)
        assert not client.is_supported()

    def test_unsupported_chain_base_url_none(self):
        client = SafeTxServiceClient(chain_id=999999)
        assert client._base_api_url is None

    def test_chain_id_as_string(self):
        """chain_id passed as string (from JSON config) is accepted."""
        client = SafeTxServiceClient(chain_id="11155111")
        assert client.is_supported()
        assert client.chain_id == 11155111


class TestGetMultisigTransactions:
    """Tests for fetching multisig transactions with mocked HTTP."""

    @pytest.fixture
    def client(self):
        return SafeTxServiceClient(chain_id=1)

    @pytest.fixture
    def sample_multisig_tx(self) -> dict:
        return {
            "safe": "0xSafeAddress",
            "to": "0xRecipient",
            "value": "1000000000000000000",
            "data": None,
            "operation": 0,
            "safeTxGas": "0",
            "baseGas": "0",
            "gasPrice": "0",
            "gasToken": "0x0000000000000000000000000000000000000000",
            "refundReceiver": "0x0000000000000000000000000000000000000000",
            "nonce": 5,
            "executionDate": "2026-01-15T10:30:00Z",
            "submissionDate": "2026-01-15T10:00:00Z",
            "modified": "2026-01-15T10:30:00Z",
            "blockNumber": 12345678,
            "transactionHash": "0xabc123",
            "safeTxHash": "0xdef456",
            "executor": "0xExecutor",
            "isExecuted": True,
            "isSuccessful": True,
            "confirmationsRequired": 2,
            "confirmations": [
                {"owner": "0xOwner1", "submissionDate": "2026-01-15T10:05:00Z", "signature": "0xsig1", "signatureType": "EOA"},
                {"owner": "0xOwner2", "submissionDate": "2026-01-15T10:10:00Z", "signature": "0xsig2", "signatureType": "EOA"},
            ],
            "fee": "2100000000000000",
            "origin": "{}",
            "dataDecoded": None,
        }

    async def test_fetch_single_page(self, client, sample_multisig_tx, monkeypatch):
        mock_response = httpx.Response(
            200,
            json={"count": 1, "next": None, "previous": None, "results": [sample_multisig_tx]},
            request=httpx.Request("GET", "https://example.com"),
        )

        async def mock_get(self_client, url, **kwargs):
            return mock_response

        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        results = await client.get_multisig_transactions("0xSafeAddress", limit=10)
        assert len(results) == 1
        assert results[0]["safeTxHash"] == "0xdef456"
        assert results[0]["value"] == "1000000000000000000"

    async def test_fetch_with_pagination(self, client, sample_multisig_tx, monkeypatch):
        tx1 = {**sample_multisig_tx, "safeTxHash": "0xhash1", "nonce": 2}
        tx2 = {**sample_multisig_tx, "safeTxHash": "0xhash2", "nonce": 1}

        page1 = httpx.Response(
            200,
            json={
                "count": 2,
                "next": "https://api.safe.global/tx-service/eth/api/v1/safes/0xSafe/multisig-transactions/?offset=1",
                "previous": None,
                "results": [tx1],
            },
            request=httpx.Request("GET", "https://example.com"),
        )
        page2 = httpx.Response(
            200,
            json={"count": 2, "next": None, "previous": None, "results": [tx2]},
            request=httpx.Request("GET", "https://example.com"),
        )

        call_count = 0

        async def mock_get(self_client, url, **kwargs):
            nonlocal call_count
            call_count += 1
            return page1 if call_count == 1 else page2

        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        results = await client.get_multisig_transactions("0xSafeAddress", limit=10)
        assert len(results) == 2
        assert call_count == 2

    async def test_fetch_respects_limit(self, client, sample_multisig_tx, monkeypatch):
        txs = [{**sample_multisig_tx, "safeTxHash": f"0xh{i}", "nonce": i} for i in range(5)]
        mock_response = httpx.Response(
            200,
            json={"count": 5, "next": None, "previous": None, "results": txs},
            request=httpx.Request("GET", "https://example.com"),
        )

        async def mock_get(self_client, url, **kwargs):
            return mock_response

        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        results = await client.get_multisig_transactions("0xSafeAddress", limit=3)
        assert len(results) == 3

    async def test_unsupported_chain_raises(self):
        client = SafeTxServiceClient(chain_id=999999)
        with pytest.raises(SafeTxServiceError, match="not supported"):
            await client.get_multisig_transactions("0xSafe")

    async def test_network_error_raises(self, client, monkeypatch):
        async def mock_get(self_client, url, **kwargs):
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        # Eliminate retry sleep to keep test fast
        async def _noop_sleep(_seconds):
            pass

        monkeypatch.setattr(asyncio, "sleep", _noop_sleep)

        with pytest.raises(SafeTxServiceError, match="failed after"):
            await client.get_multisig_transactions("0xSafe", limit=1)


class TestGetIncomingTransfers:
    """Tests for fetching incoming transfers."""

    @pytest.fixture
    def client(self):
        return SafeTxServiceClient(chain_id=1)

    @pytest.fixture
    def sample_eth_transfer(self) -> dict:
        return {
            "type": "ETHER_TRANSFER",
            "executionDate": "2026-01-10T08:00:00Z",
            "blockNumber": 12345000,
            "transactionHash": "0xincoming1",
            "to": "0xSafeAddress",
            "from": "0xSenderAddress",
            "value": "500000000000000000",
            "tokenId": None,
            "tokenAddress": None,
            "tokenInfo": None,
        }

    @pytest.fixture
    def sample_erc20_transfer(self) -> dict:
        return {
            "type": "ERC20_TRANSFER",
            "executionDate": "2026-01-11T09:00:00Z",
            "blockNumber": 12345100,
            "transactionHash": "0xincoming2",
            "to": "0xSafeAddress",
            "from": "0xSenderAddress2",
            "value": "1000000",
            "tokenId": None,
            "tokenAddress": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            "tokenInfo": {
                "type": "ERC20",
                "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                "name": "USD Coin",
                "symbol": "USDC",
                "decimals": 6,
                "logoUri": "https://example.com/usdc.png",
            },
        }

    async def test_fetch_eth_transfer(self, client, sample_eth_transfer, monkeypatch):
        mock_response = httpx.Response(
            200,
            json={"count": 1, "next": None, "previous": None, "results": [sample_eth_transfer]},
            request=httpx.Request("GET", "https://example.com"),
        )

        async def mock_get(self_client, url, **kwargs):
            return mock_response

        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        results = await client.get_incoming_transfers("0xSafeAddress", limit=10)
        assert len(results) == 1
        assert results[0]["transactionHash"] == "0xincoming1"
        assert results[0]["tokenAddress"] is None

    async def test_fetch_erc20_transfer(self, client, sample_erc20_transfer, monkeypatch):
        mock_response = httpx.Response(
            200,
            json={"count": 1, "next": None, "previous": None, "results": [sample_erc20_transfer]},
            request=httpx.Request("GET", "https://example.com"),
        )

        async def mock_get(self_client, url, **kwargs):
            return mock_response

        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        results = await client.get_incoming_transfers("0xSafeAddress", limit=10)
        assert len(results) == 1
        assert results[0]["tokenAddress"] == "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
        assert results[0]["tokenInfo"]["symbol"] == "USDC"
