"""
Bitcoin P2WSH (Pay-to-Witness-Script-Hash) address derivation.

Implements BIP-67 compliant multisig address generation:
- Lexicographic sorting of public keys
- Witness script construction
- Native SegWit (bech32) address encoding
"""

from enum import Enum
from hashlib import sha256

from embit import compact, script
from embit.bip32 import HDKey
from embit.networks import NETWORKS


class BitcoinNetwork(str, Enum):
    """Bitcoin network types."""

    MAINNET = "mainnet"
    TESTNET = "testnet"
    TESTNET3 = "testnet3"
    TESTNET4 = "testnet4"
    REGTEST = "regtest"


def get_embit_network(network: BitcoinNetwork):
    """Get embit network configuration."""
    if network == BitcoinNetwork.MAINNET:
        return NETWORKS["main"]
    elif network in (BitcoinNetwork.TESTNET, BitcoinNetwork.TESTNET3, BitcoinNetwork.TESTNET4):
        return NETWORKS["test"]
    elif network == BitcoinNetwork.REGTEST:
        return NETWORKS["regtest"]
    else:
        raise ValueError(f"Unknown network: {network}")


def parse_public_key(pubkey: str) -> bytes:
    """
    Parse a public key from hex string to bytes.

    Supports both compressed (33 bytes) and uncompressed (65 bytes) keys.
    Always returns compressed format for consistency.

    Args:
        pubkey: Hex-encoded public key.

    Returns:
        33-byte compressed public key.

    Raises:
        ValueError: If public key is invalid.
    """
    try:
        pubkey_bytes = bytes.fromhex(pubkey)
    except ValueError as e:
        raise ValueError(f"Invalid hex public key: {pubkey}") from e

    if len(pubkey_bytes) == 33:
        # Already compressed
        if pubkey_bytes[0] not in (0x02, 0x03):
            raise ValueError(f"Invalid compressed public key prefix: {pubkey_bytes[0]}")
        return pubkey_bytes

    elif len(pubkey_bytes) == 65:
        # Uncompressed - convert to compressed
        if pubkey_bytes[0] != 0x04:
            raise ValueError(f"Invalid uncompressed public key prefix: {pubkey_bytes[0]}")

        # Compress: prefix depends on Y coordinate parity
        x = pubkey_bytes[1:33]
        y = pubkey_bytes[33:65]
        prefix = 0x02 if y[-1] % 2 == 0 else 0x03
        return bytes([prefix]) + x

    else:
        raise ValueError(
            f"Invalid public key length: {len(pubkey_bytes)} bytes "
            "(expected 33 or 65)"
        )


def sort_public_keys(public_keys: list[str]) -> list[bytes]:
    """
    Sort public keys lexicographically per BIP-67.

    BIP-67 specifies that public keys in multisig scripts must be
    sorted in lexicographic order of their byte representation.

    Args:
        public_keys: List of hex-encoded public keys.

    Returns:
        Sorted list of compressed public key bytes.
    """
    parsed = [parse_public_key(pk) for pk in public_keys]
    return sorted(parsed)


def build_multisig_script(threshold: int, public_keys: list[str]) -> bytes:
    """
    Build a multisig redeem/witness script.

    Creates an M-of-N multisig script following BIP-67:
    OP_M <pubkey1> <pubkey2> ... <pubkeyN> OP_N OP_CHECKMULTISIG

    Args:
        threshold: Number of required signatures (M).
        public_keys: List of hex-encoded public keys.

    Returns:
        Serialized script bytes.

    Raises:
        ValueError: If threshold is invalid or too many keys.
    """
    n = len(public_keys)

    if threshold < 1:
        raise ValueError("Threshold must be at least 1")
    if threshold > n:
        raise ValueError(f"Threshold {threshold} exceeds key count {n}")
    if n > 15:
        raise ValueError(f"Too many public keys: {n} (max 15 for standard multisig)")

    # Sort keys per BIP-67
    sorted_keys = sort_public_keys(public_keys)

    # Build script:
    # OP_M <pk1> <pk2> ... <pkN> OP_N OP_CHECKMULTISIG
    #
    # OP_1 through OP_16 are represented as 0x51 through 0x60
    # For values 1-16, the opcode is 0x50 + value
    parts = []

    # OP_M (threshold)
    parts.append(bytes([0x50 + threshold]))

    # Push each public key
    for pk in sorted_keys:
        # Length prefix for PUSHDATA
        parts.append(bytes([len(pk)]))
        parts.append(pk)

    # OP_N (total keys)
    parts.append(bytes([0x50 + n]))

    # OP_CHECKMULTISIG
    parts.append(bytes([0xAE]))

    return b"".join(parts)


