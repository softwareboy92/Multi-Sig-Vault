"""Transaction and Signature models for multisig operations."""

from datetime import datetime
from decimal import Decimal
from enum import Enum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from multivault.models.base import Base, SoftDeleteMixin, TimestampMixin, generate_uuid


class TransactionStatus(str, Enum):
    """Transaction lifecycle status.

    State transitions:
    PENDING_SIGN -> PARTIALLY_SIGNED (first signature collected)
    PARTIALLY_SIGNED -> PARTIALLY_SIGNED (more signatures)
    PARTIALLY_SIGNED -> SIGNED (threshold reached)
    SIGNED -> BROADCAST (submitted to network)
    BROADCAST -> CONFIRMED (on-chain confirmation)
    PENDING_CONFIRMATION -> CONFIRMED (externally discovered transaction confirms)

    Any non-terminal state -> CANCELLED (user cancellation)
    Any non-terminal state -> FAILED (broadcast/confirmation failure)
    """

    PENDING_SIGN = "PENDING_SIGN"
    PARTIALLY_SIGNED = "PARTIALLY_SIGNED"
    SIGNED = "SIGNED"
    BROADCAST = "BROADCAST"
    PENDING_CONFIRMATION = "PENDING_CONFIRMATION"
    CONFIRMED = "CONFIRMED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


class TransactionType(str, Enum):
    """Transaction type for display and categorization."""

    TRANSFER = "TRANSFER"  # Native token transfer
    TOKEN_TRANSFER = "TOKEN_TRANSFER"  # ERC20/BEP20 transfer
    CONTRACT_CALL = "CONTRACT_CALL"  # Generic contract interaction
    SAFE_DEPLOY = "SAFE_DEPLOY"  # EVM Safe deployment
    CANCELLATION = "CANCELLATION"  # Safe nonce replacement (cancel via on-chain tx)
    SAFE_POLICY_CHANGE = "SAFE_POLICY_CHANGE"  # Safe owner/threshold modification


