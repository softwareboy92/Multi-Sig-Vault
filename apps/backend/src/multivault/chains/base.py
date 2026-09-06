"""
Abstract base class for chain adapters.

Defines the interface that all chain-specific adapters must implement.
This ensures consistent behavior across Bitcoin, EVM, and future chains.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Generic, TypeVar


@dataclass
class WalletConfig:
    """Configuration for a newly created multisig wallet."""

    address: str
    status: str
    extra_data: dict = field(default_factory=dict)


@dataclass
class UnsignedTransaction:
    """An unsigned transaction ready for signing."""

    payload: bytes | str
    fee: int
    metadata: dict = field(default_factory=dict)


@dataclass
class BroadcastResult:
    """Result of broadcasting a transaction."""

    tx_hash: str
    success: bool
    error: str | None = None


@dataclass
class Balance:
    """Balance information for an address."""

    confirmed: int
    unconfirmed: int

    @property
    def total(self) -> int:
        """Total balance including unconfirmed."""
        return self.confirmed + self.unconfirmed


@dataclass
class UTXO:
    """Unspent transaction output (Bitcoin-specific but useful to define here)."""

    txid: str
    vout: int
    value: int
    height: int  # 0 if unconfirmed
    script_pubkey: bytes = field(default_factory=bytes)


T = TypeVar("T")


class ChainAdapter(ABC, Generic[T]):
    """
    Abstract base class for chain adapters.

    Each chain implementation (Bitcoin, EVM, etc.) must inherit from this class
    and implement all abstract methods to provide a consistent interface.
    """

    @property
    @abstractmethod
    def chain_name(self) -> str:
        """Return the chain identifier (e.g., 'BTC', 'EVM')."""
        ...

    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Check if the adapter is connected to the chain."""
        ...

    @abstractmethod
    async def connect(self) -> None:
        """
        Initialize connection to the chain.

        Raises:
            ConnectionError: If unable to establish connection.
        """
        ...

    @abstractmethod
    async def disconnect(self) -> None:
        """Close connection to the chain gracefully."""
        ...

    @abstractmethod
    async def create_multisig(
        self,
        public_keys_or_addresses: list[str],
        threshold: int,
        **kwargs,
    ) -> WalletConfig:
        """
        Create a multisig wallet configuration.

        Args:
            public_keys_or_addresses: List of public keys (BTC) or addresses (EVM).
            threshold: Number of signatures required.
            **kwargs: Chain-specific parameters.

        Returns:
            WalletConfig with the derived address and metadata.

        Raises:
            ValueError: If threshold > len(public_keys_or_addresses) or invalid keys.
        """
        ...

    @abstractmethod
    async def get_balance(self, address: str) -> Balance:
        """
        Get balance for an address.

        Args:
            address: The wallet address to query.

        Returns:
            Balance with confirmed and unconfirmed amounts in smallest unit.

        Raises:
            ConnectionError: If unable to query the chain.
        """
        ...

    @abstractmethod
    async def build_transaction(
        self,
        from_address: str,
        to_address: str,
        amount: int,
        **kwargs,
    ) -> UnsignedTransaction:
        """
        Build an unsigned transaction.

        Args:
            from_address: Source wallet address.
            to_address: Destination address.
            amount: Amount to send in smallest unit (satoshi/wei).
            **kwargs: Chain-specific parameters (fee_rate, gas_limit, etc.).

        Returns:
            UnsignedTransaction ready for signing.

        Raises:
            ValueError: If insufficient balance or invalid parameters.
        """
        ...

    @abstractmethod
    async def verify_signature(
        self,
        message: bytes,
        signature: bytes,
        public_key: str,
    ) -> bool:
        """
        Verify a signature against a message.

        Args:
            message: The original message that was signed.
            signature: The signature to verify.
            public_key: The public key to verify against.

        Returns:
            True if signature is valid, False otherwise.
        """
        ...

    @abstractmethod
    async def broadcast(
        self,
        signed_tx: bytes | str,
    ) -> BroadcastResult:
        """
        Broadcast a signed transaction to the network.

        Args:
            signed_tx: The fully signed transaction.

        Returns:
            BroadcastResult with tx_hash and success status.

        Raises:
            ConnectionError: If unable to broadcast.
        """
        ...

    async def __aenter__(self) -> "ChainAdapter[T]":
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        await self.disconnect()
