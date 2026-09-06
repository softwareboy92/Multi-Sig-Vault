"""Unit tests for EVM Safe history import logic."""

import json
from datetime import UTC, datetime
from decimal import Decimal

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.chains.evm.safe_tx_service import SafeTxServiceClient
from multivault.models.network import NetworkConfig
from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus
from multivault.models.transaction import Transaction, TransactionStatus, TransactionType
from multivault.models.wallet import Wallet, WalletSigner, WalletStatus
from multivault.services.transaction_service import TransactionService


# --------------- fixtures ---------------

@pytest.fixture
async def evm_network(async_session: AsyncSession) -> NetworkConfig:
    network = NetworkConfig(
        chain_type="EVM",
        name="Sepolia",
        explorer_url="https://sepolia.etherscan.io",
        enabled=True,
        is_testnet=True,
        extra='{"chain_id": 11155111}',
    )
    async_session.add(network)
    await async_session.commit()
    await async_session.refresh(network)
    return network


@pytest.fixture
async def signers(async_session: AsyncSession) -> list[Signer]:
    result = []
    for i in range(2):
        s = Signer(
            name=f"Signer {i+1}",
            device_type=DeviceType.METAMASK,
            chain_type=ChainType.EVM,
            address=f"0xOwner{i+1}",
            status=SignerStatus.VERIFIED,
            verified_at=datetime.now(UTC),
        )
        async_session.add(s)
        result.append(s)
    await async_session.flush()
    return result


