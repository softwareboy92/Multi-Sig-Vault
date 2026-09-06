"""Asset model for token balance tracking."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, BigInteger, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .wallet import Wallet


class Asset(Base, TimestampMixin):
    """
    Represents a token or native coin balance for a wallet.

    Tracks the balance of each asset type (native coin or token) per wallet.
    Updated via background sync or on-demand queries.
    """

    __tablename__ = "assets"

    __table_args__ = (
        # Prevent duplicate assets: one entry per (wallet, contract) pair.
        # Native coins use NULL contract_address; COALESCE normalises to '__NATIVE__'.
        Index(
            "uq_asset_wallet_contract",
            "wallet_id",
            text("COALESCE(contract_address, '__NATIVE__')"),
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wallet_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("wallets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Token identification
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=True)
    contract_address: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,  # NULL for native coins (ETH, BTC, etc.)
    )
    decimals: Mapped[int] = mapped_column(Integer, default=18)

    # Balance stored as string to handle large numbers precisely
    # For display, use: float(balance) / (10 ** decimals)
    balance: Mapped[str] = mapped_column(String(78), default="0")

    # Last sync timestamp
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Chain/token-specific metadata (JSON)
    extra: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Chain/token-specific metadata (JSON)",
    )

    # Relationships
    wallet: Mapped["Wallet"] = relationship("Wallet", back_populates="assets")

    def __repr__(self) -> str:
        return (
            f"Asset(id={self.id}, wallet_id={self.wallet_id!r}, "
            f"symbol={self.symbol!r}, balance={self.balance!r})"
        )

    @property
    def is_native(self) -> bool:
        """Check if this is a native coin (not a token)."""
        return self.contract_address is None

    @property
    def balance_float(self) -> float:
        """Get balance as a floating point number with decimals applied."""
        try:
            return int(self.balance) / (10 ** self.decimals)
        except (ValueError, ZeroDivisionError):
            return 0.0
