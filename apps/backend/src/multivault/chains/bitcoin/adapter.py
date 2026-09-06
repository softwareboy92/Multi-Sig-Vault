"""
Bitcoin Chain Adapter.

Implements the ChainAdapter interface for Bitcoin, providing:
- P2WSH multisig address derivation
- UTXO-based balance queries via Electrum
- PSBT construction for multisig transactions
- Transaction broadcasting
"""

from hashlib import sha256

import structlog
from embit.ec import PublicKey

from multivault.chains.base import (
    Balance,
    BroadcastResult,
    ChainAdapter,
    UnsignedTransaction,
    UTXO,
    WalletConfig,
)
from multivault.chains.bitcoin.address import (
    BitcoinNetwork,
    build_multisig_script,
    derive_p2sh_p2wsh_address,
    derive_p2wsh_address,
    validate_public_key,
)
from multivault.chains.bitcoin.electrum import (
    ElectrumClient,
    ElectrumConnectionError,
    ElectrumRPCError,
    ElectrumTxInfo,
)
from multivault.chains.bitcoin.psbt import (
    MultisigConfig,
    PSBTBuilder,
    PSBTInfo,
    TxOutput,
)

logger = structlog.get_logger(__name__)


class BitcoinAdapterError(Exception):
    """Base exception for Bitcoin adapter errors."""

    pass


