"""Unit tests for Transaction and Signature models."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus
from multivault.models.transaction import (
    Signature,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from multivault.models.wallet import Wallet, WalletSigner, WalletStatus
from multivault.models.network import NetworkConfig


@pytest.fixture
async def evm_network(async_session: AsyncSession) -> NetworkConfig:
    """Create a sample EVM network for tests."""
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
async def sample_signer(async_session: AsyncSession) -> Signer:
    """Create a sample signer for tests."""
    signer = Signer(
        name="Test Signer",
        device_type=DeviceType.METAMASK,
        chain_type=ChainType.EVM,
        address="0x1234567890123456789012345678901234567890",
        status=SignerStatus.VERIFIED,
        verified_at=datetime.now(UTC),
    )
    async_session.add(signer)
    await async_session.flush()
    return signer


@pytest.fixture
async def sample_wallet(
    async_session: AsyncSession,
    sample_signer: Signer,
    evm_network: NetworkConfig,
) -> Wallet:
    """Create a sample wallet for tests."""
    wallet = Wallet(
        name="Test Wallet",
        chain_type=ChainType.EVM,
        threshold=1,
        signer_count=1,
        address="0xSafeAddress1234567890123456789012345678",
        status=WalletStatus.ACTIVE,
        deployed_at=datetime.now(UTC),
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.flush()

    # Link signer
    ws = WalletSigner(
        wallet_id=wallet.id,
        signer_id=sample_signer.id,
        order_index=0,
    )
    async_session.add(ws)
    await async_session.flush()

    return wallet


@pytest.fixture
async def sample_transaction(
    async_session: AsyncSession,
    sample_wallet: Wallet,
) -> Transaction:
    """Create a sample transaction for tests."""
    tx = Transaction(
        wallet_id=sample_wallet.id,
        tx_type=TransactionType.TRANSFER,
        description="Test transfer",
        to_address="0xRecipient12345678901234567890123456789",
        amount=Decimal("1.5"),
        payload="test_payload_data",
        payload_hash="0xhash",
        fee_amount=Decimal("0.001"),
        threshold=sample_wallet.threshold,
        signature_count=0,
        status=TransactionStatus.PENDING_SIGN,
    )
    from multivault.utils.extra import set_extra
    set_extra(tx, fee_rate=20)
    async_session.add(tx)
    await async_session.flush()
    return tx


class TestTransactionModel:
    """Tests for Transaction model."""

    async def test_create_transaction(
        self,
        async_session: AsyncSession,
        sample_wallet: Wallet,
    ):
        """Test creating a transaction."""
        tx = Transaction(
            wallet_id=sample_wallet.id,
            tx_type=TransactionType.TRANSFER,
            to_address="0xRecipient12345678901234567890123456789",
            amount=Decimal("100.5"),
            payload="psbt_or_safe_data",
            threshold=2,
        )
        async_session.add(tx)
        await async_session.flush()

        assert tx.id is not None
        assert tx.status == TransactionStatus.PENDING_SIGN
        assert tx.signature_count == 0
        assert tx.is_pending is True
        assert tx.is_complete is False
        assert tx.is_final is False

    async def test_transaction_status_transitions(
        self,
        sample_transaction: Transaction,
    ):
        """Test transaction status property helpers."""
        tx = sample_transaction

        # PENDING_SIGN (initial status)
        assert tx.status == TransactionStatus.PENDING_SIGN
        assert tx.is_pending
        assert tx.can_sign
        assert not tx.is_final
        assert not tx.is_complete

        # PARTIALLY_SIGNED
        tx.status = TransactionStatus.PARTIALLY_SIGNED
        assert tx.is_pending
        assert tx.can_sign

        # SIGNED (threshold met)
        tx.signature_count = tx.threshold
        tx.status = TransactionStatus.SIGNED
        assert tx.is_complete
        assert not tx.is_pending
        assert not tx.can_sign

        # CONFIRMED (final)
        tx.status = TransactionStatus.CONFIRMED
        assert tx.is_final

    async def test_transaction_types(
        self,
        async_session: AsyncSession,
        sample_wallet: Wallet,
    ):
        """Test different transaction types."""
        # Token transfer
        tx = Transaction(
            wallet_id=sample_wallet.id,
            tx_type=TransactionType.TOKEN_TRANSFER,
            to_address="0xRecipient12345678901234567890123456789",
            amount=Decimal("1000"),
            payload="transfer_data",
            threshold=1,
        )
        from multivault.utils.extra import set_extra, get_extra_field
        set_extra(tx, token_address="0xTokenContract123456789012345678901234",
                  token_symbol="USDT", token_decimals=6)
        async_session.add(tx)
        await async_session.flush()

        assert tx.tx_type == TransactionType.TOKEN_TRANSFER
        assert get_extra_field(tx, "token_address") is not None
        assert get_extra_field(tx, "token_symbol") == "USDT"
        assert get_extra_field(tx, "token_decimals") == 6

    async def test_transaction_with_on_chain_data(
        self,
        sample_transaction: Transaction,
    ):
        """Test transaction with on-chain confirmation data."""
        tx = sample_transaction
        tx.status = TransactionStatus.CONFIRMED
        tx.tx_hash = "0x" + "a" * 64
        tx.block_number = 12345678
        from multivault.utils.extra import set_extra
        set_extra(tx, block_hash="0x" + "b" * 64)
        tx.confirmed_at = datetime.now(UTC)

        assert tx.tx_hash.startswith("0x")
        assert tx.block_number == 12345678
        assert tx.is_final

    async def test_transaction_repr(
        self,
        sample_transaction: Transaction,
    ):
        """Test transaction string representation."""
        tx = sample_transaction
        repr_str = repr(tx)
        assert "Transaction" in repr_str
        assert tx.id in repr_str


class TestSignatureModel:
    """Tests for Signature model."""

    async def test_create_signature(
        self,
        async_session: AsyncSession,
        sample_transaction: Transaction,
        sample_signer: Signer,
    ):
        """Test creating a signature."""
        sig = Signature(
            transaction_id=sample_transaction.id,
            signer_id=sample_signer.id,
            signature_data="0x" + "ab" * 65,
            signature_type=2,  # eth_sign
            verified=True,
            verified_at=datetime.now(UTC),
        )
        async_session.add(sig)
        await async_session.flush()

        assert sig.id is not None
        assert sig.verified is True
        assert sig.signature_type == 2

    async def test_signature_unique_constraint(
        self,
        async_session: AsyncSession,
        sample_transaction: Transaction,
        sample_signer: Signer,
    ):
        """Test that same signer cannot sign twice."""
        sig1 = Signature(
            transaction_id=sample_transaction.id,
            signer_id=sample_signer.id,
            signature_data="signature_1",
            verified=True,
        )
        async_session.add(sig1)
        await async_session.flush()

        # Try to add duplicate
        sig2 = Signature(
            transaction_id=sample_transaction.id,
            signer_id=sample_signer.id,
            signature_data="signature_2",
            verified=True,
        )
        async_session.add(sig2)

        with pytest.raises(Exception):  # IntegrityError wrapped
            await async_session.flush()

    async def test_signature_repr(
        self,
        async_session: AsyncSession,
        sample_transaction: Transaction,
        sample_signer: Signer,
    ):
        """Test signature string representation."""
        sig = Signature(
            transaction_id=sample_transaction.id,
            signer_id=sample_signer.id,
            signature_data="sig_data",
            verified=True,
        )
        async_session.add(sig)
        await async_session.flush()

        repr_str = repr(sig)
        assert "Signature" in repr_str
        assert sig.id in repr_str


class TestTransactionRelationships:
    """Tests for Transaction-related relationships."""

    async def test_transaction_wallet_relationship(
        self,
        async_session: AsyncSession,
        sample_transaction: Transaction,
        sample_wallet: Wallet,
    ):
        """Test transaction to wallet relationship."""
        # Reload with relationship
        stmt = select(Transaction).where(Transaction.id == sample_transaction.id)
        result = await async_session.execute(stmt)
        tx = result.scalar_one()

        # Access relationship
        await async_session.refresh(tx, ["wallet"])
        assert tx.wallet.id == sample_wallet.id
        assert tx.wallet.name == "Test Wallet"

    async def test_transaction_signatures_relationship(
        self,
        async_session: AsyncSession,
        sample_transaction: Transaction,
        sample_signer: Signer,
    ):
        """Test transaction to signatures relationship."""
        # Add signatures
        sig = Signature(
            transaction_id=sample_transaction.id,
            signer_id=sample_signer.id,
            signature_data="sig_data",
            verified=True,
        )
        async_session.add(sig)
        await async_session.flush()

        # Reload with relationship
        stmt = select(Transaction).where(Transaction.id == sample_transaction.id)
        result = await async_session.execute(stmt)
        tx = result.scalar_one()

        await async_session.refresh(tx, ["signatures"])
        assert len(tx.signatures) == 1
        assert tx.signatures[0].signer_id == sample_signer.id

    async def test_signature_signer_relationship(
        self,
        async_session: AsyncSession,
        sample_transaction: Transaction,
        sample_signer: Signer,
    ):
        """Test signature to signer relationship."""
        sig = Signature(
            transaction_id=sample_transaction.id,
            signer_id=sample_signer.id,
            signature_data="sig_data",
            verified=True,
        )
        async_session.add(sig)
        await async_session.flush()

        # Reload with relationship
        stmt = select(Signature).where(Signature.id == sig.id)
        result = await async_session.execute(stmt)
        sig = result.scalar_one()

        await async_session.refresh(sig, ["signer"])
        assert sig.signer.id == sample_signer.id
        assert sig.signer.name == "Test Signer"

    async def test_cascade_delete_signatures(
        self,
        async_session: AsyncSession,
        sample_transaction: Transaction,
        sample_signer: Signer,
    ):
        """Test that deleting transaction cascades to signatures."""
        # Add signature
        sig = Signature(
            transaction_id=sample_transaction.id,
            signer_id=sample_signer.id,
            signature_data="sig_data",
            verified=True,
        )
        async_session.add(sig)
        await async_session.flush()
        sig_id = sig.id

        # Delete transaction
        await async_session.delete(sample_transaction)
        await async_session.flush()

        # Verify signature is gone
        stmt = select(Signature).where(Signature.id == sig_id)
        result = await async_session.execute(stmt)
        assert result.scalar_one_or_none() is None


def test_safe_policy_change_type_exists():
    """SAFE_POLICY_CHANGE must be a valid TransactionType."""
    from multivault.models.transaction import TransactionType

    assert hasattr(TransactionType, "SAFE_POLICY_CHANGE")
    assert TransactionType.SAFE_POLICY_CHANGE.value == "SAFE_POLICY_CHANGE"
