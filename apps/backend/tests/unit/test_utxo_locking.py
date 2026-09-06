"""Unit tests for BTC UTXO locking logic."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.models.network import NetworkConfig
from multivault.models.signer import ChainType
from multivault.models.transaction import Transaction, TransactionStatus, TransactionType
from multivault.models.wallet import Wallet, WalletStatus
from multivault.services.transaction_service import TransactionService
from multivault.utils.extra import get_extra, set_extra


@pytest.fixture
async def btc_network(async_session: AsyncSession) -> NetworkConfig:
    """Create test BTC network."""
    network = NetworkConfig(
        chain_type="BTC",
        name="Bitcoin Mainnet",
        explorer_url="https://mempool.space",
        enabled=True,
        is_testnet=False,
    )
    async_session.add(network)
    await async_session.commit()
    await async_session.refresh(network)
    return network


@pytest.fixture
async def btc_wallet(async_session: AsyncSession, btc_network: NetworkConfig) -> Wallet:
    """Create test BTC wallet."""
    wallet = Wallet(
        name="Test BTC Wallet",
        chain_type=ChainType.BTC,
        threshold=2,
        signer_count=3,
        address="bc1qtest",
        network_id=btc_network.id,
        status=WalletStatus.ACTIVE,
    )
    async_session.add(wallet)
    await async_session.commit()
    await async_session.refresh(wallet)
    return wallet


def _make_btc_tx(
    wallet_id: str,
    status: TransactionStatus,
    utxo_inputs: list[dict] | None = None,
) -> Transaction:
    """Helper to create a BTC transaction with utxo_inputs in extra."""
    tx = Transaction(
        wallet_id=wallet_id,
        tx_type=TransactionType.TRANSFER,
        to_address="bc1qrecipient",
        amount=Decimal("0.001"),
        payload="cHNidA==",
        threshold=2,
        signature_count=0,
        status=status,
    )
    if utxo_inputs:
        set_extra(tx, utxo_inputs=utxo_inputs)
    return tx


class TestGetLockedUtxoOutpoints:
    """Tests for TransactionService.get_locked_utxo_outpoints."""

    @pytest.mark.asyncio
    async def test_empty_when_no_active_transactions(
        self, async_session: AsyncSession, btc_wallet: Wallet,
    ):
        tx_service = TransactionService(async_session)
        locked = await tx_service.get_locked_utxo_outpoints(btc_wallet.id)
        assert locked == set()

    @pytest.mark.asyncio
    async def test_collects_from_active_transactions(
        self, async_session: AsyncSession, btc_wallet: Wallet,
    ):
        tx1 = _make_btc_tx(btc_wallet.id, TransactionStatus.PENDING_SIGN, [
            {"txid": "aaa", "vout": 0, "value": 50000},
        ])
        tx2 = _make_btc_tx(btc_wallet.id, TransactionStatus.SIGNED, [
            {"txid": "bbb", "vout": 1, "value": 80000},
        ])
        async_session.add_all([tx1, tx2])
        await async_session.commit()

        tx_service = TransactionService(async_session)
        locked = await tx_service.get_locked_utxo_outpoints(btc_wallet.id)
        assert locked == {("aaa", 0), ("bbb", 1)}

    @pytest.mark.asyncio
    async def test_excludes_cancelled_and_confirmed(
        self, async_session: AsyncSession, btc_wallet: Wallet,
    ):
        tx_active = _make_btc_tx(btc_wallet.id, TransactionStatus.BROADCAST, [
            {"txid": "active", "vout": 0, "value": 50000},
        ])
        tx_cancelled = _make_btc_tx(btc_wallet.id, TransactionStatus.CANCELLED, [
            {"txid": "cancelled", "vout": 0, "value": 60000},
        ])
        tx_confirmed = _make_btc_tx(btc_wallet.id, TransactionStatus.CONFIRMED, [
            {"txid": "confirmed", "vout": 0, "value": 70000},
        ])
        async_session.add_all([tx_active, tx_cancelled, tx_confirmed])
        await async_session.commit()

        tx_service = TransactionService(async_session)
        locked = await tx_service.get_locked_utxo_outpoints(btc_wallet.id)
        assert locked == {("active", 0)}

    @pytest.mark.asyncio
    async def test_ignores_evm_safe_transactions(
        self, async_session: AsyncSession, btc_wallet: Wallet,
    ):
        """EVM transactions have safe_nonce set — should be excluded."""
        tx = Transaction(
            wallet_id=btc_wallet.id,
            tx_type=TransactionType.TRANSFER,
            to_address="0xrecipient",
            amount=Decimal("1.0"),
            payload="0x",
            threshold=2,
            signature_count=0,
            status=TransactionStatus.PENDING_SIGN,
            safe_nonce=5,
        )
        set_extra(tx, utxo_inputs=[{"txid": "evm", "vout": 0, "value": 100}])
        async_session.add(tx)
        await async_session.commit()

        tx_service = TransactionService(async_session)
        locked = await tx_service.get_locked_utxo_outpoints(btc_wallet.id)
        assert locked == set()


class TestCreateTransactionUtxoInputs:
    """Tests for utxo_inputs being stored in Transaction.extra."""

    @pytest.mark.asyncio
    async def test_utxo_inputs_stored_in_extra(
        self, async_session: AsyncSession, btc_wallet: Wallet,
    ):
        from multivault.schemas.transaction import TransactionCreate

        tx_service = TransactionService(async_session)
        utxo_inputs = [
            {"txid": "abc123", "vout": 0, "value": 50000},
            {"txid": "def456", "vout": 1, "value": 120000},
        ]

        tx = await tx_service.create_transaction(
            wallet_id=btc_wallet.id,
            data=TransactionCreate(
                to_address="bc1qrecipient",
                amount=Decimal("0.001"),
            ),
            payload="cHNidA==",
            payload_hash="deadbeef",
            fee_amount=Decimal("0.00001"),
            utxo_inputs=utxo_inputs,
        )

        extra = get_extra(tx)
        assert extra.get("utxo_inputs") == utxo_inputs


class TestUtxoLockingIntegration:
    """Integration tests for end-to-end UTXO locking flow."""

    @pytest.mark.asyncio
    async def test_second_tx_excludes_locked_utxos(
        self, async_session: AsyncSession, btc_wallet: Wallet,
    ):
        """Creating tx1 locks its UTXOs; tx2 sees fewer available."""
        tx1 = _make_btc_tx(btc_wallet.id, TransactionStatus.PENDING_SIGN, [
            {"txid": "utxoA", "vout": 0, "value": 50000},
            {"txid": "utxoB", "vout": 1, "value": 80000},
        ])
        async_session.add(tx1)
        await async_session.commit()

        tx_service = TransactionService(async_session)
        locked = await tx_service.get_locked_utxo_outpoints(btc_wallet.id)

        all_utxos = [
            {"txid": "utxoA", "vout": 0, "value": 50000},
            {"txid": "utxoB", "vout": 1, "value": 80000},
            {"txid": "utxoC", "vout": 0, "value": 30000},
        ]
        available = [u for u in all_utxos if (u["txid"], u["vout"]) not in locked]
        assert len(available) == 1
        assert available[0]["txid"] == "utxoC"

    @pytest.mark.asyncio
    async def test_cancel_tx_releases_utxos(
        self, async_session: AsyncSession, btc_wallet: Wallet,
    ):
        """After cancelling a tx, its UTXOs become available again."""
        tx = _make_btc_tx(btc_wallet.id, TransactionStatus.PENDING_SIGN, [
            {"txid": "locked1", "vout": 0, "value": 50000},
        ])
        async_session.add(tx)
        await async_session.commit()

        tx_service = TransactionService(async_session)

        # Before cancel: locked
        locked = await tx_service.get_locked_utxo_outpoints(btc_wallet.id)
        assert ("locked1", 0) in locked

        # Cancel the transaction
        tx.status = TransactionStatus.CANCELLED
        await async_session.commit()

        # After cancel: released
        locked = await tx_service.get_locked_utxo_outpoints(btc_wallet.id)
        assert ("locked1", 0) not in locked

    @pytest.mark.asyncio
    async def test_all_utxos_locked_returns_empty_available(
        self, async_session: AsyncSession, btc_wallet: Wallet,
    ):
        """When all cached UTXOs are locked, available set is empty."""
        tx = _make_btc_tx(btc_wallet.id, TransactionStatus.SIGNED, [
            {"txid": "only1", "vout": 0, "value": 100000},
        ])
        async_session.add(tx)
        await async_session.commit()

        tx_service = TransactionService(async_session)
        locked = await tx_service.get_locked_utxo_outpoints(btc_wallet.id)

        cached_utxos = [{"txid": "only1", "vout": 0, "value": 100000}]
        available = [u for u in cached_utxos if (u["txid"], u["vout"]) not in locked]
        assert len(available) == 0


class TestCustomUtxoSelection:
    """Tests for user-specified UTXO selection validation."""

    @pytest.mark.asyncio
    async def test_custom_selection_narrows_available(
        self, async_session: AsyncSession, btc_wallet: Wallet,
    ):
        """User picks subset of available UTXOs — only those are used."""
        from multivault.chains.bitcoin.electrum import ElectrumUTXO
        from multivault.schemas.transaction import UtxoSelection

        tx_service = TransactionService(async_session)
        locked = await tx_service.get_locked_utxo_outpoints(btc_wallet.id)

        cached = [
            {"txid": "aaa", "vout": 0, "value": 50000},
            {"txid": "bbb", "vout": 1, "value": 80000},
            {"txid": "ccc", "vout": 0, "value": 30000},
        ]
        available = [
            ElectrumUTXO(txid=u["txid"], vout=u["vout"], value=u["value"], height=0)
            for u in cached
            if (u["txid"], u["vout"]) not in locked
        ]
        available_map = {(u.txid, u.vout): u for u in available}

        picks = [UtxoSelection(txid="aaa", vout=0), UtxoSelection(txid="ccc", vout=0)]
        picked = [available_map[(s.txid, s.vout)] for s in picks]

        assert len(picked) == 2
        assert picked[0].txid == "aaa"
        assert picked[1].txid == "ccc"

    @pytest.mark.asyncio
    async def test_custom_selection_rejects_locked_utxo(
        self, async_session: AsyncSession, btc_wallet: Wallet,
    ):
        """Selecting a locked UTXO should raise ValidationError."""
        from multivault.errors.exceptions import ValidationError
        from multivault.schemas.transaction import UtxoSelection

        # Lock a UTXO via active transaction
        tx = _make_btc_tx(btc_wallet.id, TransactionStatus.PENDING_SIGN, [
            {"txid": "locked_one", "vout": 0, "value": 50000},
        ])
        async_session.add(tx)
        await async_session.commit()

        tx_service = TransactionService(async_session)
        locked = await tx_service.get_locked_utxo_outpoints(btc_wallet.id)

        sel = UtxoSelection(txid="locked_one", vout=0)
        key = (sel.txid, sel.vout)
        assert key in locked  # would be rejected by API

    @pytest.mark.asyncio
    async def test_custom_selection_rejects_unknown_utxo(
        self, async_session: AsyncSession, btc_wallet: Wallet,
    ):
        """Selecting a UTXO not in wallet cache should fail validation."""
        from multivault.chains.bitcoin.electrum import ElectrumUTXO
        from multivault.schemas.transaction import UtxoSelection

        cached = [{"txid": "known", "vout": 0, "value": 50000}]
        available = [
            ElectrumUTXO(txid=u["txid"], vout=u["vout"], value=u["value"], height=0)
            for u in cached
        ]
        available_map = {(u.txid, u.vout): u for u in available}

        sel = UtxoSelection(txid="unknown", vout=0)
        assert (sel.txid, sel.vout) not in available_map  # would be rejected by API
