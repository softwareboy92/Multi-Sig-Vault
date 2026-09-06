"""
Safe multisig wallet manager.

Provides functionality for Safe wallet deployment, transaction building,
signature aggregation, and execution following the Safe protocol.

Reference: https://github.com/safe-global/safe-smart-account
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any

from eth_abi import encode, decode
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from .web3_client import Web3Client, Web3ClientError

logger = logging.getLogger(__name__)


# -----------------------------------------------------------------------------
# Safe Contract ABIs (Minimal)
# -----------------------------------------------------------------------------

# Safe Proxy Factory ABI (for CREATE2 deployment)
SAFE_PROXY_FACTORY_ABI = [
    {
        "name": "createProxyWithNonce",
        "type": "function",
        "inputs": [
            {"name": "_singleton", "type": "address"},
            {"name": "initializer", "type": "bytes"},
            {"name": "saltNonce", "type": "uint256"},
        ],
        "outputs": [{"name": "proxy", "type": "address"}],
    },
    {
        "name": "proxyCreationCode",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "bytes"}],
    },
]

# Safe Implementation ABI (for transaction execution)
SAFE_ABI = [
    {
        "name": "setup",
        "type": "function",
        "inputs": [
            {"name": "_owners", "type": "address[]"},
            {"name": "_threshold", "type": "uint256"},
            {"name": "to", "type": "address"},
            {"name": "data", "type": "bytes"},
            {"name": "fallbackHandler", "type": "address"},
            {"name": "paymentToken", "type": "address"},
            {"name": "payment", "type": "uint256"},
            {"name": "paymentReceiver", "type": "address"},
        ],
        "outputs": [],
    },
    {
        "name": "execTransaction",
        "type": "function",
        "inputs": [
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "data", "type": "bytes"},
            {"name": "operation", "type": "uint8"},
            {"name": "safeTxGas", "type": "uint256"},
            {"name": "baseGas", "type": "uint256"},
            {"name": "gasPrice", "type": "uint256"},
            {"name": "gasToken", "type": "address"},
            {"name": "refundReceiver", "type": "address"},
            {"name": "signatures", "type": "bytes"},
        ],
        "outputs": [{"name": "success", "type": "bool"}],
    },
    {
        "name": "getTransactionHash",
        "type": "function",
        "inputs": [
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "data", "type": "bytes"},
            {"name": "operation", "type": "uint8"},
            {"name": "safeTxGas", "type": "uint256"},
            {"name": "baseGas", "type": "uint256"},
            {"name": "gasPrice", "type": "uint256"},
            {"name": "gasToken", "type": "address"},
            {"name": "refundReceiver", "type": "address"},
            {"name": "_nonce", "type": "uint256"},
        ],
        "outputs": [{"name": "", "type": "bytes32"}],
    },
    {
        "name": "nonce",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "getOwners",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "address[]"}],
    },
    {
        "name": "getThreshold",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "isOwner",
        "type": "function",
        "inputs": [{"name": "owner", "type": "address"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    # ── Policy change methods ──
    {
        "name": "addOwnerWithThreshold",
        "type": "function",
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "_threshold", "type": "uint256"},
        ],
        "outputs": [],
    },
    {
        "name": "removeOwner",
        "type": "function",
        "inputs": [
            {"name": "prevOwner", "type": "address"},
            {"name": "owner", "type": "address"},
            {"name": "_threshold", "type": "uint256"},
        ],
        "outputs": [],
    },
    {
        "name": "swapOwner",
        "type": "function",
        "inputs": [
            {"name": "prevOwner", "type": "address"},
            {"name": "oldOwner", "type": "address"},
            {"name": "newOwner", "type": "address"},
        ],
        "outputs": [],
    },
    {
        "name": "changeThreshold",
        "type": "function",
        "inputs": [
            {"name": "_threshold", "type": "uint256"},
        ],
        "outputs": [],
    },
]

# Event signatures (with 0x prefix for RPC compatibility)
EXECUTION_SUCCESS_TOPIC = "0x" + Web3.keccak(text="ExecutionSuccess(bytes32,uint256)").hex()
EXECUTION_FAILURE_TOPIC = "0x" + Web3.keccak(text="ExecutionFailure(bytes32,uint256)").hex()
SAFE_RECEIVED_TOPIC = "0x" + Web3.keccak(text="SafeReceived(address,uint256)").hex()


class SafeManagerError(Web3ClientError):
    """Base exception for Safe operations."""

    pass


class SafeDeploymentError(SafeManagerError):
    """Raised when Safe deployment fails."""

    pass


class SafeTransactionError(SafeManagerError):
    """Raised when transaction building/execution fails."""

    pass


class Operation(IntEnum):
    """Safe transaction operation type."""

    CALL = 0
    DELEGATE_CALL = 1


@dataclass
class SafeDeploymentInfo:
    """Information about a Safe deployment."""

    address: str
    owners: list[str]
    threshold: int
    salt_nonce: int
    factory_address: str
    singleton_address: str
    fallback_handler: str
    is_deployed: bool = False


@dataclass
class SafeTransaction:
    """A Safe multisig transaction."""

    to: str
    value: int
    data: bytes
    operation: Operation = Operation.CALL
    safe_tx_gas: int = 0
    base_gas: int = 0
    gas_price: int = 0
    gas_token: str = "0x" + "0" * 40  # ETH
    refund_receiver: str = "0x" + "0" * 40
    nonce: int = 0

    # Derived fields
    safe_address: str = ""
    chain_id: int = 0
    tx_hash: bytes = field(default_factory=bytes)

    def encode_for_signing(self) -> bytes:
        """Encode transaction data for signature verification."""
        return encode(
            [
                "address",
                "uint256",
                "bytes32",
                "uint8",
                "uint256",
                "uint256",
                "uint256",
                "address",
                "address",
                "uint256",
            ],
            [
                Web3.to_checksum_address(self.to),
                self.value,
                Web3.keccak(self.data),
                self.operation,
                self.safe_tx_gas,
                self.base_gas,
                self.gas_price,
                Web3.to_checksum_address(self.gas_token),
                Web3.to_checksum_address(self.refund_receiver),
                self.nonce,
            ],
        )

    def get_typed_data(self) -> dict[str, Any]:
        """Get EIP-712 typed data for signing."""
        return {
            "types": {
                "EIP712Domain": [
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
                "SafeTx": [
                    {"name": "to", "type": "address"},
                    {"name": "value", "type": "uint256"},
                    {"name": "data", "type": "bytes"},
                    {"name": "operation", "type": "uint8"},
                    {"name": "safeTxGas", "type": "uint256"},
                    {"name": "baseGas", "type": "uint256"},
                    {"name": "gasPrice", "type": "uint256"},
                    {"name": "gasToken", "type": "address"},
                    {"name": "refundReceiver", "type": "address"},
                    {"name": "nonce", "type": "uint256"},
                ],
            },
            "primaryType": "SafeTx",
            "domain": {
                "chainId": self.chain_id,
                "verifyingContract": Web3.to_checksum_address(self.safe_address),
            },
            "message": {
                "to": Web3.to_checksum_address(self.to),
                "value": self.value,
                "data": ("0x" + self.data.hex()) if self.data else "0x",
                "operation": self.operation,
                "safeTxGas": self.safe_tx_gas,
                "baseGas": self.base_gas,
                "gasPrice": self.gas_price,
                "gasToken": Web3.to_checksum_address(self.gas_token),
                "refundReceiver": Web3.to_checksum_address(self.refund_receiver),
                "nonce": self.nonce,
            },
        }


@dataclass
class SafeSignature:
    """A signature for a Safe transaction."""

    signer: str
    data: bytes
    signature_type: int = 0  # 0 = contract, 1 = approved hash, 2 = eth_sign

    @property
    def v(self) -> int:
        """Extract v component (last byte, adjusted for Safe)."""
        if len(self.data) != 65:
            raise ValueError("Invalid signature length")
        return self.data[64]

    @property
    def r(self) -> bytes:
        """Extract r component (first 32 bytes)."""
        return self.data[:32]

    @property
    def s(self) -> bytes:
        """Extract s component (bytes 32-64)."""
        return self.data[32:64]


class SafeManager:
    """
    Manager for Safe multisig wallets.

    Handles deployment, transaction building, signature aggregation,
    and execution of Safe transactions.
    """

    # Default contract addresses (Safe v1.4.1 on major networks)
    # Safe v1.4.1 uses CREATE2 deterministic deployment so addresses are
    # identical across all supported EVM chains.  Per-chain entries are kept
    # for documentation; the class-level defaults serve as a universal
    # fallback for any chain with Safe v1.4.1 deployed.
    SAFE_V141_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"
    SAFE_V141_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a"
    SAFE_V141_FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99"

    DEFAULT_ADDRESSES: dict[int, dict[str, str]] = {
        1: {  # Ethereum Mainnet
            "factory": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
            "singleton": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
            "fallback_handler": "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
        },
        11155111: {  # Sepolia
            "factory": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
            "singleton": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
            "fallback_handler": "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
        },
        137: {  # Polygon
            "factory": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
            "singleton": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
            "fallback_handler": "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
        },
        42161: {  # Arbitrum One
            "factory": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
            "singleton": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
            "fallback_handler": "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
        },
        8453: {  # Base
            "factory": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
            "singleton": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
            "fallback_handler": "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
        },
        56: {  # BNB Smart Chain (Mainnet)
            "factory": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
            "singleton": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
            "fallback_handler": "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
        },
        97: {  # BNB Smart Chain (Testnet)
            "factory": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
            "singleton": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
            "fallback_handler": "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
        },
        10: {  # Optimism
            "factory": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
            "singleton": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
            "fallback_handler": "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
        },
        43114: {  # Avalanche C-Chain
            "factory": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
            "singleton": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
            "fallback_handler": "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
        },
    }

    def __init__(
        self,
        client: Web3Client,
        factory_address: str | None = None,
        singleton_address: str | None = None,
        fallback_handler: str | None = None,
    ):
        """
        Initialize Safe manager.

        Args:
            client: Connected Web3 client.
            factory_address: Safe Proxy Factory address (optional, uses default).
            singleton_address: Safe singleton address (optional, uses default).
            fallback_handler: Fallback handler address (optional, uses default).
        """
        self._client = client
        self._factory = factory_address
        self._singleton = singleton_address
        self._fallback_handler = fallback_handler

    def _get_addresses(self) -> dict[str, str]:
        """Get contract addresses for current chain.

        Resolution order per address:
        1. Explicitly provided via constructor
        2. Per-chain entry in DEFAULT_ADDRESSES
        3. Universal Safe v1.4.1 deterministic addresses (CREATE2)
        """
        chain_id = self._client.chain_id
        if chain_id is None:
            raise SafeManagerError("Client not connected")

        defaults = self.DEFAULT_ADDRESSES.get(chain_id, {})
        factory = (
            self._factory
            or defaults.get("factory")
            or self.SAFE_V141_FACTORY
        )
        singleton = (
            self._singleton
            or defaults.get("singleton")
            or self.SAFE_V141_SINGLETON
        )
        fallback_handler = (
            self._fallback_handler
            or defaults.get("fallback_handler")
            or self.SAFE_V141_FALLBACK_HANDLER
        )
        return {
            "factory": factory,
            "singleton": singleton,
            "fallback_handler": fallback_handler,
        }

    # -------------------------------------------------------------------------
    # Deployment
    # -------------------------------------------------------------------------

    def build_setup_data(
        self,
        owners: list[str],
        threshold: int,
        fallback_handler: str | None = None,
    ) -> bytes:
        """
        Build the setup function call data for Safe initialization.

        Args:
            owners: List of owner addresses.
            threshold: Required signature count.
            fallback_handler: Custom fallback handler (optional).

        Returns:
            Encoded setup() call data.
        """
        addresses = self._get_addresses()
        handler = fallback_handler or addresses["fallback_handler"]

        # Sort owners for deterministic address
        sorted_owners = sorted(owners, key=str.lower)
        checksummed = [Web3.to_checksum_address(o) for o in sorted_owners]

        # Encode setup(owners, threshold, to, data, fallbackHandler, paymentToken, payment, paymentReceiver)
        # setup(address[],uint256,address,bytes,address,address,uint256,address)
        function_selector = Web3.keccak(
            text="setup(address[],uint256,address,bytes,address,address,uint256,address)"
        )[:4]

        params = encode(
            [
                "address[]",
                "uint256",
                "address",
                "bytes",
                "address",
                "address",
                "uint256",
                "address",
            ],
            [
                checksummed,
                threshold,
                "0x" + "0" * 40,  # to (no module setup)
                b"",  # data
                Web3.to_checksum_address(handler),
                "0x" + "0" * 40,  # paymentToken (ETH)
                0,  # payment
                "0x" + "0" * 40,  # paymentReceiver
            ],
        )

        return function_selector + params

    async def get_proxy_creation_code(self) -> bytes:
        """
        Get the proxy creation code from the Safe Proxy Factory.

        Returns:
            The proxy creation bytecode.
        """
        addresses = self._get_addresses()
        factory = Web3.to_checksum_address(addresses["factory"])

        # proxyCreationCode() selector
        selector = Web3.keccak(text="proxyCreationCode()")[:4]

        result = await self._client.call(factory, selector)
        # Decode bytes from ABI-encoded response
        (creation_code,) = decode(["bytes"], result)
        return creation_code

    async def predict_safe_address(
        self,
        owners: list[str],
        threshold: int,
        salt_nonce: int,
    ) -> str:
        """
        Predict the Safe address using CREATE2.

        The Safe Proxy Factory uses CREATE2 with:
        - salt = keccak256(keccak256(initializer) ++ saltNonce)
        - init_code = proxyCreationCode ++ singleton_address (padded to 32 bytes)

        Args:
            owners: List of owner addresses.
            threshold: Required signature count.
            salt_nonce: Salt for CREATE2.

        Returns:
            Predicted Safe address.
        """
        addresses = self._get_addresses()

        # Build setup data (initializer)
        setup_data = self.build_setup_data(owners, threshold)

        # Salt calculation: keccak256(keccak256(initializer) ++ saltNonce)
        # This matches SafeProxyFactory.createProxyWithNonce
        initializer_hash = Web3.keccak(setup_data)
        salt = Web3.keccak(
            initializer_hash + salt_nonce.to_bytes(32, byteorder="big")
        )

        # Get proxy creation code from factory
        proxy_creation_code = await self.get_proxy_creation_code()

        # Append singleton address (32 bytes, left-padded with zeros)
        singleton_padded = bytes.fromhex(addresses["singleton"][2:].zfill(64))
        init_code = proxy_creation_code + singleton_padded
        init_code_hash = Web3.keccak(init_code)

        # CREATE2: keccak256(0xff ++ factory ++ salt ++ keccak256(init_code))[12:]
        factory_bytes = bytes.fromhex(addresses["factory"][2:])
        create2_input = b"\xff" + factory_bytes + salt + init_code_hash
        address_bytes = Web3.keccak(create2_input)[12:]

        return Web3.to_checksum_address("0x" + address_bytes.hex())

    async def get_deployment_info(
        self,
        owners: list[str],
        threshold: int,
        salt_nonce: int = 0,
    ) -> SafeDeploymentInfo:
        """
        Get deployment information for a Safe.

        Args:
            owners: List of owner addresses.
            threshold: Required signature count.
            salt_nonce: Salt for CREATE2 (default 0).

        Returns:
            SafeDeploymentInfo with predicted address and deployment status.

        Raises:
            SafeDeploymentError: If required Safe contracts are not deployed
                on the current chain.
        """
        addresses = self._get_addresses()

        # Verify that the Safe Proxy Factory is deployed on this chain.
        # Without it, CREATE2 prediction is meaningless and deployment
        # will certainly fail.
        factory_code = await self._client.web3.eth.get_code(
            Web3.to_checksum_address(addresses["factory"])
        )
        if len(factory_code) == 0:
            chain_id = self._client.chain_id
            raise SafeDeploymentError(
                f"Safe Proxy Factory ({addresses['factory']}) is not deployed "
                f"on chain {chain_id}. This chain may not support Safe wallets."
            )

        predicted = await self.predict_safe_address(owners, threshold, salt_nonce)

        # Check if already deployed
        code = await self._client.web3.eth.get_code(
            Web3.to_checksum_address(predicted)
        )
        is_deployed = len(code) > 0

        return SafeDeploymentInfo(
            address=predicted,
            owners=sorted(owners, key=str.lower),
            threshold=threshold,
            salt_nonce=salt_nonce,
            factory_address=addresses["factory"],
            singleton_address=addresses["singleton"],
            fallback_handler=addresses["fallback_handler"],
            is_deployed=is_deployed,
        )

    def build_deployment_tx(
        self,
        owners: list[str],
        threshold: int,
        salt_nonce: int = 0,
    ) -> dict[str, Any]:
        """
        Build transaction to deploy a new Safe.

        Args:
            owners: List of owner addresses.
            threshold: Required signature count.
            salt_nonce: Salt for CREATE2.

        Returns:
            Transaction dict ready for signing.
        """
        addresses = self._get_addresses()
        setup_data = self.build_setup_data(owners, threshold)

        # createProxyWithNonce(singleton, initializer, saltNonce)
        function_selector = Web3.keccak(
            text="createProxyWithNonce(address,bytes,uint256)"
        )[:4]

        params = encode(
            ["address", "bytes", "uint256"],
            [
                Web3.to_checksum_address(addresses["singleton"]),
                setup_data,
                salt_nonce,
            ],
        )

        return {
            "to": Web3.to_checksum_address(addresses["factory"]),
            "data": (function_selector + params).hex(),
            "value": 0,
        }

    # -------------------------------------------------------------------------
    # Transaction Building
    # -------------------------------------------------------------------------

    async def get_nonce(self, safe_address: str) -> int:
        """
        Get the current nonce for a Safe.

        Args:
            safe_address: Safe contract address.

        Returns:
            Current nonce.
        """
        # nonce()
        data = Web3.keccak(text="nonce()")[:4]
        result = await self._client.call(safe_address, data)
        (nonce,) = decode(["uint256"], result)
        return nonce

    async def build_safe_transaction(
        self,
        safe_address: str,
        to: str,
        value: int,
        data: bytes = b"",
        operation: Operation = Operation.CALL,
        safe_tx_gas: int = 0,
        base_gas: int = 0,
        gas_price: int = 0,
        gas_token: str | None = None,
        refund_receiver: str | None = None,
        nonce: int | None = None,
    ) -> SafeTransaction:
        """
        Build a Safe transaction.

        Args:
            safe_address: Safe contract address.
            to: Target address.
            value: ETH value in wei.
            data: Call data.
            operation: CALL or DELEGATE_CALL.
            safe_tx_gas: Gas for Safe execution.
            base_gas: Base gas overhead.
            gas_price: Gas price for refund.
            gas_token: Token for gas refund (default ETH).
            refund_receiver: Refund recipient.
            nonce: Transaction nonce (fetched if not provided).

        Returns:
            SafeTransaction ready for signing.
        """
        if nonce is None:
            nonce = await self.get_nonce(safe_address)

        chain_id = self._client.chain_id
        if chain_id is None:
            raise SafeTransactionError("Client not connected")

        tx = SafeTransaction(
            to=to,
            value=value,
            data=data,
            operation=operation,
            safe_tx_gas=safe_tx_gas,
            base_gas=base_gas,
            gas_price=gas_price,
            gas_token=gas_token or "0x" + "0" * 40,
            refund_receiver=refund_receiver or "0x" + "0" * 40,
            nonce=nonce,
            safe_address=safe_address,
            chain_id=chain_id,
        )

        # Calculate transaction hash
        tx.tx_hash = self._calculate_tx_hash(tx)

        return tx

    def _calculate_tx_hash(self, tx: SafeTransaction) -> bytes:
        """Calculate the Safe transaction hash for signing."""
        # Domain separator
        domain_separator = Web3.keccak(
            encode(
                ["bytes32", "uint256", "address"],
                [
                    Web3.keccak(
                        text="EIP712Domain(uint256 chainId,address verifyingContract)"
                    ),
                    tx.chain_id,
                    Web3.to_checksum_address(tx.safe_address),
                ],
            )
        )

        # SafeTx type hash
        safe_tx_type_hash = Web3.keccak(
            text="SafeTx(address to,uint256 value,bytes data,uint8 operation,"
            "uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,"
            "address gasToken,address refundReceiver,uint256 nonce)"
        )

        # Struct hash
        struct_hash = Web3.keccak(
            encode(
                [
                    "bytes32",
                    "address",
                    "uint256",
                    "bytes32",
                    "uint8",
                    "uint256",
                    "uint256",
                    "uint256",
                    "address",
                    "address",
                    "uint256",
                ],
                [
                    safe_tx_type_hash,
                    Web3.to_checksum_address(tx.to),
                    tx.value,
                    Web3.keccak(tx.data),
                    tx.operation,
                    tx.safe_tx_gas,
                    tx.base_gas,
                    tx.gas_price,
                    Web3.to_checksum_address(tx.gas_token),
                    Web3.to_checksum_address(tx.refund_receiver),
                    tx.nonce,
                ],
            )
        )

        # Final hash
        return Web3.keccak(b"\x19\x01" + domain_separator + struct_hash)

    # -------------------------------------------------------------------------
    # Signature Handling
    # -------------------------------------------------------------------------

    def combine_signatures(self, signatures: list[SafeSignature]) -> bytes:
        """
        Combine multiple signatures for Safe execution.

        Signatures must be sorted by signer address (ascending).

        Args:
            signatures: List of SafeSignature objects.

        Returns:
            Combined signature bytes for execTransaction.
        """
        # Sort by signer address
        sorted_sigs = sorted(signatures, key=lambda s: s.signer.lower())

        # Concatenate signature data
        combined = b""
        for sig in sorted_sigs:
            if len(sig.data) != 65:
                raise SafeTransactionError(
                    f"Invalid signature length from {sig.signer}"
                )
            combined += sig.data

        return combined

    def verify_signature(
        self,
        tx: SafeTransaction,
        signature: SafeSignature,
    ) -> bool:
        """
        Verify a signature for a Safe transaction.

        Args:
            tx: The Safe transaction.
            signature: The signature to verify.

        Returns:
            True if signature is valid.
        """
        try:
            typed_data = tx.get_typed_data()
            encoded = encode_typed_data(full_message=typed_data)
            recovered = Account.recover_message(encoded, signature=signature.data)
            return recovered.lower() == signature.signer.lower()
        except Exception:
            return False

    # -------------------------------------------------------------------------
    # Execution
    # -------------------------------------------------------------------------

    def build_exec_transaction_data(
        self,
        tx: SafeTransaction,
        signatures: bytes,
    ) -> bytes:
        """
        Build the execTransaction call data.

        Args:
            tx: The Safe transaction.
            signatures: Combined signature bytes.

        Returns:
            Encoded execTransaction call data.
        """
        # execTransaction(to,value,data,operation,safeTxGas,baseGas,gasPrice,gasToken,refundReceiver,signatures)
        function_selector = Web3.keccak(
            text="execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)"
        )[:4]

        params = encode(
            [
                "address",
                "uint256",
                "bytes",
                "uint8",
                "uint256",
                "uint256",
                "uint256",
                "address",
                "address",
                "bytes",
            ],
            [
                Web3.to_checksum_address(tx.to),
                tx.value,
                tx.data,
                tx.operation,
                tx.safe_tx_gas,
                tx.base_gas,
                tx.gas_price,
                Web3.to_checksum_address(tx.gas_token),
                Web3.to_checksum_address(tx.refund_receiver),
                signatures,
            ],
        )

        return function_selector + params

    # -------------------------------------------------------------------------
    # Event Parsing
    # -------------------------------------------------------------------------

    @staticmethod
    def parse_execution_event(log: dict[str, Any]) -> dict[str, Any] | None:
        """
        Parse an ExecutionSuccess or ExecutionFailure event.

        Args:
            log: Raw log entry from eth_getLogs.

        Returns:
            Parsed event data or None if not matching.
        """
        topics = log.get("topics", [])
        if not topics:
            return None

        topic0 = topics[0].hex() if hasattr(topics[0], "hex") else topics[0]
        # Normalize to lowercase without 0x prefix for comparison
        topic0_normalized = topic0.lower().replace("0x", "")
        success_normalized = EXECUTION_SUCCESS_TOPIC.lower().replace("0x", "")
        failure_normalized = EXECUTION_FAILURE_TOPIC.lower().replace("0x", "")

        # Get data and validate it has enough bytes for decoding
        data = log.get("data", b"")
        if isinstance(data, str):
            data = bytes.fromhex(data.replace("0x", "")) if data and data != "0x" else b""
        elif hasattr(data, "hex"):
            data = bytes(data)
        
        # ExecutionSuccess/ExecutionFailure events have bytes32 + uint256 = 64 bytes of data
        if len(data) < 64:
            return None

        try:
            if topic0_normalized == success_normalized:
                (tx_hash, payment) = decode(["bytes32", "uint256"], data)
                return {
                    "event": "ExecutionSuccess",
                    "safe": log["address"],
                    "tx_hash": tx_hash.hex(),
                    "payment": payment,
                    "block": log["blockNumber"],
                    "tx": log["transactionHash"].hex()
                    if hasattr(log["transactionHash"], "hex")
                    else log["transactionHash"],
                }
            elif topic0_normalized == failure_normalized:
                (tx_hash, payment) = decode(["bytes32", "uint256"], data)
                return {
                    "event": "ExecutionFailure",
                    "safe": log["address"],
                    "tx_hash": tx_hash.hex(),
                    "payment": payment,
                    "block": log["blockNumber"],
                    "tx": log["transactionHash"].hex()
                    if hasattr(log["transactionHash"], "hex")
                    else log["transactionHash"],
                }
        except Exception:
            # Decoding failed, skip this event
            return None

        return None

    # ── Policy change helpers ──

    SENTINEL_ADDRESS = "0x0000000000000000000000000000000000000001"

    @staticmethod
    def derive_prev_owner(owners: list[str], target: str) -> str:
        """Derive the previous owner in the Safe linked list.

        Safe stores owners as a linked list with SENTINEL (0x...01) as head.
        removeOwner/swapOwner require the preceding node.

        Args:
            owners: Ordered owner list from getOwners().
            target: The owner address to find the predecessor for.

        Returns:
            Previous owner address, or SENTINEL if target is first.

        Raises:
            ValueError: If target is not in the owners list.
        """
        target_lower = target.lower()
        for i, owner in enumerate(owners):
            if owner.lower() == target_lower:
                if i == 0:
                    return SafeManager.SENTINEL_ADDRESS
                return owners[i - 1]
        raise ValueError(f"Address {target} not found in owners list")

    def build_policy_change_data(
        self,
        action: str,
        *,
        new_owner: str | None = None,
        removed_owner: str | None = None,
        new_threshold: int | None = None,
        owners: list[str] | None = None,
    ) -> bytes:
        """Encode calldata for a Safe policy change operation.

        Args:
            action: One of add_owner, remove_owner, swap_owner, change_threshold.
            new_owner: Address to add (add_owner, swap_owner).
            removed_owner: Address to remove (remove_owner, swap_owner).
            new_threshold: New threshold value (add_owner, remove_owner, change_threshold).
            owners: Current owner list for prevOwner derivation (remove_owner, swap_owner).

        Returns:
            ABI-encoded calldata bytes.
        """
        if action == "add_owner":
            selector = Web3.keccak(text="addOwnerWithThreshold(address,uint256)")[:4]
            params = encode(
                ["address", "uint256"],
                [Web3.to_checksum_address(new_owner), new_threshold],
            )
        elif action == "remove_owner":
            prev = self.derive_prev_owner(owners, removed_owner)
            selector = Web3.keccak(text="removeOwner(address,address,uint256)")[:4]
            params = encode(
                ["address", "address", "uint256"],
                [
                    Web3.to_checksum_address(prev),
                    Web3.to_checksum_address(removed_owner),
                    new_threshold,
                ],
            )
        elif action == "swap_owner":
            prev = self.derive_prev_owner(owners, removed_owner)
            selector = Web3.keccak(text="swapOwner(address,address,address)")[:4]
            params = encode(
                ["address", "address", "address"],
                [
                    Web3.to_checksum_address(prev),
                    Web3.to_checksum_address(removed_owner),
                    Web3.to_checksum_address(new_owner),
                ],
            )
        elif action == "change_threshold":
            selector = Web3.keccak(text="changeThreshold(uint256)")[:4]
            params = encode(["uint256"], [new_threshold])
        else:
            raise ValueError(f"Unknown policy action: {action}")

        return selector + params
