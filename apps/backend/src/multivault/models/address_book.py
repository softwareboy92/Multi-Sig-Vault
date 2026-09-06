"""Address book model."""

from sqlalchemy import Index, String
from sqlalchemy.orm import Mapped, mapped_column

from multivault.models.base import Base, TimestampMixin, generate_uuid
from multivault.models.signer import ChainType


class AddressBookEntry(Base, TimestampMixin):
    """Global address book entry with chain filtering."""

    __tablename__ = "address_book"
    __table_args__ = (
        Index("idx_address_book_chain", "chain_type"),
        Index("idx_address_book_btc_network", "btc_network"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    address: Mapped[str] = mapped_column(String(128), nullable=False)
    chain_type: Mapped[ChainType] = mapped_column(String(10), nullable=False)
    btc_network: Mapped[str | None] = mapped_column(String(20), nullable=True)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
