"""Unified network configuration models.

Provides a single ``networks`` table and a single ``network_nodes`` table
that replace the former per-chain tables (evm_networks, evm_rpc_nodes,
btc_networks, btc_nodes).  Chain-specific metadata lives in the JSON
``extra`` column, keeping the schema stable when new chains are added.
"""

from datetime import datetime
from enum import Enum

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from multivault.models.base import Base, TimestampMixin, generate_uuid


# ---------------------------------------------------------------------------
# Enums (for validation, not DB storage)
# ---------------------------------------------------------------------------


class BTCNetwork(str, Enum):
    """Supported BTC network identifiers."""

    MAINNET = "mainnet"
    TESTNET = "testnet"
    TESTNET3 = "testnet3"
    TESTNET4 = "testnet4"
    REGTEST = "regtest"


class NodeType(str, Enum):
    """Supported node connection types."""

    JSON_RPC = "JSON_RPC"
    ELECTRUM = "ELECTRUM"
    GRPC = "GRPC"
    WEBSOCKET = "WEBSOCKET"


# ---------------------------------------------------------------------------
# NetworkConfig – unified network metadata
# ---------------------------------------------------------------------------


class NetworkConfig(Base, TimestampMixin):
    """Unified network configuration for all chain types.

    Replaces the separate ``EVMNetworkConfig`` and ``BTCNetworkConfig``
    tables.  Chain-specific metadata is stored in the ``extra`` JSON
    column so that adding a new chain never requires a DDL change.

    ``extra`` conventions by chain_type::

        EVM  -> {"chain_id": 1}
        BTC  -> {"btc_network": "mainnet"}
        TRON -> {"full_node_url": "..."}   (future)
        SOL  -> {"cluster": "mainnet-beta"} (future)
    """

    __tablename__ = "networks"
    __table_args__ = (
        UniqueConstraint("chain_type", "name", name="uq_network_chain_name"),
        Index("idx_network_chain_enabled", "chain_type", "enabled"),
        Index("idx_network_testnet", "is_testnet"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    chain_type: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        comment="Chain type: BTC, EVM, TRON, SOL, etc.",
    )
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="Network name, unique within chain_type",
    )
    explorer_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Block explorer URL",
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="Network enabled status",
    )
    is_testnet: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="Whether this is a testnet",
    )
    default_node_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("network_nodes.id", ondelete="SET NULL", use_alter=True),
        nullable=True,
        comment="Default node for this network",
    )
    extra: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Chain-specific metadata as JSON string",
    )


# ---------------------------------------------------------------------------
# NetworkNodeConfig – unified node endpoint
# ---------------------------------------------------------------------------


class NetworkNodeConfig(Base, TimestampMixin):
    """Unified node configuration for all chain and node types.

    Replaces the separate ``EVMRpcNodeConfig`` and ``BTCNodeConfig``
    tables.  The ``endpoint_url`` column holds a URI whose scheme
    encodes the transport:

    * ``JSON_RPC``  -> ``https://rpc.example.com``
    * ``ELECTRUM``  -> ``ssl://host:port`` or ``tcp://host:port``
    * ``GRPC``      -> ``grpc://host:port``
    * ``WEBSOCKET`` -> ``wss://host:port/path``
    """

    __tablename__ = "network_nodes"
    __table_args__ = (
        UniqueConstraint("network_id", "endpoint_url", name="uq_node_endpoint"),
        Index("idx_node_network_priority", "network_id", "priority", "enabled"),
        Index("idx_node_enabled", "enabled"),
        Index("idx_node_healthy", "is_healthy"),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    network_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("networks.id", ondelete="CASCADE"),
        nullable=False,
        comment="Reference to parent network",
    )
    node_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="Node connection type: JSON_RPC, ELECTRUM, GRPC, WEBSOCKET",
    )
    endpoint_url: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        comment="Unified endpoint URL",
    )
    priority: Mapped[int] = mapped_column(
        Integer,
        default=100,
        nullable=False,
        comment="Priority for sorting (higher = preferred)",
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="Node enabled status",
    )
    is_healthy: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="Health check status (manual)",
    )
    last_health_check: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
        comment="Last health check timestamp",
    )
    extra: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Node-specific config as JSON string",
    )


# ---------------------------------------------------------------------------
# Electrum URL helpers
# ---------------------------------------------------------------------------


def parse_electrum_url(url: str) -> tuple[str, int, bool]:
    """Parse ``ssl://host:port`` into ``(host, port, ssl=True)``.

    Raises ``ValueError`` on malformed input.
    """
    from urllib.parse import urlparse

    parsed = urlparse(url)
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("ssl", "tcp"):
        raise ValueError(f"Unsupported Electrum URL scheme: {scheme!r}")
    host = parsed.hostname
    port = parsed.port
    if not host or not port:
        raise ValueError(f"Invalid Electrum URL (missing host or port): {url!r}")
    return host, port, scheme == "ssl"


def build_electrum_url(host: str, port: int, ssl: bool = True) -> str:
    """Build ``(host, port, ssl)`` into ``ssl://host:port``."""
    scheme = "ssl" if ssl else "tcp"
    return f"{scheme}://{host}:{port}"