@pytest.fixture
async def safe_wallet(
    async_session: AsyncSession,
    signers: list[Signer],
    evm_network: NetworkConfig,
) -> Wallet:
    wallet = Wallet(
        name="Test Safe",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=2,
        address="0xSafeAddress",
        status=WalletStatus.ACTIVE,
        deployed_at=datetime.now(UTC),
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.flush()
    for i, signer in enumerate(signers):
        ws = WalletSigner(wallet_id=wallet.id, signer_id=signer.id, order_index=i)
        async_session.add(ws)
    await async_session.flush()
    return wallet


@pytest.fixture
def tx_service(async_session: AsyncSession) -> TransactionService:
    return TransactionService(async_session)


@pytest.fixture
def sample_multisig_tx() -> dict:
    """A sample executed multisig transaction from Safe TX Service."""
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


@pytest.fixture
def sample_erc20_multisig_tx() -> dict:
    """ERC20 transfer via Safe multisig."""
    return {
        "safe": "0xSafeAddress",
        "to": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "value": "0",
        "data": "0xa9059cbb000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd00000000000000000000000000000000000000000000000000000000000f4240",
        "operation": 0,
        "safeTxGas": "0",
        "baseGas": "0",
        "gasPrice": "0",
        "gasToken": "0x0000000000000000000000000000000000000000",
        "refundReceiver": "0x0000000000000000000000000000000000000000",
        "nonce": 6,
        "executionDate": "2026-01-16T12:00:00Z",
        "submissionDate": "2026-01-16T11:30:00Z",
        "modified": "2026-01-16T12:00:00Z",
        "blockNumber": 12345700,
        "transactionHash": "0xtokentx1",
        "safeTxHash": "0xtokenhash1",
        "executor": "0xExecutor",
        "isExecuted": True,
        "isSuccessful": True,
        "confirmationsRequired": 2,
        "confirmations": [],
        "fee": "1500000000000000",
        "origin": "{}",
        "dataDecoded": None,
    }


@pytest.fixture
def sample_incoming_eth() -> dict:
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
def sample_incoming_erc20() -> dict:
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


def _make_safe_api_response(results: list[dict], next_url=None) -> httpx.Response:
    """Helper to create a mock Safe TX Service paginated response."""
    return httpx.Response(
        200,
        json={
            "count": len(results),
            "next": next_url,
            "previous": None,
            "results": results,
        },
        request=httpx.Request("GET", "https://example.com"),
    )


# --------------- multisig tx mapping ---------------

class TestImportMultisigTransaction:
    """Tests for importing outgoing multisig transactions."""

    async def test_import_eth_transfer(
        self, tx_service, safe_wallet, sample_multisig_tx, monkeypatch, async_session
    ):
        """ETH multisig transfer maps correctly."""
        async def mock_get(self_client, url, **kwargs):
            return _make_safe_api_response([sample_multisig_tx])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        result = await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100, include_incoming=False,
        )

        assert result["imported"] == 1
        assert result["multisig_imported"] == 1
        assert result["skipped"] == 0

        stmt = select(Transaction).where(Transaction.wallet_id == safe_wallet.id)
        rows = (await async_session.execute(stmt)).scalars().all()
        assert len(rows) == 1

        tx = rows[0]
        assert tx.payload_hash == "0xdef456"
        assert tx.tx_hash == "0xabc123"
        assert tx.to_address == "0xRecipient"
        assert tx.amount == Decimal("1")
        assert tx.safe_nonce == 5
        assert tx.status == TransactionStatus.CONFIRMED
        assert tx.tx_type == TransactionType.TRANSFER
        assert tx.threshold == 2
        assert tx.block_number == 12345678
        assert "IMPORTED_SAFE_HISTORY" in tx.description

    async def test_import_erc20_transfer(
        self, tx_service, safe_wallet, sample_erc20_multisig_tx, monkeypatch, async_session
    ):
        """ERC20 transfer via execTransaction → TOKEN_TRANSFER type with correct decimals."""
        async def mock_get(self_client, url, **kwargs):
            return _make_safe_api_response([sample_erc20_multisig_tx])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        # Mock Web3Client so _resolve_token_info returns USDC decimals
        class _MockWeb3Client:
            def __init__(self, **kwargs): pass
            async def connect(self): pass
            async def disconnect(self): pass
            async def get_erc20_info(self, address):
                return {"symbol": "USDC", "name": "USD Coin", "decimals": 6}

        monkeypatch.setattr(
            "multivault.chains.evm.web3_client.Web3Client", _MockWeb3Client,
        )

        result = await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100,
            include_incoming=False, rpc_url="http://mock-rpc",
        )

        assert result["multisig_imported"] == 1
        stmt = select(Transaction).where(Transaction.wallet_id == safe_wallet.id)
        tx = (await async_session.execute(stmt)).scalars().first()
        assert tx.tx_type == TransactionType.TOKEN_TRANSFER
        # ERC20 amount: raw 0xf4240 = 1000000 / 10^6 (USDC) = 1.0
        assert tx.amount == Decimal("1")
        extra = json.loads(tx.extra)
        assert extra["token_decimals"] == 6
        assert extra["token_symbol"] == "USDC"
        assert "token_address" in extra
        assert "token_recipient" in extra

    async def test_import_erc20_transfer_no_rpc_url(
        self, tx_service, safe_wallet, sample_erc20_multisig_tx, monkeypatch, async_session
    ):
        """ERC20 transfer without rpc_url → fallback to 18 decimals."""
        async def mock_get(self_client, url, **kwargs):
            return _make_safe_api_response([sample_erc20_multisig_tx])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        result = await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100, include_incoming=False,
        )
        assert result["multisig_imported"] == 1
        stmt = select(Transaction).where(Transaction.wallet_id == safe_wallet.id)
        tx = (await async_session.execute(stmt)).scalars().first()
        assert tx.tx_type == TransactionType.TOKEN_TRANSFER
        # 0xf4240 = 1000000, fallback to 18 decimals → 1e-12
        assert tx.amount == Decimal("1000000") / Decimal(10**18)

    async def test_failed_tx_imported_with_failed_status(
        self, tx_service, safe_wallet, sample_multisig_tx, monkeypatch, async_session
    ):
        """isSuccessful=false → FAILED status."""
        failed_tx = {**sample_multisig_tx, "isSuccessful": False}
        async def mock_get(self_client, url, **kwargs):
            return _make_safe_api_response([failed_tx])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100, include_incoming=False,
        )
        stmt = select(Transaction).where(Transaction.wallet_id == safe_wallet.id)
        tx = (await async_session.execute(stmt)).scalars().first()
        assert tx.status == TransactionStatus.FAILED

    async def test_dedup_by_payload_hash(
        self, tx_service, safe_wallet, sample_multisig_tx, monkeypatch, async_session
    ):
        """Already existing payload_hash is skipped."""
        existing = Transaction(
            wallet_id=safe_wallet.id,
            tx_type=TransactionType.TRANSFER,
            to_address="0xRecipient",
            amount=Decimal("1"),
            payload="{}",
            payload_hash="0xdef456",
            threshold=2,
            signature_count=2,
            status=TransactionStatus.CONFIRMED,
            tx_hash="0xabc123",
        )
        async_session.add(existing)
        await async_session.commit()

        async def mock_get(self_client, url, **kwargs):
            return _make_safe_api_response([sample_multisig_tx])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        result = await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100, include_incoming=False,
        )
        assert result["imported"] == 0
        assert result["skipped"] == 1

    async def test_fetch_error_returns_in_errors(
        self, tx_service, safe_wallet, monkeypatch, async_session
    ):
        """SafeTxServiceError during fetch is caught and recorded in errors."""
        from multivault.chains.evm.safe_tx_service import SafeTxServiceClient, SafeTxServiceError

        async def mock_fetch_raise(*args, **kwargs):
            raise SafeTxServiceError("Test fetch error")

        monkeypatch.setattr(SafeTxServiceClient, "get_multisig_transactions", mock_fetch_raise)
        monkeypatch.setattr(SafeTxServiceClient, "get_incoming_transfers", mock_fetch_raise)

        result = await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100, include_incoming=True,
        )
        assert result["imported"] == 0
        assert len(result["errors"]) >= 2
        assert any("multisig_fetch" in e["tx_ref"] for e in result["errors"])
        assert any("incoming_fetch" in e["tx_ref"] for e in result["errors"])

    async def test_import_contract_call(
        self, tx_service, safe_wallet, sample_multisig_tx, monkeypatch, async_session
    ):
        """Non-transfer data → CONTRACT_CALL type."""
        contract_tx = {
            **sample_multisig_tx,
            "value": "0",
            "data": "0x12345678aabbccdd",
            "safeTxHash": "0xcontracthash1",
            "transactionHash": "0xcontracttx1",
        }
        async def mock_get(self_client, url, **kwargs):
            return _make_safe_api_response([contract_tx])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        result = await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100, include_incoming=False,
        )
        assert result["multisig_imported"] == 1
        stmt = select(Transaction).where(Transaction.wallet_id == safe_wallet.id)
        tx = (await async_session.execute(stmt)).scalars().first()
        assert tx.tx_type == TransactionType.CONTRACT_CALL


