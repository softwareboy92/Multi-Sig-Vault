"""Unit tests for KeyVault signing payload generation (business_data correctness)."""

import json
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.models.network import NetworkConfig
from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus
from multivault.models.transaction import Transaction, TransactionStatus, TransactionType
from multivault.models.wallet import Wallet, WalletSigner, WalletStatus
from multivault.services.transaction_service import TransactionService
from multivault.utils.extra import set_extra


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def evm_network(async_session: AsyncSession) -> NetworkConfig:
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
async def polygon_network(async_session: AsyncSession) -> NetworkConfig:
    network = NetworkConfig(
        chain_type="EVM",
        name="Polygon",
        explorer_url="https://polygonscan.com",
        enabled=True,
        is_testnet=False,
        extra='{"chain_id": 137}',
    )
    async_session.add(network)
    await async_session.commit()
    await async_session.refresh(network)
    return network


@pytest.fixture
async def keyvault_signer(async_session: AsyncSession) -> Signer:
    signer = Signer(
        name="KV Signer",
        device_type=DeviceType.KEYVAULT,
        chain_type=ChainType.EVM,
        address="0xSignerAddress0000000000000000000000001",
        status=SignerStatus.VERIFIED,
        verified_at=datetime.now(UTC),
    )
    async_session.add(signer)
    await async_session.flush()
    return signer


