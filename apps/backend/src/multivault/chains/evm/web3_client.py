"""
Async Web3 client wrapper.

Provides a consistent interface for interacting with EVM-compatible chains,
with connection pooling, retry logic, and proper resource management.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any

from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import AsyncWeb3, AsyncHTTPProvider
from web3.exceptions import Web3RPCError
from web3.types import TxParams, Wei, HexBytes

logger = logging.getLogger(__name__)


class EVMNetwork(str, Enum):
    """Supported EVM networks."""

    MAINNET = "mainnet"
    SEPOLIA = "sepolia"
    POLYGON = "polygon"
    ARBITRUM = "arbitrum"
    BASE = "base"
    LOCAL = "local"


# Default RPC endpoints
DEFAULT_RPC_ENDPOINTS: dict[EVMNetwork, str] = {
    EVMNetwork.MAINNET: "https://eth.llamarpc.com",
    EVMNetwork.SEPOLIA: "https://rpc.sepolia.org",
    EVMNetwork.POLYGON: "https://polygon-rpc.com",
    EVMNetwork.ARBITRUM: "https://arb1.arbitrum.io/rpc",
    EVMNetwork.BASE: "https://mainnet.base.org",
    EVMNetwork.LOCAL: "http://127.0.0.1:8545",
}


class Web3ClientError(Exception):
    """Base exception for Web3 client errors."""

    pass


class Web3ConnectionError(Web3ClientError):
    """Raised when unable to connect to the RPC endpoint."""

    pass


class Web3RPCException(Web3ClientError):
    """Raised when an RPC call fails."""

    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code


@dataclass
class GasEstimate:
    """Gas estimation result."""

    gas_limit: int
    max_fee_per_gas: Wei
    max_priority_fee_per_gas: Wei

    @property
    def max_cost(self) -> Wei:
        """Maximum transaction cost in wei."""
        return Wei(self.gas_limit * self.max_fee_per_gas)


class Web3Client:
    """
    Async Web3 client with connection management.

    Provides a high-level interface for common EVM operations
    with proper error handling and resource cleanup.
    """

    def __init__(
        self,
        rpc_url: str | None = None,
        network: EVMNetwork = EVMNetwork.LOCAL,
        request_timeout: float = 30.0,
    ):
        """
        Initialize Web3 client.

        Args:
            rpc_url: Custom RPC endpoint URL. If None, uses default for network.
            network: Target EVM network.
            request_timeout: HTTP request timeout in seconds.
        """
        self._rpc_url = rpc_url or DEFAULT_RPC_ENDPOINTS.get(network, "")
        self._network = network
        self._timeout = request_timeout
        self._web3: AsyncWeb3 | None = None
        self._connected = False
        self._chain_id: int | None = None

    @property
    def is_connected(self) -> bool:
        """Check if client is connected."""
        return self._connected

    @property
    def chain_id(self) -> int | None:
        """Return the chain ID if connected."""
        return self._chain_id

    @property
    def web3(self) -> AsyncWeb3:
        """Get the underlying Web3 instance."""
        if self._web3 is None:
            raise Web3ConnectionError("Not connected to RPC endpoint")
        return self._web3

    async def connect(self) -> None:
        """
        Establish connection to the RPC endpoint.

        Raises:
            Web3ConnectionError: If connection fails.
        """
        if self._connected:
            return

        try:
            provider = AsyncHTTPProvider(
                endpoint_uri=self._rpc_url,
                request_kwargs={"timeout": self._timeout},
            )
            self._web3 = AsyncWeb3(provider)

            # Verify connection
            self._chain_id = await self._web3.eth.chain_id
            self._connected = True
            logger.info(
                f"Connected to {self._network.value} (chain_id={self._chain_id})"
            )
        except Exception as e:
            # Cleanup on connection failure
            self._connected = False
            if self._web3 is not None:
                try:
                    await self.disconnect()
                except Exception:
                    pass
            self._web3 = None
            raise Web3ConnectionError(f"Failed to connect to {self._rpc_url}: {e}")

    async def disconnect(self) -> None:
        """Close the connection and cleanup resources."""
        if self._web3 is not None:
            provider = getattr(self._web3, "provider", None)
            if provider is not None:
                # AsyncHTTPProvider from web3.py uses aiohttp ClientSession
                session = getattr(provider, "_session", None)
                if session is None:
                    session = getattr(provider, "session", None)
                
                if session is not None and hasattr(session, "closed"):
                    if not session.closed:
                        await session.close()
                        logger.debug("Closed aiohttp session for Web3Client")
                
                # Call provider's cleanup if available
                if hasattr(provider, "disconnect"):
                    await provider.disconnect()
                elif hasattr(provider, "close"):
                    await provider.close()
        
        self._connected = False
        self._web3 = None
        self._chain_id = None

    async def __aenter__(self) -> Web3Client:
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        await self.disconnect()

    # -------------------------------------------------------------------------
    # Balance and Nonce
    # -------------------------------------------------------------------------

    async def get_balance(self, address: str) -> Wei:
        """
        Get ETH balance for an address.

        Args:
            address: Ethereum address (0x prefixed).

        Returns:
            Balance in wei.
        """
        self._ensure_connected()
        try:
            return await self.web3.eth.get_balance(
                self.web3.to_checksum_address(address)
            )
        except Web3RPCError as e:
            raise Web3RPCException(f"Failed to get balance: {e}")

    async def get_nonce(self, address: str) -> int:
        """
        Get the current nonce for an address.

        Args:
            address: Ethereum address.

        Returns:
            Current transaction count (nonce).
        """
        self._ensure_connected()
        try:
            return await self.web3.eth.get_transaction_count(
                self.web3.to_checksum_address(address)
            )
        except Web3RPCError as e:
            raise Web3RPCException(f"Failed to get nonce: {e}")

    async def get_erc20_info(self, contract_address: str) -> dict:
        """
        Get ERC20 token metadata (symbol, name, decimals).

        Args:
            contract_address: Token contract address.

        Returns:
            Dict with symbol, name, decimals.
        """
        self._ensure_connected()

        # ERC20 ABI for metadata calls
        erc20_abi = [
            {"constant": True, "inputs": [], "name": "symbol", "outputs": [{"name": "", "type": "string"}], "type": "function"},
            {"constant": True, "inputs": [], "name": "name", "outputs": [{"name": "", "type": "string"}], "type": "function"},
            {"constant": True, "inputs": [], "name": "decimals", "outputs": [{"name": "", "type": "uint8"}], "type": "function"},
        ]

        try:
            contract = self.web3.eth.contract(
                address=self.web3.to_checksum_address(contract_address),
                abi=erc20_abi,
            )

            # Query in parallel
            import asyncio
            results = await asyncio.gather(
                contract.functions.symbol().call(),
                contract.functions.name().call(),
                contract.functions.decimals().call(),
                return_exceptions=True,
            )

            symbol = results[0] if not isinstance(results[0], Exception) else "UNKNOWN"
            name = results[1] if not isinstance(results[1], Exception) else "Unknown Token"
            decimals = results[2] if not isinstance(results[2], Exception) else 18

            return {
                "symbol": symbol,
                "name": name,
                "decimals": int(decimals),
            }
        except Exception as e:
            # Return defaults on error
            return {
                "symbol": "UNKNOWN",
                "name": "Unknown Token",
                "decimals": 18,
            }

    # -------------------------------------------------------------------------
    # Gas Estimation
    # -------------------------------------------------------------------------

    async def estimate_gas(self, tx: TxParams) -> int:
        """
        Estimate gas for a transaction.

        Args:
            tx: Transaction parameters.

        Returns:
            Estimated gas units.
        """
        self._ensure_connected()
        try:
            return await self.web3.eth.estimate_gas(tx)
        except Web3RPCError as e:
            raise Web3RPCException(f"Gas estimation failed: {e}")

    async def get_gas_price(self) -> GasEstimate:
        """
        Get current gas prices (EIP-1559).

        Returns:
            GasEstimate with fee suggestions.
        """
        self._ensure_connected()
        try:
            # Get base fee from latest block
            latest_block = await self.web3.eth.get_block("latest")
            base_fee = latest_block.get("baseFeePerGas", Wei(0))

            # Priority fee (tip)
            max_priority_fee = await self.web3.eth.max_priority_fee

            # Max fee = base fee * 2 + priority fee (safe margin)
            max_fee = Wei(base_fee * 2 + max_priority_fee)

            return GasEstimate(
                gas_limit=21000,  # Base transfer, caller should estimate
                max_fee_per_gas=max_fee,
                max_priority_fee_per_gas=max_priority_fee,
            )
        except Web3RPCError as e:
            raise Web3RPCException(f"Failed to get gas price: {e}")

    # -------------------------------------------------------------------------
    # Contract Interaction
    # -------------------------------------------------------------------------

    async def call(
        self,
        to: str,
        data: bytes | str,
        value: int = 0,
        block_identifier: str | int = "latest",
    ) -> bytes:
        """
        Execute a read-only contract call.

        Args:
            to: Contract address.
            data: Encoded function call data.
            value: ETH value in wei (usually 0 for reads).
            block_identifier: Block number or 'latest'.

        Returns:
            Raw return data from the contract.
        """
        self._ensure_connected()
        try:
            tx: TxParams = {
                "to": self.web3.to_checksum_address(to),
                "data": HexBytes(data) if isinstance(data, bytes) else data,
                "value": Wei(value),
            }
            result = await self.web3.eth.call(tx, block_identifier)
            return bytes(result)
        except Web3RPCError as e:
            raise Web3RPCException(f"Contract call failed: {e}")

    async def send_raw_transaction(self, signed_tx: bytes | str) -> str:
        """
        Broadcast a signed transaction.

        Args:
            signed_tx: Signed transaction bytes or hex string.

        Returns:
            Transaction hash.
        """
        self._ensure_connected()
        try:
            if isinstance(signed_tx, str):
                signed_tx = bytes.fromhex(
                    signed_tx[2:] if signed_tx.startswith("0x") else signed_tx
                )

            tx_hash = await self.web3.eth.send_raw_transaction(signed_tx)
            return tx_hash.hex()
        except Web3RPCError as e:
            raise Web3RPCException(f"Transaction broadcast failed: {e}")

    async def wait_for_transaction(
        self,
        tx_hash: str,
        timeout: float = 120.0,
        poll_interval: float = 2.0,
    ) -> dict[str, Any]:
        """
        Wait for a transaction to be mined.

        Args:
            tx_hash: Transaction hash to wait for.
            timeout: Maximum time to wait in seconds.
            poll_interval: Time between polls in seconds.

        Returns:
            Transaction receipt.

        Raises:
            TimeoutError: If transaction not mined within timeout.
        """
        self._ensure_connected()

        hash_bytes = HexBytes(tx_hash)
        deadline = asyncio.get_event_loop().time() + timeout

        while asyncio.get_event_loop().time() < deadline:
            try:
                receipt = await self.web3.eth.get_transaction_receipt(hash_bytes)
                if receipt is not None:
                    return dict(receipt)
            except Web3RPCError:
                pass

            await asyncio.sleep(poll_interval)

        raise TimeoutError(f"Transaction {tx_hash} not mined within {timeout}s")

    # -------------------------------------------------------------------------
    # Block and Logs
    # -------------------------------------------------------------------------

    async def get_block_number(self) -> int:
        """Get the current block number."""
        self._ensure_connected()
        return await self.web3.eth.block_number

    async def get_logs(
        self,
        address: str | list[str],
        topics: list[str | None] | None = None,
        from_block: int | str = "latest",
        to_block: int | str = "latest",
    ) -> list[dict[str, Any]]:
        """
        Get event logs matching the filter.

        Args:
            address: Contract address(es) to filter.
            topics: Event topics to filter.
            from_block: Starting block.
            to_block: Ending block.

        Returns:
            List of matching log entries.
        """
        self._ensure_connected()
        try:
            filter_params: dict[str, Any] = {
                "fromBlock": from_block,
                "toBlock": to_block,
            }

            if isinstance(address, str):
                filter_params["address"] = self.web3.to_checksum_address(address)
            else:
                filter_params["address"] = [
                    self.web3.to_checksum_address(a) for a in address
                ]

            if topics:
                filter_params["topics"] = topics

            logs = await self.web3.eth.get_logs(filter_params)
            return [dict(log) for log in logs]
        except Web3RPCError as e:
            raise Web3RPCException(f"Failed to get logs: {e}")

    # -------------------------------------------------------------------------
    # Signature Verification
    # -------------------------------------------------------------------------

    def verify_signature(
        self,
        message: bytes,
        signature: bytes | str,
        expected_address: str,
    ) -> bool:
        """
        Verify an Ethereum signature.

        Args:
            message: Original message bytes.
            signature: 65-byte signature (r, s, v).
            expected_address: Expected signer address.

        Returns:
            True if signature is valid and from expected address.
        """
        try:
            if isinstance(signature, str):
                signature = bytes.fromhex(
                    signature[2:] if signature.startswith("0x") else signature
                )

            encoded = encode_defunct(primitive=message)
            recovered = Account.recover_message(encoded, signature=signature)
            return recovered.lower() == expected_address.lower()
        except Exception:
            return False

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def _ensure_connected(self) -> None:
        """Raise error if not connected."""
        if not self._connected or self._web3 is None:
            raise Web3ConnectionError("Not connected to RPC endpoint")

    @staticmethod
    def to_checksum_address(address: str) -> str:
        """Convert address to checksum format."""
        return AsyncWeb3.to_checksum_address(address)

    @staticmethod
    def keccak256(data: bytes) -> bytes:
        """Compute Keccak-256 hash."""
        return AsyncWeb3.keccak(data)