# --------------- incoming transfer mapping ---------------

class TestImportIncomingTransfers:
    """Tests for importing incoming ETH/ERC20 transfers."""

    async def test_import_eth_incoming(
        self, tx_service, safe_wallet, sample_incoming_eth, monkeypatch, async_session
    ):
        call_urls = []
        async def mock_get(self_client, url, **kwargs):
            call_urls.append(url)
            if "multisig-transactions" in url:
                return _make_safe_api_response([])
            return _make_safe_api_response([sample_incoming_eth])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        result = await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100, include_incoming=True,
        )
        assert result["incoming_imported"] == 1

        stmt = select(Transaction).where(Transaction.wallet_id == safe_wallet.id)
        tx = (await async_session.execute(stmt)).scalars().first()
        assert tx.to_address == "0xSafeAddress"  # wallet's own address (recipient)
        assert tx.amount == Decimal("0.5")
        assert tx.tx_type == TransactionType.TRANSFER
        assert tx.status == TransactionStatus.CONFIRMED
        assert "IMPORTED_SAFE_HISTORY:IN" in tx.description
        extra = json.loads(tx.extra) if isinstance(tx.extra, str) else tx.extra
        assert extra["from_address"] == "0xSenderAddress"  # sender stored in extra

    async def test_import_erc20_incoming(
        self, tx_service, safe_wallet, sample_incoming_erc20, monkeypatch, async_session
    ):
        async def mock_get(self_client, url, **kwargs):
            if "multisig-transactions" in url:
                return _make_safe_api_response([])
            return _make_safe_api_response([sample_incoming_erc20])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        result = await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100, include_incoming=True,
        )
        assert result["incoming_imported"] == 1

        stmt = select(Transaction).where(Transaction.wallet_id == safe_wallet.id)
        tx = (await async_session.execute(stmt)).scalars().first()
        assert tx.tx_type == TransactionType.TOKEN_TRANSFER
        extra = json.loads(tx.extra) if isinstance(tx.extra, str) else tx.extra
        assert extra["token_address"] == "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
        assert extra["token_symbol"] == "USDC"
        assert extra["token_decimals"] == 6
        assert extra["from_address"] == "0xSenderAddress2"  # sender stored in extra

    async def test_import_erc20_incoming_no_token_info(
        self, tx_service, safe_wallet, sample_incoming_erc20, monkeypatch, async_session
    ):
        """Incoming ERC20 without tokenInfo → resolve decimals via web3 fallback."""
        # Strip tokenInfo from fixture
        no_info_tx = {**sample_incoming_erc20, "tokenInfo": None}

        async def mock_get(self_client, url, **kwargs):
            if "multisig-transactions" in url:
                return _make_safe_api_response([])
            return _make_safe_api_response([no_info_tx])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        class _MockWeb3Client:
            def __init__(self, **kwargs): pass
            async def connect(self): pass
            async def disconnect(self): pass
            async def get_erc20_info(self, address):
                return {"symbol": "USDC", "name": "USD Coin", "decimals": 6}

        monkeypatch.setattr(
            "multivault.chains.evm.web3_client.Web3Client", _MockWeb3Client,
        )

        result = await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100,
            include_incoming=True, rpc_url="http://mock-rpc",
        )
        assert result["incoming_imported"] == 1

        stmt = select(Transaction).where(Transaction.wallet_id == safe_wallet.id)
        tx = (await async_session.execute(stmt)).scalars().first()
        assert tx.tx_type == TransactionType.TOKEN_TRANSFER
        # value=1000000, USDC decimals=6 → 1.0
        assert tx.amount == Decimal("1")
        extra = json.loads(tx.extra) if isinstance(tx.extra, str) else tx.extra
        assert extra["token_symbol"] == "USDC"
        assert extra["token_decimals"] == 6

    async def test_dedup_incoming_by_tx_hash(
        self, tx_service, safe_wallet, sample_incoming_eth, monkeypatch, async_session
    ):
        """Already existing tx_hash for incoming is skipped."""
        existing = Transaction(
            wallet_id=safe_wallet.id,
            tx_type=TransactionType.TRANSFER,
            to_address="0xSafeAddress",
            amount=Decimal("0.5"),
            payload="",
            payload_hash="incoming:0xincoming1",
            threshold=1,
            signature_count=1,
            status=TransactionStatus.CONFIRMED,
            tx_hash="0xincoming1",
        )
        async_session.add(existing)
        await async_session.commit()

        async def mock_get(self_client, url, **kwargs):
            if "multisig-transactions" in url:
                return _make_safe_api_response([])
            return _make_safe_api_response([sample_incoming_eth])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        result = await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100, include_incoming=True,
        )
        assert result["skipped"] >= 1
        assert result["incoming_imported"] == 0

    async def test_include_incoming_false_skips_incoming(
        self, tx_service, safe_wallet, sample_multisig_tx, monkeypatch, async_session
    ):
        """include_incoming=False → only multisig txs fetched."""
        urls_called = []
        async def mock_get(self_client, url, **kwargs):
            urls_called.append(url)
            return _make_safe_api_response([sample_multisig_tx])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id=11155111, limit=100, include_incoming=False,
        )
        assert not any("incoming-transfers" in u for u in urls_called)


    async def test_chain_id_as_string(
        self, tx_service, safe_wallet, sample_multisig_tx, monkeypatch, async_session
    ):
        """chain_id passed as string (from JSON deserialization) works."""
        async def mock_get(self_client, url, **kwargs):
            return _make_safe_api_response([sample_multisig_tx])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        result = await tx_service.import_evm_safe_history(
            wallet=safe_wallet, chain_id="11155111", limit=100, include_incoming=False,
        )
        assert result["imported"] == 1


