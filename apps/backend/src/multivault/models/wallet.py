"""Wallet and WalletSigner models for multisig wallets."""

from typing import TYPE_CHECKING

from datetime import datetime
from enum import Enum

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from multivault.models.base import Base, SoftDeleteMixin, TimestampMixin, generate_uuid
from multivault.models.signer import ChainType


class WalletStatus(str, Enum):
    """Wallet lifecycle status."""

    PENDING_DEPLOY = "PENDING_DEPLOY"  # EVM: Safe not yet deployed
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class WalletSource(str, Enum):
    """How the wallet was created."""

    CREATED = "CREATED"    # Created locally via normal flow
    IMPORTED = "IMPORTED"  # Imported from existing on-chain wallet


class WalletSigner(Base, TimestampMixin):
    """Junction table linking Wallet to Signer with ordering."""

    __tablename__ = "wallet_signers"
    __table_args__ = (
        UniqueConstraint("wallet_id", "signer_id", name="uq_wallet_signer"),
        UniqueConstraint("wallet_id", "order_index", name="uq_wallet_order"),
        Index("idx_wallet_signers_wallet", "wallet_id"),
        Index("idx_wallet_signers_signer", "signer_id"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    wallet_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("wallets.id", ondelete="CASCADE"),
        nullable=False,
    )
    signer_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("signers.id", ondelete="RESTRICT"),
        nullable=False,
    )
    order_index: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
    )

    # Ledger-specific / chain-specific metadata stored as JSON.
    # BTC Ledger: {"ledger_policy_hmac": "..."}
    extra: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Chain/device-specific metadata as JSON string",
    )

    # Relationships
    wallet: Mapped["Wallet"] = relationship(back_populates="wallet_signers")
    signer: Mapped["Signer"] = relationship(back_populates="wallet_signers")

    def __repr__(self) -> str:
        return f"<WalletSigner(wallet_id={self.wallet_id!r}, signer_id={self.signer_id!r}, order={self.order_index})>"


class Wallet(Base, TimestampMixin, SoftDeleteMixin):
    """Multisig wallet model.

    A wallet consists of multiple signers and a threshold for transaction approval.
    Wallet creation follows these steps:
    1. Create wallet record with signer references
    2. For EVM: Deploy Safe contract (async)
    3. For BTC: Derive P2WSH address from sorted pubkeys
    """

    __tablename__ = "wallets"
    __table_args__ = (
        CheckConstraint(
            "threshold > 0 AND threshold <= signer_count",
            name="check_threshold",
        ),
        Index("idx_wallets_chain_type", "chain_type"),
        Index("idx_wallets_status", "status", postgresql_where="deleted_at IS NULL"),
        Index("idx_wallets_address", "address", postgresql_where="address IS NOT NULL"),
        Index("idx_wallets_network", "network_id"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Intentional denormalization — mirrors Network.chain_type to avoid
    # JOIN on high-frequency queries (list, filter, display).
    chain_type: Mapped[ChainType] = mapped_column(String(10), nullable=False)

    # Multisig configuration — updated after on-chain policy change confirmation
    # via sync_wallet_policy() when a SAFE_POLICY_CHANGE transaction is confirmed.
    threshold: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    # Owner count — kept in sync with on-chain state for EVM Safe wallets.
    # For BTC wallets, set once at creation (immutable).
    signer_count: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    # On-chain address (computed after creation)
    address: Mapped[str | None] = mapped_column(
        String(64),  # EVM: 42, BTC bech32: up to 62
        nullable=True,
    )

    # Unified network FK (replaces evm_network_id + btc_network_id)
    network_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("networks.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Status
    status: Mapped[WalletStatus] = mapped_column(
        String(20),
        default=WalletStatus.PENDING_DEPLOY,
        nullable=False,
    )
    source: Mapped[str | None] = mapped_column(
        String(20),
        default=WalletSource.CREATED,
        nullable=True,
        comment="CREATED (default) or IMPORTED",
    )
    deployed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    # Chain-specific metadata stored as JSON.
    # EVM: {"salt": "...", "deployment_tx_hash": "0x...", "factory_address": "0x..."}
    # BTC: {"witness_script": "5221...", "redeem_script": null}
    extra: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Chain-specific metadata as JSON string",
    )

    # Relationships
    network: Mapped["NetworkConfig"] = relationship(
        foreign_keys=[network_id],
    )
    wallet_signers: Mapped[list["WalletSigner"]] = relationship(
        back_populates="wallet",
        order_by="WalletSigner.order_index",
        cascade="all, delete-orphan",
    )
    assets: Mapped[list["Asset"]] = relationship(
        back_populates="wallet",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Wallet(id={self.id!r}, name={self.name!r}, {self.threshold}/{self.signer_count})>"

    @property
    def is_active(self) -> bool:
        """Check if wallet is active."""
        return self.status == WalletStatus.ACTIVE

    @property
    def is_deployed(self) -> bool:
        """Check if wallet has on-chain address."""
        return self.address is not None

    @property
    def signers(self) -> list:
        """Get ordered list of signers."""
        return [ws.signer for ws in self.wallet_signers]


# Forward reference resolution
from multivault.models.signer import Signer  # noqa: E402
from multivault.models.asset import Asset  # noqa: E402

if TYPE_CHECKING:
    from multivault.models.network import NetworkConfig

WalletSigner.model_rebuild() if hasattr(WalletSigner, "model_rebuild") else None
