"""
Electrum Protocol Client.

Async TCP/SSL client for communicating with Electrum servers using JSON-RPC.
Supports both public servers and self-hosted electrs instances.

Protocol specification: https://electrumx.readthedocs.io/en/latest/protocol.html
"""

import asyncio
import json
import ssl
from dataclasses import dataclass
from hashlib import sha256
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


class ElectrumError(Exception):
    """Base exception for Electrum client errors."""

    pass


class ElectrumConnectionError(ElectrumError):
    """Connection-related errors."""

    pass


class ElectrumRPCError(ElectrumError):
    """RPC call failed with an error response."""

    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(f"Electrum RPC error {code}: {message}")


@dataclass
class ElectrumUTXO:
    """Unspent transaction output from Electrum."""

    txid: str
    vout: int
    value: int  # satoshis
    height: int  # 0 if unconfirmed


@dataclass
class ElectrumTxInfo:
    """Transaction information from Electrum."""

    txid: str
    height: int  # 0 if unconfirmed, -1 if mempool conflict
    fee: int | None = None


class ElectrumClient:
    """
    Async Electrum protocol client.

    Connects to Electrum servers via TCP/SSL and provides methods
    for querying blockchain data using the Electrum JSON-RPC protocol.

    Example:
        async with ElectrumClient("electrum.blockstream.info", 50002) as client:
            balance = await client.get_balance("bc1q...")
            utxos = await client.list_unspent("bc1q...")
    """

    DEFAULT_HOST = "electrum.blockstream.info"
    DEFAULT_PORT = 50002  # SSL port
    DEFAULT_TIMEOUT = 30.0
    PROTOCOL_VERSION = ("1.4", "1.4.2")

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        use_ssl: bool = True,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        """
        Initialize Electrum client.

        Args:
            host: Electrum server hostname.
            port: Server port (50002 for SSL, 50001 for plain TCP).
            use_ssl: Whether to use SSL/TLS encryption.
            timeout: Connection and read timeout in seconds.
        """
        self.host = host
        self.port = port
        self.use_ssl = use_ssl
        self.timeout = timeout

        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._request_id = 0
        self._connected = False
        self._lock = asyncio.Lock()

    @property
    def is_connected(self) -> bool:
        """Check if connected to server."""
        return self._connected and self._writer is not None

    async def connect(self) -> None:
        """
        Establish connection to Electrum server.

        Raises:
            ElectrumConnectionError: If connection fails.
        """
        if self.is_connected:
            return

        try:
            ssl_context = None
            if self.use_ssl:
                ssl_context = ssl.create_default_context()
                # Some public servers use self-signed certs
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE

            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(
                    self.host,
                    self.port,
                    ssl=ssl_context,
                ),
                timeout=self.timeout,
            )
            self._connected = True

            # Negotiate protocol version
            await self._negotiate_version()

            logger.info(
                "electrum_connected",
                host=self.host,
                port=self.port,
                ssl=self.use_ssl,
            )

        except asyncio.TimeoutError as e:
            raise ElectrumConnectionError(
                f"Connection to {self.host}:{self.port} timed out"
            ) from e
        except OSError as e:
            raise ElectrumConnectionError(
                f"Failed to connect to {self.host}:{self.port}: {e}"
            ) from e

    async def disconnect(self) -> None:
        """Close connection to server."""
        if self._writer:
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except Exception:
                pass  # Ignore errors during cleanup
        self._reader = None
        self._writer = None
        self._connected = False
        logger.info("electrum_disconnected", host=self.host)

    async def _negotiate_version(self) -> None:
        """Negotiate protocol version with server."""
        result = await self._call(
            "server.version",
            ["MultiVault/0.1.0", self.PROTOCOL_VERSION],
        )
        logger.debug("electrum_version", server_version=result)

    async def _call(self, method: str, params: list | None = None) -> Any:
        """
        Make an RPC call to the server.

        Args:
            method: The RPC method name.
            params: Method parameters.

        Returns:
            The result from the server.

        Raises:
            ElectrumConnectionError: If not connected.
            ElectrumRPCError: If the server returns an error.
        """
        if not self.is_connected:
            raise ElectrumConnectionError("Not connected to server")

        async with self._lock:
            self._request_id += 1
            request_id = self._request_id

            request = {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params or [],
            }

            # Send request
            line = json.dumps(request) + "\n"
            self._writer.write(line.encode())
            await self._writer.drain()

            # Read response, skipping any subscription notifications that may
            # arrive between our request and its response.  Electrum servers
            # push notifications for subscribed addresses / headers at any time;
            # these messages have id=null and must not be confused with our
            # request/response pair.
            max_skips = 10  # safety limit to avoid infinite loop
            for _ in range(max_skips + 1):
                try:
                    response_line = await asyncio.wait_for(
                        self._reader.readline(),
                        timeout=self.timeout,
                    )
                except asyncio.TimeoutError as e:
                    raise ElectrumConnectionError(
                        f"Request timed out: {method}"
                    ) from e

                if not response_line:
                    self._connected = False
                    raise ElectrumConnectionError("Connection closed by server")

                response = json.loads(response_line.decode())

                # Subscription notifications have id=null and a "method" key.
                # Skip them and continue reading.
                if response.get("id") is None and "method" in response:
                    logger.debug(
                        "electrum_notification_skipped",
                        notification_method=response.get("method"),
                    )
                    continue

                # Validate response ID matches our request
                if response.get("id") != request_id:
                    raise ElectrumRPCError(
                        -1,
                        f"Response ID mismatch: expected {request_id}, "
                        f"got {response.get('id')}",
                    )

                # Matched — process the response
                if "error" in response and response["error"]:
                    error = response["error"]
                    if isinstance(error, dict):
                        raise ElectrumRPCError(
                            error.get("code", -1),
                            error.get("message", str(error)),
                        )
                    else:
                        raise ElectrumRPCError(-1, str(error))

                return response.get("result")

            # Exhausted skip budget — should never happen in practice
            raise ElectrumRPCError(
                -1,
                f"Too many subscription notifications while waiting for "
                f"response to {method} (request_id={request_id})",
            )

    @staticmethod
    def address_to_scripthash(address: str) -> str:
        """
        Convert a Bitcoin address to Electrum scripthash format.

        The scripthash is the SHA256 hash of the scriptPubKey, reversed.

        Args:
            address: Bitcoin address (bech32 or legacy).

        Returns:
            Hex-encoded scripthash for Electrum queries.
        """
        # Import here to avoid circular dependency
        from embit import script
        from embit.networks import NETWORKS

        # Try mainnet first, then testnet
        for network in [NETWORKS["main"], NETWORKS["test"]]:
            try:
                sc = script.address_to_scriptpubkey(address)
                break
            except Exception:
                continue
        else:
            raise ValueError(f"Invalid Bitcoin address: {address}")

        # SHA256 of scriptPubKey, then reverse bytes
        script_hash = sha256(sc.data).digest()[::-1]
        return script_hash.hex()

    async def get_balance(self, address: str) -> dict[str, int]:
        """
        Get balance for an address.

        Args:
            address: Bitcoin address.

        Returns:
            Dict with 'confirmed' and 'unconfirmed' balances in satoshis.
        """
        scripthash = self.address_to_scripthash(address)
        result = await self._call("blockchain.scripthash.get_balance", [scripthash])
        return {
            "confirmed": result.get("confirmed", 0),
            "unconfirmed": result.get("unconfirmed", 0),
        }

    async def list_unspent(self, address: str) -> list[ElectrumUTXO]:
        """
        Get unspent transaction outputs for an address.

        Args:
            address: Bitcoin address.

        Returns:
            List of UTXOs.
        """
        scripthash = self.address_to_scripthash(address)
        result = await self._call("blockchain.scripthash.listunspent", [scripthash])

        utxos = []
        for item in result:
            utxos.append(
                ElectrumUTXO(
                    txid=item["tx_hash"],
                    vout=item["tx_pos"],
                    value=item["value"],
                    height=item.get("height", 0),
                )
            )
        return utxos

    async def get_transaction(self, txid: str, verbose: bool = True) -> dict:
        """
        Get transaction details.

        Args:
            txid: Transaction ID.
            verbose: If True, return decoded transaction; else raw hex.

        Returns:
            Transaction data.
        """
        return await self._call("blockchain.transaction.get", [txid, verbose])

    async def get_raw_transaction(self, txid: str) -> str:
        """
        Get raw transaction hex.

        Args:
            txid: Transaction ID.

        Returns:
            Raw transaction hex string.
        """
        return await self._call("blockchain.transaction.get", [txid, False])

    async def broadcast_transaction(self, raw_tx: str) -> str:
        """
        Broadcast a raw transaction.

        Args:
            raw_tx: Hex-encoded raw transaction.

        Returns:
            Transaction ID if successful.

        Raises:
            ElectrumRPCError: If broadcast fails.
        """
        return await self._call("blockchain.transaction.broadcast", [raw_tx])

    async def get_fee_estimate(self, target_blocks: int = 6) -> float:
        """
        Get fee estimate in BTC/kB.

        Args:
            target_blocks: Target confirmation time in blocks.

        Returns:
            Estimated fee rate in BTC/kB, or -1 if unavailable.
        """
        return await self._call("blockchain.estimatefee", [target_blocks])

    async def get_fee_estimate_sat_vb(self, target_blocks: int = 6) -> int:
        """
        Get fee estimate in sat/vB (more commonly used).

        Args:
            target_blocks: Target confirmation time in blocks.

        Returns:
            Estimated fee rate in sat/vB.
        """
        btc_per_kb = await self.get_fee_estimate(target_blocks)
        if btc_per_kb < 0:
            # Default to 10 sat/vB if estimation unavailable
            return 10

        # Convert BTC/kB to sat/vB
        # 1 BTC = 100,000,000 satoshis
        # 1 kB = 1000 bytes (but we want vbytes)
        sat_per_kb = int(btc_per_kb * 100_000_000)
        sat_per_vb = sat_per_kb // 1000
        return max(1, sat_per_vb)

    async def get_history(self, address: str) -> list[ElectrumTxInfo]:
        """
        Get transaction history for an address.

        Args:
            address: Bitcoin address.

        Returns:
            List of transactions affecting this address.
        """
        scripthash = self.address_to_scripthash(address)
        result = await self._call("blockchain.scripthash.get_history", [scripthash])

        txs = []
        for item in result:
            txs.append(
                ElectrumTxInfo(
                    txid=item["tx_hash"],
                    height=item.get("height", 0),
                    fee=item.get("fee"),
                )
            )
        return txs

    async def subscribe_address(self, address: str) -> str | None:
        """
        Subscribe to address notifications.

        Args:
            address: Bitcoin address to monitor.

        Returns:
            Current status hash, or None if no history.
        """
        scripthash = self.address_to_scripthash(address)
        return await self._call("blockchain.scripthash.subscribe", [scripthash])

    async def get_header(self, height: int) -> dict:
        """
        Get block header at specified height.

        Args:
            height: Block height.

        Returns:
            Block header data.
        """
        return await self._call("blockchain.block.header", [height, 0])

    async def get_tip(self) -> tuple[int, str]:
        """
        Get current blockchain tip.

        Returns:
            Tuple of (height, block_hash).
        """
        # Subscribe to headers to get current tip
        result = await self._call("blockchain.headers.subscribe", [])
        return result["height"], result.get("hex", "")

    async def ping(self) -> bool:
        """
        Check if server is responsive.

        Returns:
            True if server responds, False otherwise.
        """
        try:
            await self._call("server.ping", [])
            return True
        except ElectrumError:
            return False

    async def server_features(self) -> dict:
        """
        Get server features.

        Returns:
            Server features dictionary.
        """
        return await self._call("server.features", [])

    async def __aenter__(self) -> "ElectrumClient":
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        await self.disconnect()