class BitcoinAdapter(ChainAdapter[PSBTInfo]):
    """
    Bitcoin chain adapter implementation.

    Provides Bitcoin-specific functionality for multisig wallets using
    P2WSH (native SegWit) addresses and PSBT for transaction signing.

    Example:
        async with BitcoinAdapter(
            electrum_host="electrum.blockstream.info",
            electrum_port=50002,
            network=BitcoinNetwork.MAINNET,
        ) as adapter:
            # Create multisig wallet
            config = await adapter.create_multisig([pk1, pk2], threshold=2)
            print(f"Address: {config.address}")

            # Check balance
            balance = await adapter.get_balance(config.address)
            print(f"Balance: {balance.confirmed} sat")

            # Build transaction
            tx = await adapter.build_transaction(
                from_address=config.address,
                to_address="bc1q...",
                amount=50000,
            )
    """

    def __init__(
        self,
        electrum_host: str = ElectrumClient.DEFAULT_HOST,
        electrum_port: int = ElectrumClient.DEFAULT_PORT,
        electrum_ssl: bool = True,
        network: BitcoinNetwork = BitcoinNetwork.MAINNET,
        timeout: float = 30.0,
    ):
        """
        Initialize Bitcoin adapter.

        Args:
            electrum_host: Electrum server hostname.
            electrum_port: Electrum server port.
            electrum_ssl: Whether to use SSL/TLS.
            network: Bitcoin network (mainnet/testnet/regtest).
            timeout: Connection timeout in seconds.
        """
        self.network = network
        self._electrum = ElectrumClient(
            host=electrum_host,
            port=electrum_port,
            use_ssl=electrum_ssl,
            timeout=timeout,
        )
        self._connected = False

        # Cache for wallet configurations (address -> MultisigConfig)
        self._wallet_configs: dict[str, MultisigConfig] = {}

    @property
    def electrum(self) -> ElectrumClient:
        """Expose the Electrum client for direct access by workers."""
        return self._electrum

    @property
    def chain_name(self) -> str:
        """Return chain identifier."""
        return "BTC"

    @property
    def is_connected(self) -> bool:
        """Check if connected to Electrum server."""
        return self._connected and self._electrum.is_connected

    async def connect(self) -> None:
        """Connect to Electrum server."""
        if self._connected:
            return

        try:
            await self._electrum.connect()
            self._connected = True
            logger.info(
                "bitcoin_adapter_connected",
                network=self.network.value,
                host=self._electrum.host,
            )
        except ElectrumConnectionError as e:
            raise ConnectionError(f"Failed to connect to Electrum: {e}") from e

    async def disconnect(self) -> None:
        """Disconnect from Electrum server."""
        await self._electrum.disconnect()
        self._connected = False
        logger.info("bitcoin_adapter_disconnected")

    async def create_multisig(
        self,
        public_keys_or_addresses: list[str],
        threshold: int,
        **kwargs,
    ) -> WalletConfig:
        """
        Create a P2WSH multisig wallet configuration.

        Public keys are sorted lexicographically per BIP-67 before deriving
        the address, ensuring deterministic address generation regardless
        of input order.

        Args:
            public_keys_or_addresses: List of hex-encoded compressed public keys.
            threshold: Number of required signatures (M in M-of-N).
            **kwargs: Additional options:
                - script_type: "p2wsh" (default) or "p2sh-p2wsh"

        Returns:
            WalletConfig with derived address and metadata.

        Raises:
            ValueError: If public keys are invalid or threshold is out of range.
        """
        public_keys = public_keys_or_addresses  # For Bitcoin, these must be pubkeys

        # Validate public keys
        for pk in public_keys:
            if not validate_public_key(pk):
                raise ValueError(f"Invalid public key: {pk}")

        # Validate threshold
        if threshold < 1:
            raise ValueError("Threshold must be at least 1")
        if threshold > len(public_keys):
            raise ValueError(
                f"Threshold {threshold} exceeds number of keys {len(public_keys)}"
            )

        script_type = kwargs.get("script_type", "p2wsh")

        if script_type == "p2sh-p2wsh":
            address, redeem_script, witness_script = derive_p2sh_p2wsh_address(
                threshold=threshold,
                public_keys=public_keys,
                network=self.network,
            )
            config = MultisigConfig(
                threshold=threshold,
                public_keys=public_keys,
                witness_script=witness_script,
                redeem_script=redeem_script,
                script_type="p2sh-p2wsh",
            )
            self._wallet_configs[address] = config

            logger.info(
                "multisig_created",
                address=address,
                threshold=threshold,
                signers=len(public_keys),
                script_type="p2sh-p2wsh",
            )

            return WalletConfig(
                address=address,
                status="ACTIVE",
                extra_data={
                    "script_type": "p2sh-p2wsh",
                    "witness_script": witness_script.hex(),
                    "redeem_script": redeem_script.hex(),
                    "sorted_pubkeys": sorted(public_keys),
                    "network": self.network.value,
                },
            )
        elif script_type == "p2wsh":
            address, witness_script = derive_p2wsh_address(
                threshold=threshold,
                public_keys=public_keys,
                network=self.network,
            )
            config = MultisigConfig(
                threshold=threshold,
                public_keys=public_keys,
                witness_script=witness_script,
            )
            self._wallet_configs[address] = config

            logger.info(
                "multisig_created",
                address=address,
                threshold=threshold,
                signers=len(public_keys),
                script_type="p2wsh",
            )

            return WalletConfig(
                address=address,
                status="ACTIVE",
                extra_data={
                    "script_type": "p2wsh",
                    "witness_script": witness_script.hex(),
                    "sorted_pubkeys": sorted(public_keys),
                    "network": self.network.value,
                },
            )
        else:
            raise ValueError(f"Unsupported script_type: {script_type}")

    def register_wallet(
        self,
        address: str,
        threshold: int,
        public_keys: list[str],
        witness_script: bytes | str | None = None,
        redeem_script: bytes | str | None = None,
        script_type: str = "p2wsh",
    ) -> None:
        """
        Register an existing wallet configuration.

        Use this to register wallets loaded from the database so the adapter
        can build transactions for them.

        Args:
            address: Wallet address.
            threshold: Signature threshold.
            public_keys: List of public keys.
            witness_script: Pre-computed witness script (optional).
            redeem_script: Pre-computed redeem script (P2SH-P2WSH only).
            script_type: "p2wsh" (default) or "p2sh-p2wsh".
        """
        if isinstance(witness_script, str):
            witness_script = bytes.fromhex(witness_script)
        if isinstance(redeem_script, str):
            redeem_script = bytes.fromhex(redeem_script)

        config = MultisigConfig(
            threshold=threshold,
            public_keys=public_keys,
            witness_script=witness_script or b"",
            redeem_script=redeem_script,
            script_type=script_type,
        )
        self._wallet_configs[address] = config

    async def get_balance(self, address: str) -> Balance:
        """
        Get balance for a Bitcoin address.

        Args:
            address: Bitcoin address to query.

        Returns:
            Balance with confirmed and unconfirmed amounts in satoshis.
        """
        if not self.is_connected:
            raise ConnectionError("Not connected to Electrum server")

        try:
            result = await self._electrum.get_balance(address)
            return Balance(
                confirmed=result.get("confirmed", 0),
                unconfirmed=result.get("unconfirmed", 0),
            )
        except ElectrumRPCError as e:
            raise BitcoinAdapterError(f"Failed to get balance: {e}") from e

    async def list_unspent(self, address: str) -> list[UTXO]:
        """
        Get unspent transaction outputs for an address.

        Args:
            address: Bitcoin address.

        Returns:
            List of UTXOs.
        """
        if not self.is_connected:
            raise ConnectionError("Not connected to Electrum server")

        try:
            electrum_utxos = await self._electrum.list_unspent(address)
            return [
                UTXO(
                    txid=u.txid,
                    vout=u.vout,
                    value=u.value,
                    height=u.height,
                )
                for u in electrum_utxos
            ]
        except ElectrumRPCError as e:
            raise BitcoinAdapterError(f"Failed to list UTXOs: {e}") from e

    async def get_fee_rate(self, target_blocks: int = 6) -> int:
        """
        Get recommended fee rate.

        Args:
            target_blocks: Target confirmation time in blocks.

        Returns:
            Fee rate in sat/vB.
        """
        if not self.is_connected:
            raise ConnectionError("Not connected to Electrum server")

        try:
            return await self._electrum.get_fee_estimate_sat_vb(target_blocks)
        except ElectrumRPCError as e:
            logger.warning("fee_estimation_failed", error=str(e))
            return 10  # Default fallback

    async def build_transaction(
        self,
        from_address: str,
        to_address: str,
        amount: int,
        **kwargs,
    ) -> UnsignedTransaction:
        """
        Build an unsigned PSBT for a multisig transaction.

        Args:
            from_address: Source multisig wallet address.
            to_address: Destination address.
            amount: Amount to send in satoshis.
            **kwargs: Additional options:
                - fee_rate: Fee rate in sat/vB (default: auto-estimate)
                - change_address: Address for change (default: from_address)

        Returns:
            UnsignedTransaction containing the PSBT.

        Raises:
            ValueError: If wallet not registered or invalid parameters.
            BitcoinAdapterError: If transaction building fails.
        """
        if not self.is_connected:
            raise ConnectionError("Not connected to Electrum server")

        # Get wallet configuration
        config = self._wallet_configs.get(from_address)
        if not config:
            raise ValueError(
                f"Wallet not registered: {from_address}. "
                "Call register_wallet() or create_multisig() first."
            )

        # Get fee rate
        fee_rate = kwargs.get("fee_rate")
        if not fee_rate:
            target_blocks = kwargs.get("target_blocks", 6)
            fee_rate = await self.get_fee_rate(target_blocks)

        # Get change address
        change_address = kwargs.get("change_address", from_address)

        # Fetch UTXOs
        electrum_utxos = await self._electrum.list_unspent(from_address)
        if not electrum_utxos:
            raise BitcoinAdapterError("No UTXOs available for this address")

        # Build PSBT
        builder = PSBTBuilder(
            network=self.network,
            multisig_config=config,
        )

        outputs = [TxOutput(address=to_address, amount=amount)]

        try:
            psbt_info = builder.build(
                utxos=electrum_utxos,
                outputs=outputs,
                change_address=change_address,
                fee_rate=fee_rate,
            )
        except Exception as e:
            raise BitcoinAdapterError(f"Failed to build PSBT: {e}") from e

        logger.info(
            "psbt_built",
            from_address=from_address,
            to_address=to_address,
            amount=amount,
            fee=psbt_info.fee,
            fee_rate=f"{psbt_info.fee_rate:.1f} sat/vB",
        )

        return UnsignedTransaction(
            payload=psbt_info.psbt_base64,
            fee=psbt_info.fee,
            metadata={
                "format": "psbt_base64",
                "psbt_hex": psbt_info.psbt_hex,
                "input_count": psbt_info.input_count,
                "output_count": psbt_info.output_count,
                "total_input": psbt_info.total_input,
                "total_output": psbt_info.total_output,
                "change_amount": psbt_info.change_amount,
                "estimated_vsize": psbt_info.estimated_vsize,
                "fee_rate_sat_vb": psbt_info.fee_rate,
            },
        )

    async def verify_signature(
        self,
        message: bytes,
        signature: bytes,
        public_key: str,
    ) -> bool:
        """
        Verify an ECDSA signature.

        Args:
            message: The original message that was signed.
            signature: The DER-encoded signature.
            public_key: Hex-encoded public key.

        Returns:
            True if signature is valid.
        """
        try:
            # Parse public key
            pk_bytes = bytes.fromhex(public_key)
            pubkey = PublicKey.parse(pk_bytes)

            # Hash message if not already hashed
            if len(message) != 32:
                message_hash = sha256(sha256(message).digest()).digest()
            else:
                message_hash = message

            # Verify
            return pubkey.verify(signature, message_hash)
        except Exception as e:
            logger.warning("signature_verification_failed", error=str(e))
            return False

    async def broadcast(self, signed_tx: bytes | str) -> BroadcastResult:
        """
        Broadcast a signed transaction.

        Args:
            signed_tx: Raw transaction hex or PSBT to finalize and broadcast.

        Returns:
            BroadcastResult with transaction hash.
        """
        if not self.is_connected:
            raise ConnectionError("Not connected to Electrum server")

        try:
            # If it's a PSBT, finalize it first
            if isinstance(signed_tx, str) and signed_tx.startswith("cHNid"):
                # Base64-encoded PSBT
                raw_tx, txid = PSBTBuilder.finalize(signed_tx)
                tx_hex = raw_tx.hex()
            elif isinstance(signed_tx, bytes):
                tx_hex = signed_tx.hex()
            else:
                tx_hex = signed_tx

            # Broadcast
            result_txid = await self._electrum.broadcast_transaction(tx_hex)

            logger.info("transaction_broadcast", txid=result_txid)

            return BroadcastResult(
                tx_hash=result_txid,
                success=True,
            )

        except ElectrumRPCError as e:
            logger.error("broadcast_failed", error=str(e))
            return BroadcastResult(
                tx_hash="",
                success=False,
                error=str(e),
            )
        except Exception as e:
            logger.error("broadcast_error", error=str(e))
            return BroadcastResult(
                tx_hash="",
                success=False,
                error=str(e),
            )

    async def get_transaction(self, txid: str) -> str:
        """
        Get transaction raw hex.
        
        Note: Many Electrum servers (like Blockstream) don't support verbose mode,
        so this returns raw transaction hex. Use get_history() to get confirmations.

        Args:
            txid: Transaction ID.

        Returns:
            Raw transaction hex string.
        """
        if not self.is_connected:
            raise ConnectionError("Not connected to Electrum server")

        return await self._electrum.get_raw_transaction(txid)

    async def get_history(self, address: str) -> list[ElectrumTxInfo]:
        """
        Get transaction history for an address.

        Args:
            address: Bitcoin address.

        Returns:
            List of transactions affecting this address.
        """
        if not self.is_connected:
            raise ConnectionError("Not connected to Electrum server")

        return await self._electrum.get_history(address)

    async def get_blockchain_tip(self) -> tuple[int, str]:
        """
        Get current blockchain tip.

        Returns:
            Tuple of (block_height, block_hash).
        """
        if not self.is_connected:
            raise ConnectionError("Not connected to Electrum server")

        return await self._electrum.get_tip()
