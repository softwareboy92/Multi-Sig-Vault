"""Signer model for key holders."""

from datetime import datetime
from enum import Enum

from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from multivault.models.base import Base, SoftDeleteMixin, TimestampMixin, generate_uuid

if TYPE_CHECKING:
    from multivault.models.wallet import WalletSigner


class DeviceType(str, Enum):
    """Supported device/wallet types."""

    LEDGER = "LEDGER"
    METAMASK = "METAMASK"
    WALLETCONNECT = "WALLETCONNECT"
    KEYVAULT = "KEYVAULT"
    UNKNOWN = "UNKNOWN"


class ChainType(str, Enum):
    """Supported chain types."""

    BTC = "BTC"
    EVM = "EVM"


class SignerStatus(str, Enum):
    """Signer verification status."""

    # Used for external multisig address import or scenarios where
    # signature-based verification is not yet performed or not applicable.
    UNVERIFIED = "UNVERIFIED"
    VERIFIED = "VERIFIED"
    REVOKED = "REVOKED"


class Signer(Base, TimestampMixin, SoftDeleteMixin):
    """Signer model representing a key holder.

    A signer can be a hardware wallet, software wallet, or watch-only address.
    Signers must be verified before being added to a multisig wallet.
    """

    __tablename__ = "signers"
    __table_args__ = (
        CheckConstraint(
            "public_key IS NOT NULL OR address IS NOT NULL",
            name="check_identifier",
        ),
        # Partial unique index: active (non-deleted) signers only.
        # Same chain_type + address must be unique among live signers.
        Index(
            "uq_signer_active_address",
            "chain_type",
            "address",
            unique=True,
            sqlite_where=text("deleted_at IS NULL AND address IS NOT NULL"),
        ),
        # Same chain_type + public_key must be unique among live signers.
        Index(
            "uq_signer_active_pubkey",
            "chain_type",
            "public_key",
            unique=True,
            sqlite_where=text("deleted_at IS NULL AND public_key IS NOT NULL"),
        ),
        Index("idx_signers_status", "status", postgresql_where="deleted_at IS NULL"),
        Index("idx_signers_address", "address", postgresql_where="address IS NOT NULL"),
        Index("idx_signers_chain_type", "chain_type"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    device_type: Mapped[DeviceType] = mapped_column(String(20), nullable=False)
    chain_type: Mapped[ChainType] = mapped_column(String(10), nullable=False)

    # Identifiers (at least one required)
    public_key: Mapped[str | None] = mapped_column(
        String(130),  # 33 bytes compressed or 65 bytes uncompressed hex
        nullable=True,
    )
    address: Mapped[str | None] = mapped_column(
        String(64),  # EVM: 42, BTC bech32: up to 62
        nullable=True,
    )

    # Derivation info (kept on main table — used by EVM Ledger too)
    derivation_path: Mapped[str | None] = mapped_column(
        String(50),  # e.g., m/48'/0'/0'/2'
        nullable=True,
    )

    # Chain/device-specific metadata stored as JSON.
    # BTC Ledger: {"master_fingerprint": "...", "xpub": "..."}
    extra: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Chain/device-specific metadata as JSON string",
    )

    # Status
    status: Mapped[SignerStatus] = mapped_column(
        String(20),
        default=SignerStatus.UNVERIFIED,
        nullable=False,
    )
    verified_at: Mapped[datetime | None] = mapped_column(nullable=True)

    # Relationships
    wallet_signers: Mapped[list["WalletSigner"]] = relationship(
        back_populates="signer",
    )

    def __repr__(self) -> str:
        return f"<Signer(id={self.id!r}, name={self.name!r}, status={self.status.value})>"

    @property
    def is_verified(self) -> bool:
        """Check if signer is verified."""
        return self.status == SignerStatus.VERIFIED

    @property
    def identifier(self) -> str:
        """Get primary identifier (address or public_key)."""
        return self.address or self.public_key or ""