class TestEVMHistoryImportAPI:
    """Integration tests for the API endpoint."""

    async def test_endpoint_returns_result(
        self, client: AsyncClient, safe_wallet, evm_network, sample_multisig_tx, monkeypatch
    ):
        """POST /wallets/{id}/evm/history/import returns import summary."""
        async def mock_get(self_client, url, **kwargs):
            return _make_safe_api_response([sample_multisig_tx])
        monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

        resp = await client.post(
            f"/api/v1/wallets/{safe_wallet.id}/evm/history/import",
            json={"limit": 100, "include_incoming": False},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["imported"] >= 0
        assert "multisig_imported" in data
        assert "incoming_imported" in data

    async def test_endpoint_rejects_btc_wallet(
        self, client: AsyncClient, async_session
    ):
        """Non-EVM wallet returns 400."""
        btc_network = NetworkConfig(
            chain_type="BTC",
            name="Bitcoin",
            enabled=True,
            extra='{"btc_network": "mainnet"}',
        )
        async_session.add(btc_network)
        await async_session.flush()

        btc_wallet = Wallet(
            name="BTC Wallet",
            chain_type=ChainType.BTC,
            threshold=2,
            signer_count=3,
            address="bc1q_test_address",
            status=WalletStatus.ACTIVE,
            network_id=btc_network.id,
        )
        async_session.add(btc_wallet)
        await async_session.commit()
        await async_session.refresh(btc_wallet)

        resp = await client.post(
            f"/api/v1/wallets/{btc_wallet.id}/evm/history/import",
            json={},
        )
        assert resp.status_code == 400