class Transaction(Base, TimestampMixin, SoftDeleteMixin):
    """Multisig transaction awaiting signatures.

    Tracks the full lifecycle from creation to confirmation, including
    signature collection and broadcast status.
    """

    __tablename__ = "transactions"

    __table_args__ = (
        CheckConstraint(
            "threshold > 0",
            name="check_tx_threshold_positive",
        ),
        Index("idx_tx_wallet", "wallet_id"),
        Index("idx_tx_status", "status"),
        Index("idx_tx_wallet_nonce", "wallet_id", "safe_nonce"),
        Index("idx_tx_hash", "tx_hash",
              sqlite_where=text("tx_hash IS NOT NULL")),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )

    # Wallet reference
    wallet_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("wallets.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Transaction metadata
    tx_type: Mapped[TransactionType] = mapped_column(
        String(20),
        default=TransactionType.TRANSFER,
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )
    
    # Safe cancellation tracking
    safe_replaces_tx_id: Mapped[str | None] = mapped_column(
        String(36), 
        ForeignKey("transactions.id", ondelete="SET NULL"),
        nullable=True,
        comment="For CANCELLATION type: the transaction being replaced/cancelled"
    )

    # Transfer details
    to_address: Mapped[str] = mapped_column(
        String(64),  # EVM: 42, BTC bech32: up to 62
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(
        Numeric(36, 18),  # Supports up to 18 decimals
        nullable=False,
    )
    # Token contract address (null for native transfers)
    # Transaction data (chain-specific)
    # BTC: Serialized PSBT (base64)
    # EVM: Safe transaction hash + encoded data
    payload: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    payload_hash: Mapped[str | None] = mapped_column(
        String(66),  # 32 bytes hex with 0x prefix
        nullable=True,
    )

    # Fee information
    fee_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(36, 18),
        nullable=True,
    )

    # EVM Safe nonce (NULL for BTC transactions)
    safe_nonce: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Safe contract nonce for EVM transactions (NULL for BTC)",
    )

    # Signature tracking
    threshold: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
    )
    signature_count: Mapped[int] = mapped_column(
        SmallInteger,
        default=0,
        nullable=False,
    )

    # Status and lifecycle
    status: Mapped[TransactionStatus] = mapped_column(
        String(20),
        default=TransactionStatus.PENDING_SIGN,
        nullable=False,
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    # On-chain data
    tx_hash: Mapped[str | None] = mapped_column(
        String(66),  # 32 bytes hex with 0x prefix
        nullable=True,
    )
    block_number: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    # Chain-specific metadata (JSON): token_address, token_symbol,
    # token_decimals, fee_rate, block_hash, etc.
    extra: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Chain/token-specific metadata (JSON)",
    )

    # Error tracking
    error_message: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    # Relationships
    wallet: Mapped["Wallet"] = relationship(back_populates="transactions")
    signatures: Mapped[list["Signature"]] = relationship(
        back_populates="transaction",
        cascade="all, delete-orphan",
        order_by="Signature.created_at",
    )

    def __repr__(self) -> str:
        return f"<Transaction(id={self.id!r}, status={self.status}, {self.signature_count}/{self.threshold} sigs)>"

    @property
    def is_complete(self) -> bool:
        """Check if transaction has reached threshold."""
        return self.signature_count >= self.threshold

    def _get_status_str(self) -> str:
        """Get status as string value (handle both enum and string from SQLite)."""
        if hasattr(self.status, "value"):
            return self.status.value
        return str(self.status)

    @property
    def is_pending(self) -> bool:
        """Check if transaction is awaiting signatures."""
        status = self._get_status_str()
        return status in (
            TransactionStatus.PENDING_SIGN.value,
            TransactionStatus.PARTIALLY_SIGNED.value,
        )

    @property
    def is_final(self) -> bool:
        """Check if transaction is in a terminal state."""
        status = self._get_status_str()
        return status in (
            TransactionStatus.CONFIRMED.value,
            TransactionStatus.CANCELLED.value,
            TransactionStatus.FAILED.value,
        )

    @property
    def can_sign(self) -> bool:
        """Check if transaction can accept more signatures."""
        return self.is_pending and not self.is_complete


class Signature(Base, TimestampMixin):
    """Individual signature for a multisig transaction.

    Stores the signature data along with signer reference.
    For BTC: Partial signature in PSBT format
    For EVM: Safe signature (r, s, v) with signature type
    """

    __tablename__ = "signatures"
    __table_args__ = (
        UniqueConstraint(
            "transaction_id",
            "signer_id",
            name="uq_tx_signer",
        ),
        Index("idx_sig_transaction", "transaction_id"),
        Index("idx_sig_signer", "signer_id"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    transaction_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
    )
    signer_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("signers.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Signature data
    # BTC: Hex-encoded signature
    # EVM: Hex-encoded (r + s + v) or typed data signature
    signature_data: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # EVM-specific: Signature type
    # 0 = Contract signature, 1 = Approved hash, 2 = eth_sign, 3 = ECDSA
    signature_type: Mapped[int | None] = mapped_column(
        SmallInteger,
        nullable=True,
    )

    # Verification status
    verified: Mapped[bool] = mapped_column(
        default=True,  # Set to True after verification
        nullable=False,
    )
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    # Relationships
    transaction: Mapped["Transaction"] = relationship(back_populates="signatures")
    signer: Mapped["Signer"] = relationship()

    def __repr__(self) -> str:
        return f"<Signature(id={self.id!r}, tx={self.transaction_id!r}, signer={self.signer_id!r})>"


# Forward reference resolution
from multivault.models.signer import Signer  # noqa: E402
from multivault.models.wallet import Wallet  # noqa: E402

# Add relationship to Wallet model
Wallet.transactions = relationship(
    "Transaction",
    back_populates="wallet",
    cascade="all, delete-orphan",
)
