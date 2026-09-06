"""Transaction simulation result model."""

from enum import Enum

from sqlalchemy import (
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from multivault.models.base import Base, TimestampMixin, generate_uuid


class SimulationStatus(str, Enum):
    """Simulation outcome status."""

    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"
    ERROR = "ERROR"


class TransactionSimulation(Base, TimestampMixin):
    """Persisted result of a transaction simulation."""

    __tablename__ = "transaction_simulations"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=generate_uuid,
    )
    transaction_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    status: Mapped[SimulationStatus] = mapped_column(
        String(20), nullable=False,
    )
    chain_type: Mapped[str] = mapped_column(
        String(10), nullable=False, default="evm",
    )
    result: Mapped[str] = mapped_column(
        Text, nullable=False, comment="Structured simulation result (JSON)",
    )
    error_message: Mapped[str | None] = mapped_column(
        String(1000), nullable=True,
    )
    gas_used: Mapped[int | None] = mapped_column(Integer, nullable=True)

    transaction: Mapped["Transaction"] = relationship()  # noqa: F821