@pytest.fixture
async def evm_wallet(
    async_session: AsyncSession,
    keyvault_signer: Signer,
    evm_network: NetworkConfig,
) -> Wallet:
    wallet = Wallet(
        name="Test Safe",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=2,
        address="0xSafeAddress0000000000000000000000000001",
        status=WalletStatus.ACTIVE,
        deployed_at=datetime.now(UTC),
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.flush()
    ws = WalletSigner(
        wallet_id=wallet.id,
        signer_id=keyvault_signer.id,
        order_index=0,
    )
    async_session.add(ws)
    await async_session.flush()
    return wallet


@pytest.fixture
async def polygon_wallet(
    async_session: AsyncSession,
    keyvault_signer: Signer,
    polygon_network: NetworkConfig,
) -> Wallet:
    wallet = Wallet(
        name="Polygon Safe",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=2,
        address="0xPolySafeAddress0000000000000000000000001",
        status=WalletStatus.ACTIVE,
        deployed_at=datetime.now(UTC),
        network_id=polygon_network.id,
    )
    async_session.add(wallet)
    await async_session.flush()
    ws = WalletSigner(
        wallet_id=wallet.id,
        signer_id=keyvault_signer.id,
        order_index=0,
    )
    async_session.add(ws)
    await async_session.flush()
    return wallet


# Minimal EIP-712 TypedData for tests (only structure matters, not values)
SAMPLE_TYPED_DATA = json.dumps({
    "types": {
        "EIP712Domain": [{"name": "chainId", "type": "uint256"}],
        "SafeTx": [
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
        ],
    },
    "primaryType": "SafeTx",
    "domain": {"chainId": 1},
    "message": {"to": "0xContractOrRecipient", "value": "1000000000000000000"},
})


def _make_tx(
    async_session: AsyncSession,
    wallet: Wallet,
    *,
    tx_type: TransactionType = TransactionType.TRANSFER,
    to_address: str = "0xRecipient0000000000000000000000000000001",
    amount: str = "1.5",
    payload: str = SAMPLE_TYPED_DATA,
    description: str | None = None,
    extra_fields: dict | None = None,
) -> Transaction:
    """Helper to create a Transaction row without going through service layer."""
    tx = Transaction(
        wallet_id=wallet.id,
        tx_type=tx_type,
        to_address=to_address,
        amount=amount,
        fee_amount="0.001",
        threshold=wallet.threshold,
        status=TransactionStatus.PENDING_SIGN,
        payload=payload,
        description=description,
    )
    if extra_fields:
        set_extra(tx, **extra_fields)
    async_session.add(tx)
    return tx


def _parse_payload(result: dict) -> tuple[dict, dict]:
    """Parse business dict and transfer_item from payload result."""
    outer = json.loads(result["payload_json"])
    business = json.loads(outer["b_data"]["business_data"])
    w_meta = json.loads(outer["w_data"]["transfer_data"]["wallet_data"])
    transfer_item = w_meta["wallet_data"][0]
    return business, transfer_item


# We mock RSA signing since it needs a key file
@pytest.fixture(autouse=True)
def _mock_rsa():
    with patch(
        "multivault.services.transaction_service.rsa_sign_for_keyvault",
        return_value="mocked_sig",
    ):
        yield


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestKeyvaultPayloadBusinessData:
    """Verify business_data and transfer_item fields per tx_type."""

    async def test_native_transfer(
        self,
        async_session: AsyncSession,
        evm_wallet: Wallet,
        keyvault_signer: Signer,
    ):
        tx = _make_tx(async_session, evm_wallet, tx_type=TransactionType.TRANSFER)
        await async_session.flush()

        svc = TransactionService(async_session)
        result = await svc.generate_keyvault_signing_payload(tx.id, keyvault_signer.id)
        business, transfer_item = _parse_payload(result)

        assert business["symbol"] == "ETH"
        assert business["contract"] == ""
        assert "description" not in business
        assert transfer_item["symbol"] == "ETH"
        assert transfer_item["transfer_type"] == "transfer"

    async def test_erc20_token_transfer(
        self,
        async_session: AsyncSession,
        evm_wallet: Wallet,
        keyvault_signer: Signer,
    ):
        tx = _make_tx(
            async_session,
            evm_wallet,
            tx_type=TransactionType.TOKEN_TRANSFER,
            extra_fields={
                "token_symbol": "USDT",
                "token_address": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
                "token_decimals": 6,
            },
        )
        await async_session.flush()

        svc = TransactionService(async_session)
        result = await svc.generate_keyvault_signing_payload(tx.id, keyvault_signer.id)
        business, transfer_item = _parse_payload(result)

        assert business["symbol"] == "USDT"
        assert business["contract"] == "0xdAC17F958D2ee523a2206206994597C13D831ec7"
        assert transfer_item["symbol"] == "USDT"
        assert transfer_item["transfer_type"] == "transfer"

    async def test_erc20_on_polygon(
        self,
        async_session: AsyncSession,
        polygon_wallet: Wallet,
        keyvault_signer: Signer,
    ):
        tx = _make_tx(
            async_session,
            polygon_wallet,
            tx_type=TransactionType.TOKEN_TRANSFER,
            extra_fields={
                "token_symbol": "USDC",
                "token_address": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
                "token_decimals": 6,
            },
        )
        await async_session.flush()

        svc = TransactionService(async_session)
        result = await svc.generate_keyvault_signing_payload(tx.id, keyvault_signer.id)
        business, transfer_item = _parse_payload(result)

        # Must show token symbol, NOT chain native "POL"
        assert business["symbol"] == "USDC"
        assert business["contract"] == "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
        assert transfer_item["symbol"] == "USDC"
        assert business["chain_symbol"] == "POL"  # chain_symbol stays chain-level

    async def test_erc20_missing_token_symbol_fallback(
        self,
        async_session: AsyncSession,
        evm_wallet: Wallet,
        keyvault_signer: Signer,
    ):
        tx = _make_tx(
            async_session,
            evm_wallet,
            tx_type=TransactionType.TOKEN_TRANSFER,
            extra_fields={},  # no token metadata
        )
        await async_session.flush()

        svc = TransactionService(async_session)
        result = await svc.generate_keyvault_signing_payload(tx.id, keyvault_signer.id)
        business, transfer_item = _parse_payload(result)

        # Falls back to chain native symbol
        assert business["symbol"] == "ETH"
        assert business["contract"] == ""
        assert transfer_item["symbol"] == "ETH"

    async def test_safe_policy_change(
        self,
        async_session: AsyncSession,
        evm_wallet: Wallet,
        keyvault_signer: Signer,
    ):
        tx = _make_tx(
            async_session,
            evm_wallet,
            tx_type=TransactionType.SAFE_POLICY_CHANGE,
            description="Add owner 0xNewOwner, change threshold to 3",
        )
        await async_session.flush()

        svc = TransactionService(async_session)
        result = await svc.generate_keyvault_signing_payload(tx.id, keyvault_signer.id)
        business, transfer_item = _parse_payload(result)

        assert business["symbol"] == "ETH"
        assert business["contract"] == ""
        assert business["description"] == "Add owner 0xNewOwner, change threshold to 3"
        assert transfer_item["transfer_type"] == "policy_change"

    async def test_cancellation(
        self,
        async_session: AsyncSession,
        evm_wallet: Wallet,
        keyvault_signer: Signer,
    ):
        tx = _make_tx(
            async_session,
            evm_wallet,
            tx_type=TransactionType.CANCELLATION,
            description="Cancel pending transaction at nonce 42",
        )
        await async_session.flush()

        svc = TransactionService(async_session)
        result = await svc.generate_keyvault_signing_payload(tx.id, keyvault_signer.id)
        business, transfer_item = _parse_payload(result)

        assert business["symbol"] == "ETH"
        assert business["contract"] == ""
        assert business["description"] == "Cancel pending transaction at nonce 42"
        assert transfer_item["transfer_type"] == "cancellation"

    async def test_contract_call_regression(
        self,
        async_session: AsyncSession,
        evm_wallet: Wallet,
        keyvault_signer: Signer,
    ):
        tx = _make_tx(
            async_session,
            evm_wallet,
            tx_type=TransactionType.CONTRACT_CALL,
        )
        await async_session.flush()

        svc = TransactionService(async_session)
        result = await svc.generate_keyvault_signing_payload(tx.id, keyvault_signer.id)
        business, transfer_item = _parse_payload(result)

        assert business["symbol"] == "ETH"
        assert business["contract"] == ""
        assert "description" not in business
        assert transfer_item["transfer_type"] == "transfer"

    async def test_amount_precision_no_float_artifacts(
        self,
        async_session: AsyncSession,
        evm_wallet: Wallet,
        keyvault_signer: Signer,
    ):
        """Ensure amount/volume fields don't contain IEEE 754 float artifacts.

        SQLite stores Numeric as real; Decimal(float) can expand 0.0125
        into '0.0125000000000000006938...' — the payload must show '0.0125'.
        """
        tx = _make_tx(
            async_session,
            evm_wallet,
            tx_type=TransactionType.TOKEN_TRANSFER,
            amount="0.0125",
            extra_fields={
                "token_symbol": "LINK",
                "token_address": "0x514910771AF9Ca656af840dff83E8264EcF986CA",
                "token_decimals": 18,
            },
        )
        await async_session.flush()

        svc = TransactionService(async_session)
        result = await svc.generate_keyvault_signing_payload(tx.id, keyvault_signer.id)
        business, transfer_item = _parse_payload(result)

        # Must be clean "0.0125", not "0.012500000000000001"
        # amount is asset value (price * qty), currently always "0"
        assert business["to"][0]["amount"] == "0"
        assert business["to"][0]["volume"] == "0.0125"
        assert transfer_item["volume"] == "0.0125"
        assert business["fee"] == "0.001"
        assert business["fee_amount"] == "0.001"