def derive_p2wsh_address(
    threshold: int,
    public_keys: list[str],
    network: BitcoinNetwork = BitcoinNetwork.MAINNET,
) -> tuple[str, bytes]:
    """
    Derive a P2WSH (native SegWit) multisig address.

    Creates a bech32 address from a multisig witness script:
    1. Build M-of-N witness script
    2. SHA256 hash the script
    3. Encode as bech32 with witness version 0

    Args:
        threshold: Number of required signatures.
        public_keys: List of hex-encoded public keys.
        network: Bitcoin network for address prefix.

    Returns:
        Tuple of (bech32_address, witness_script_bytes).

    Example:
        >>> address, script = derive_p2wsh_address(2, [pk1, pk2, pk3])
        >>> print(address)
        'bc1q...'
    """
    # Build witness script
    witness_script = build_multisig_script(threshold, public_keys)

    # SHA256 of witness script (not double SHA256)
    script_hash = sha256(witness_script).digest()

    # Get network HRP (human-readable part)
    net = get_embit_network(network)
    hrp = net.get("bech32", "bc")

    # Encode as bech32 P2WSH
    # P2WSH uses witness version 0 and 32-byte script hash
    address = script.p2wsh(script.Script(witness_script)).address(net)

    return address, witness_script


def derive_p2sh_p2wsh_address(
    threshold: int,
    public_keys: list[str],
    network: BitcoinNetwork = BitcoinNetwork.MAINNET,
) -> tuple[str, bytes, bytes]:
    """
    Derive a P2SH-P2WSH (nested SegWit) multisig address.

    For backward compatibility with wallets that don't support native SegWit.

    Args:
        threshold: Number of required signatures.
        public_keys: List of hex-encoded public keys.
        network: Bitcoin network for address prefix.

    Returns:
        Tuple of (base58_address, redeem_script, witness_script).
    """
    # Build witness script
    witness_script = build_multisig_script(threshold, public_keys)

    # SHA256 of witness script
    script_hash = sha256(witness_script).digest()

    # Redeem script: OP_0 <32-byte-hash>
    # This is what goes in the P2SH redeem script
    redeem_script = bytes([0x00, 0x20]) + script_hash

    # Get network configuration
    net = get_embit_network(network)

    # Create P2SH address from the redeem script
    sc = script.Script(redeem_script)
    address = script.p2sh(sc).address(net)

    return address, redeem_script, witness_script


def pubkey_from_xpub(xpub: str, path: str = "0/0") -> str:
    """
    Derive a public key from an extended public key.

    Args:
        xpub: Extended public key (xpub/tpub/zpub/etc.).
        path: Derivation path relative to xpub (e.g., "0/0").

    Returns:
        Hex-encoded compressed public key.
    """
    hd = HDKey.from_base58(xpub)

    # Parse path and derive
    for index_str in path.split("/"):
        if index_str.endswith("'") or index_str.endswith("h"):
            raise ValueError("Cannot derive hardened path from xpub")
        # Use derive with a list containing single index
        hd = hd.derive([int(index_str)])

    return hd.key.sec().hex()


def validate_public_key(pubkey: str) -> bool:
    """
    Validate that a string is a valid public key.

    Args:
        pubkey: Hex-encoded public key to validate.

    Returns:
        True if valid, False otherwise.
    """
    try:
        parse_public_key(pubkey)
        return True
    except (ValueError, Exception):
        return False


def parse_witness_script(script: bytes) -> tuple[int, list[str]]:
    """Parse a P2WSH multisig witnessScript to extract threshold and public keys.

    Parses the standard format:
        OP_M <pubkey1> <pubkey2> ... <pubkeyN> OP_N OP_CHECKMULTISIG

    Args:
        script: Raw witnessScript bytes.

    Returns:
        Tuple of (threshold M, list of compressed pubkey hex strings).

    Raises:
        ValueError: If script is not a valid multisig witnessScript.
    """
    if len(script) < 4:
        raise ValueError("witnessScript too short to be a valid multisig script")

    # Last byte must be OP_CHECKMULTISIG (0xae)
    if script[-1] != 0xAE:
        raise ValueError("witnessScript does not end with OP_CHECKMULTISIG")

    # First byte: OP_M (0x51 = OP_1 through 0x60 = OP_16)
    op_m = script[0]
    if not (0x51 <= op_m <= 0x60):
        raise ValueError(f"Invalid OP_M byte: 0x{op_m:02x} (expected 0x51-0x60)")
    threshold = op_m - 0x50

    # Parse pubkeys
    pubkeys: list[str] = []
    pos = 1
    while pos < len(script) - 2:  # Stop before OP_N OP_CHECKMULTISIG
        pk_len = script[pos]
        if pk_len == 0x21:  # 33-byte compressed pubkey
            if pos + 1 + pk_len > len(script) - 2:
                raise ValueError(f"Truncated pubkey at position {pos}")
            pk = script[pos + 1 : pos + 1 + pk_len]
            pubkeys.append(pk.hex())
            pos += 1 + pk_len
        else:
            break  # Hit OP_N

    if len(pubkeys) < 2:
        raise ValueError(f"Expected at least 2 pubkeys, found {len(pubkeys)}")

    # Verify OP_N
    op_n = script[pos]
    expected_n = len(pubkeys) + 0x50
    if op_n != expected_n:
        raise ValueError(
            f"OP_N mismatch: expected 0x{expected_n:02x} for {len(pubkeys)} keys, "
            f"got 0x{op_n:02x}"
        )

    if threshold > len(pubkeys):
        raise ValueError(
            f"Threshold {threshold} exceeds number of pubkeys {len(pubkeys)}"
        )

    return threshold, pubkeys
