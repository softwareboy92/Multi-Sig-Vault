"""Tests for EVM history import status sync (compensating stale txs via Safe API)."""

import json
import pytest
from datetime import UTC, datetime

from multivault.models.network import NetworkConfig
from multivault.models.signer import ChainType
from multivault.models.transaction import Transaction, TransactionStatus, TransactionType
from multivault.models.wallet import Wallet, WalletStatus
from multivault.services.transaction_service import TransactionService


def _make_wallet_and_network(async_session):
    """Create test EVM network + wallet, add to session."""
    network = NetworkConfig(
        chain_type="EVM",
        name="Sepolia",
        explorer_url="https://sepolia.etherscan.io",
        enabled=True,
        is_testnet=True,
        extra='{"chain_id": 11155111}',
    )
    async_session.add(network)
    wallet = Wallet(
        id="w-sync-test",
        name="Sync Test Wallet",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=3,
        address="0xSafeAddress",
        status=WalletStatus.ACTIVE,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    return network, wallet


@pytest.mark.asyncio
async def test_import_syncs_signed_tx_to_confirmed(async_session):
    """SIGNED tx whose payload_hash matches an executed Safe tx → CONFIRMED.

    This is the core scenario: user broadcast via MetaMask, broadcastTransaction
    API failed, tx stuck at SIGNED. Safe API shows it's executed successfully.
    History import should detect the match and update status.
    """
    network, wallet = _make_wallet_and_network(async_session)
    async_session.add(network)
    await async_session.flush()
    wallet.network_id = network.id
    async_session.add(wallet)

    # Existing SIGNED tx in DB (broadcastTransaction API never called)
    tx = Transaction(
        id="tx-stuck-signed",
        wallet_id=wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0xRecipient",
        amount=1000000000000000000,
        payload="{}",
        payload_hash="0xSafeTxHashABC",
        threshold=2,
        signature_count=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=5,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    async_session.add(tx)
    await async_session.commit()

    # Simulate Safe API returning this tx as executed
    multisig_txs = [
        {
            "safeTxHash": "0xSafeTxHashABC",
            "transactionHash": "0xOnChainHash123",
            "blockNumber": 99999,
            "isSuccessful": True,
            "executionDate": "2026-03-31T10:00:00Z",
            "nonce": 5,
            "value": "1000000000000000000",
            "to": "0xRecipient",
            "data": None,
            "operation": 0,
            "executor": "0xExecutor",
            "confirmations": [{"owner": "0xA"}, {"owner": "0xB"}],
            "confirmationsRequired": 2,
            "fee": None,
        }
    ]

    service = TransactionService(async_session)
    now = datetime.now(UTC)

    # payload_hash matches existing → goes into "existing" set
    existing_payload_hashes = {"0xSafeTxHashABC"}
    existing_tx_hashes: set[str] = set()

    stats = await service._do_import(
        wallet, "0xSafeAddress", now,
        multisig_txs, [],
        existing_payload_hashes, existing_tx_hashes,
        None, {},
    )

    await async_session.refresh(tx)

    # The stuck SIGNED tx should now be CONFIRMED
    assert tx.status == TransactionStatus.CONFIRMED
    assert tx.tx_hash == "0xOnChainHash123"
    assert tx.block_number == 99999
    assert tx.confirmed_at is not None
    assert stats["synced"] >= 1


@pytest.mark.asyncio
async def test_import_clears_error_message_on_confirm(async_session):
    """SIGNED tx with stale error_message from NonceSyncWorker → CONFIRMED clears error."""
    network, wallet = _make_wallet_and_network(async_session)
    async_session.add(network)
    await async_session.flush()
    wallet.network_id = network.id
    async_session.add(wallet)

    tx = Transaction(
        id="tx-with-stale-error",
        wallet_id=wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0xRecipient",
        amount=1000000000000000000,
        payload="{}",
        payload_hash="0xSafeTxHashERR",
        threshold=2,
        signature_count=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=8,
        error_message="Safe nonce 9 > tx nonce 8: likely executed externally",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    async_session.add(tx)
    await async_session.commit()

    multisig_txs = [
        {
            "safeTxHash": "0xSafeTxHashERR",
            "transactionHash": "0xOnChainHashOK",
            "blockNumber": 101000,
            "isSuccessful": True,
            "executionDate": "2026-03-31T12:00:00Z",
            "nonce": 8,
            "value": "1000000000000000000",
            "to": "0xRecipient",
            "data": None,
            "operation": 0,
            "executor": "0xExecutor",
            "confirmations": [{"owner": "0xA"}, {"owner": "0xB"}],
            "confirmationsRequired": 2,
            "fee": None,
        }
    ]

    service = TransactionService(async_session)
    now = datetime.now(UTC)

    stats = await service._do_import(
        wallet, "0xSafeAddress", now,
        multisig_txs, [],
        {"0xSafeTxHashERR"}, set(),
        None, {},
    )

    await async_session.refresh(tx)

    assert tx.status == TransactionStatus.CONFIRMED
    assert tx.error_message is None
    assert stats["synced"] >= 1


@pytest.mark.asyncio
async def test_import_syncs_failed_tx_from_safe_api(async_session):
    """SIGNED tx matching a failed Safe execution → FAILED."""
    network, wallet = _make_wallet_and_network(async_session)
    async_session.add(network)
    await async_session.flush()
    wallet.network_id = network.id
    async_session.add(wallet)

    tx = Transaction(
        id="tx-stuck-signed-2",
        wallet_id=wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0xRecipient",
        amount=500000000000000000,
        payload="{}",
        payload_hash="0xSafeTxHashDEF",
        threshold=2,
        signature_count=2,
        status=TransactionStatus.SIGNED,
        safe_nonce=6,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    async_session.add(tx)
    await async_session.commit()

    multisig_txs = [
        {
            "safeTxHash": "0xSafeTxHashDEF",
            "transactionHash": "0xOnChainHashFailed",
            "blockNumber": 100000,
            "isSuccessful": False,
            "executionDate": "2026-03-31T11:00:00Z",
            "nonce": 6,
            "value": "500000000000000000",
            "to": "0xRecipient",
            "data": None,
            "operation": 0,
            "executor": "0xExecutor",
            "confirmations": [{"owner": "0xA"}, {"owner": "0xB"}],
            "confirmationsRequired": 2,
            "fee": None,
        }
    ]

    service = TransactionService(async_session)
    now = datetime.now(UTC)
    existing_payload_hashes = {"0xSafeTxHashDEF"}

    stats = await service._do_import(
        wallet, "0xSafeAddress", now,
        multisig_txs, [],
        existing_payload_hashes, set(),
        None, {},
    )

    await async_session.refresh(tx)

    assert tx.status == TransactionStatus.FAILED
    assert tx.tx_hash == "0xOnChainHashFailed"
    assert "execution failed" in (tx.error_message or "").lower()
    assert stats["synced"] >= 1


@pytest.mark.asyncio
async def test_import_skips_already_confirmed_tx(async_session):
    """Already CONFIRMED tx → no change, counted as skipped (not synced)."""
    network, wallet = _make_wallet_and_network(async_session)
    async_session.add(network)
    await async_session.flush()
    wallet.network_id = network.id
    async_session.add(wallet)

    tx = Transaction(
        id="tx-already-confirmed",
        wallet_id=wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0xRecipient",
        amount=100,
        payload="{}",
        payload_hash="0xSafeTxHashGHI",
        threshold=2,
        signature_count=2,
        status=TransactionStatus.CONFIRMED,
        tx_hash="0xExistingHash",
        block_number=88888,
        confirmed_at=datetime.now(UTC),
        safe_nonce=7,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    async_session.add(tx)
    await async_session.commit()

    multisig_txs = [
        {
            "safeTxHash": "0xSafeTxHashGHI",
            "transactionHash": "0xExistingHash",
            "blockNumber": 88888,
            "isSuccessful": True,
            "executionDate": "2026-03-31T09:00:00Z",
            "nonce": 7,
            "value": "100",
            "to": "0xRecipient",
            "data": None,
            "operation": 0,
            "executor": "0xExecutor",
            "confirmations": [],
            "confirmationsRequired": 2,
            "fee": None,
        }
    ]

    service = TransactionService(async_session)
    now = datetime.now(UTC)
    existing_payload_hashes = {"0xSafeTxHashGHI"}

    stats = await service._do_import(
        wallet, "0xSafeAddress", now,
        multisig_txs, [],
        existing_payload_hashes, set(),
        None, {},
    )

    await async_session.refresh(tx)

    # Should remain CONFIRMED, counted as skip not sync
    assert tx.status == TransactionStatus.CONFIRMED
    assert tx.tx_hash == "0xExistingHash"  # unchanged
    assert stats["synced"] == 0
    assert stats["skipped"] >= 1


@pytest.mark.asyncio
async def test_import_recovers_failed_tx_to_confirmed(async_session):
    """FAILED tx (from NonceSyncWorker) + Safe API isSuccessful=True → CONFIRMED.

    NonceSyncWorker may mark a SIGNED tx as FAILED due to nonce gap.
    If the Indexer window also passed, Safe API import is the last resort
    to recover the tx to CONFIRMED.
    """
    network, wallet = _make_wallet_and_network(async_session)
    async_session.add(network)
    await async_session.flush()
    wallet.network_id = network.id
    async_session.add(wallet)

    tx = Transaction(
        id="tx-failed-recoverable",
        wallet_id=wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0xRecipient",
        amount=2000000000000000000,
        payload="{}",
        payload_hash="0xSafeTxHashFAILED",
        threshold=2,
        signature_count=2,
        status=TransactionStatus.FAILED,
        safe_nonce=10,
        error_message="Safe nonce 11 > tx nonce 10: likely executed externally",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    async_session.add(tx)
    await async_session.commit()

    multisig_txs = [
        {
            "safeTxHash": "0xSafeTxHashFAILED",
            "transactionHash": "0xOnChainHashRecovered",
            "blockNumber": 120000,
            "isSuccessful": True,
            "executionDate": "2026-03-31T14:00:00Z",
            "nonce": 10,
            "value": "2000000000000000000",
            "to": "0xRecipient",
            "data": None,
            "operation": 0,
            "executor": "0xExecutor",
            "confirmations": [{"owner": "0xA"}, {"owner": "0xB"}],
            "confirmationsRequired": 2,
            "fee": None,
        }
    ]

    service = TransactionService(async_session)
    now = datetime.now(UTC)

    stats = await service._do_import(
        wallet, "0xSafeAddress", now,
        multisig_txs, [],
        {"0xSafeTxHashFAILED"}, set(),
        None, {},
    )

    await async_session.refresh(tx)

    assert tx.status == TransactionStatus.CONFIRMED
    assert tx.tx_hash == "0xOnChainHashRecovered"
    assert tx.error_message is None
    assert tx.confirmed_at is not None
    assert stats["synced"] >= 1


@pytest.mark.asyncio
async def test_import_skips_failed_tx_when_still_failed(async_session):
    """FAILED tx + Safe API isSuccessful=False → no change (already failed)."""
    network, wallet = _make_wallet_and_network(async_session)
    async_session.add(network)
    await async_session.flush()
    wallet.network_id = network.id
    async_session.add(wallet)

    tx = Transaction(
        id="tx-failed-still-failed",
        wallet_id=wallet.id,
        tx_type=TransactionType.TRANSFER,
        to_address="0xRecipient",
        amount=500000000000000000,
        payload="{}",
        payload_hash="0xSafeTxHashFF",
        threshold=2,
        signature_count=2,
        status=TransactionStatus.FAILED,
        safe_nonce=11,
        error_message="Safe nonce 12 > tx nonce 11: likely executed externally",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    async_session.add(tx)
    await async_session.commit()

    multisig_txs = [
        {
            "safeTxHash": "0xSafeTxHashFF",
            "transactionHash": "0xOnChainHashReverted",
            "blockNumber": 121000,
            "isSuccessful": False,
            "executionDate": "2026-03-31T15:00:00Z",
            "nonce": 11,
            "value": "500000000000000000",
            "to": "0xRecipient",
            "data": None,
            "operation": 0,
            "executor": "0xExecutor",
            "confirmations": [{"owner": "0xA"}, {"owner": "0xB"}],
            "confirmationsRequired": 2,
            "fee": None,
        }
    ]

    service = TransactionService(async_session)
    now = datetime.now(UTC)

    stats = await service._do_import(
        wallet, "0xSafeAddress", now,
        multisig_txs, [],
        {"0xSafeTxHashFF"}, set(),
        None, {},
    )

    await async_session.refresh(tx)

    # Should remain FAILED with original error message, not overwritten
    assert tx.status == TransactionStatus.FAILED
    assert "nonce" in tx.error_message.lower()
    assert stats["synced"] == 0
    assert stats["skipped"] >= 1
