"""Unit tests for TransactionService."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.errors.exceptions import (
    ConflictError,
    NotFoundError,
    ValidationError,
    WalletNotActiveError,
)
from multivault.models.signer import ChainType, DeviceType, Signer, SignerStatus
from multivault.models.transaction import (
    Signature,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from multivault.models.wallet import Wallet, WalletSigner, WalletStatus
from multivault.utils.extra import get_extra
from multivault.models.network import NetworkConfig
from multivault.schemas.transaction import (
    SignatureSubmit,
    TransactionCreate,
    TransactionQuery,
)
from multivault.services.transaction_service import TransactionService


@pytest.fixture
async def evm_network(async_session: AsyncSession) -> NetworkConfig:
    """Create test EVM network configuration."""
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
async def signers(async_session: AsyncSession) -> list[Signer]:
    """Create multiple signers for multisig tests."""
    signers = []
    for i in range(3):
        signer = Signer(
            name=f"Signer {i + 1}",
            device_type=DeviceType.METAMASK,
            chain_type=ChainType.EVM,
            address=f"0x{'0' * 39}{i + 1}",
            status=SignerStatus.VERIFIED,
            verified_at=datetime.now(UTC),
        )
        async_session.add(signer)
        signers.append(signer)

    await async_session.flush()
    return signers


@pytest.fixture
async def active_wallet(
    async_session: AsyncSession,
    signers: list[Signer],
    evm_network: NetworkConfig,
) -> Wallet:
    """Create an active wallet with signers."""
    wallet = Wallet(
        name="Multisig Wallet",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=3,
        address="0xSafeAddress1234567890123456789012345678",
        status=WalletStatus.ACTIVE,
        deployed_at=datetime.now(UTC),
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.flush()

    for i, signer in enumerate(signers):
        ws = WalletSigner(
            wallet_id=wallet.id,
            signer_id=signer.id,
            order_index=i,
        )
        async_session.add(ws)

    await async_session.flush()
    return wallet


@pytest.fixture
async def pending_wallet(
    async_session: AsyncSession,
    signers: list[Signer],
    evm_network: NetworkConfig,
) -> Wallet:
    """Create a pending (not active) wallet."""
    wallet = Wallet(
        name="Pending Wallet",
        chain_type=ChainType.EVM,
        threshold=2,
        signer_count=3,
        status=WalletStatus.PENDING_DEPLOY,
        network_id=evm_network.id,
    )
    async_session.add(wallet)
    await async_session.flush()
    return wallet


@pytest.fixture
def tx_service(async_session: AsyncSession) -> TransactionService:
    """Create transaction service instance."""
    return TransactionService(async_session)


class TestCreateTransaction:
    """Tests for transaction creation."""

    async def test_create_transaction_success(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
    ):
        """Test successful transaction creation."""
        data = TransactionCreate(
            to_address="0xRecipient12345678901234567890123456789",
            amount=Decimal("1.5"),
            description="Test payment",
        )

        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test_payload",
            payload_hash="0xhash",
            fee_amount=Decimal("0.001"),
        )

        assert tx.id is not None
        assert tx.status == TransactionStatus.PENDING_SIGN
        assert tx.wallet_id == active_wallet.id
        assert tx.to_address == data.to_address
        assert tx.amount == data.amount
        assert tx.threshold == active_wallet.threshold

    async def test_create_transaction_wallet_not_found(
        self,
        tx_service: TransactionService,
    ):
        """Test error when wallet not found."""
        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )

        with pytest.raises(NotFoundError) as exc:
            await tx_service.create_transaction(
                wallet_id="nonexistent-id",
                data=data,
                payload="test",
            )
        assert "Wallet" in str(exc.value)

    async def test_create_transaction_wallet_not_active(
        self,
        tx_service: TransactionService,
        pending_wallet: Wallet,
    ):
        """Test error when wallet not active."""
        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )

        with pytest.raises(WalletNotActiveError):
            await tx_service.create_transaction(
                wallet_id=pending_wallet.id,
                data=data,
                payload="test",
            )

    async def test_create_token_transfer(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
    ):
        """Test creating a token transfer transaction."""
        data = TransactionCreate(
            to_address="0xRecipient12345678901234567890123456789",
            amount=Decimal("1000"),
            token_address="0xTokenContract123456789012345678901234",
        )

        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="token_transfer_payload",
            tx_type=TransactionType.TOKEN_TRANSFER,
            token_symbol="USDT",
            token_decimals=6,
        )

        assert tx.tx_type == TransactionType.TOKEN_TRANSFER
        from multivault.utils.extra import get_extra_field
        assert get_extra_field(tx, "token_address") == data.token_address
        assert get_extra_field(tx, "token_symbol") == "USDT"


class TestSubmitSignature:
    """Tests for signature submission."""

    async def test_submit_signature_success(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
        signers: list[Signer],
    ):
        """Test successful signature submission."""
        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )
        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test",
        )

        # Submit first signature
        sig_data = SignatureSubmit(
            signature_data="0x" + "ab" * 65,
            signature_type=2,
        )
        tx = await tx_service.submit_signature(tx.id, signers[0].id, sig_data)

        assert tx.signature_count == 1
        assert tx.status == TransactionStatus.PARTIALLY_SIGNED

        # Verify signature via separate query
        signatures = await tx_service.get_signatures(tx.id)
        assert len(signatures) == 1

    async def test_submit_signature_reaches_threshold(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
        signers: list[Signer],
    ):
        """Test transaction moves to SIGNED when threshold reached."""
        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )
        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test",
        )

        # Submit signatures to reach threshold (2)
        for i in range(2):
            sig_data = SignatureSubmit(signature_data=f"sig_{i}")
            tx = await tx_service.submit_signature(tx.id, signers[i].id, sig_data)

        assert tx.signature_count == 2
        assert tx.status == TransactionStatus.SIGNED
        assert tx.is_complete

    async def test_submit_signature_duplicate(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
        signers: list[Signer],
    ):
        """Test error when signer tries to sign twice."""
        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )
        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test",
        )

        # First signature
        sig_data = SignatureSubmit(signature_data="sig")
        await tx_service.submit_signature(tx.id, signers[0].id, sig_data)

        # Duplicate signature
        with pytest.raises(ConflictError):
            await tx_service.submit_signature(tx.id, signers[0].id, sig_data)

    async def test_submit_signature_wrong_signer(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
        async_session: AsyncSession,
    ):
        """Test error when signer not in wallet."""
        # Create another signer not in wallet
        other_signer = Signer(
            name="Outsider",
            device_type=DeviceType.METAMASK,
            chain_type=ChainType.EVM,
            address="0xOutsider1234567890123456789012345678",
            status=SignerStatus.VERIFIED,
        )
        async_session.add(other_signer)
        await async_session.flush()

        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )
        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test",
        )

        sig_data = SignatureSubmit(signature_data="sig")
        with pytest.raises(ValidationError) as exc:
            await tx_service.submit_signature(tx.id, other_signer.id, sig_data)
        assert "not a member" in str(exc.value.message)


class TestBroadcastTransaction:
    """Tests for transaction broadcast."""

    async def test_broadcast_transaction_success(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
        signers: list[Signer],
    ):
        """Test successful transaction broadcast."""
        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )
        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test",
        )

        for i in range(2):
            sig_data = SignatureSubmit(signature_data=f"sig_{i}")
            tx = await tx_service.submit_signature(tx.id, signers[i].id, sig_data)

        # Broadcast
        tx_hash = "0x" + "a" * 64
        tx = await tx_service.broadcast_transaction(tx.id, tx_hash=tx_hash)

        assert tx.status == TransactionStatus.BROADCAST
        assert tx.tx_hash == tx_hash

    async def test_broadcast_transaction_not_signed(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
    ):
        """Test error when broadcasting unsigned transaction."""
        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )
        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test",
        )

        with pytest.raises(ValidationError):
            await tx_service.broadcast_transaction(tx.id, tx_hash="0xhash")


class TestConfirmOnChain:
    """Tests for on-chain confirmation."""

    async def test_confirm_on_chain_success(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
        signers: list[Signer],
    ):
        """Test successful on-chain confirmation."""
        # Full flow: create -> confirm -> sign -> broadcast
        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )
        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test",
        )

        for i in range(2):
            sig_data = SignatureSubmit(signature_data=f"sig_{i}")
            tx = await tx_service.submit_signature(tx.id, signers[i].id, sig_data)

        tx = await tx_service.broadcast_transaction(tx.id, tx_hash="0xhash")

        # Confirm on chain
        tx = await tx_service.confirm_on_chain(
            tx.id,
            block_number=12345,
            block_hash="0xblock",
        )

        assert tx.status == TransactionStatus.CONFIRMED
        assert tx.block_number == 12345
        assert tx.confirmed_at is not None
        assert tx.is_final


class TestCancelTransaction:
    """Tests for transaction cancellation."""

    async def test_cancel_pending_transaction(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
    ):
        """Test cancelling a pending transaction."""
        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )
        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test",
        )

        tx = await tx_service.cancel_transaction(tx.id, reason="Changed mind")

        assert tx.status == TransactionStatus.CANCELLED
        assert tx.error_message is None
        assert get_extra(tx)["cancellation_reason"] == "Changed mind"
        assert get_extra(tx)["cancellation_method"] == "offchain"
        assert tx.is_final

    async def test_cancel_broadcast_transaction_fails(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
        signers: list[Signer],
    ):
        """Test error when cancelling broadcast transaction."""
        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )
        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test",
        )

        for i in range(2):
            sig_data = SignatureSubmit(signature_data=f"sig_{i}")
            tx = await tx_service.submit_signature(tx.id, signers[i].id, sig_data)

        tx = await tx_service.broadcast_transaction(tx.id, tx_hash="0xhash")

        with pytest.raises(ValidationError):
            await tx_service.cancel_transaction(tx.id)


class TestListTransactions:
    """Tests for transaction listing."""

    async def test_list_transactions(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
    ):
        """Test listing transactions for a wallet."""
        # Create multiple transactions
        for i in range(5):
            data = TransactionCreate(
                to_address=f"0xRecipient{i}",
                amount=Decimal(i + 1),
            )
            await tx_service.create_transaction(
                wallet_id=active_wallet.id,
                data=data,
                payload=f"payload_{i}",
            )

        query = TransactionQuery(page=1, page_size=10)
        transactions, total = await tx_service.list_transactions(
            active_wallet.id, query
        )

        assert total == 5
        assert len(transactions) == 5

    async def test_list_transactions_filter_status(
        self,
        tx_service: TransactionService,
        active_wallet: Wallet,
    ):
        """Test filtering transactions by status."""
        # Create pending transaction
        data = TransactionCreate(
            to_address="0xRecipient",
            amount=Decimal("1"),
        )
        tx = await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test",
        )

        # Cancel it to get a non-PENDING_SIGN transaction
        await tx_service.cancel_transaction(tx.id, reason="test")

        # Create another (will be PENDING_SIGN)
        await tx_service.create_transaction(
            wallet_id=active_wallet.id,
            data=data,
            payload="test2",
        )

        # Filter by PENDING_SIGN — should find only the second one
        query = TransactionQuery(status=TransactionStatus.PENDING_SIGN)
        transactions, total = await tx_service.list_transactions(
            active_wallet.id, query
        )

        assert total == 1
