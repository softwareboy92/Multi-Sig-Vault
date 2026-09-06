"""Cryptographic utilities for signature verification."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from eth_account.messages import encode_defunct
from web3 import Web3

from multivault.config import get_settings


def generate_challenge(identifier: str) -> tuple[str, datetime]:
    """Generate a challenge message for signature verification.

    Args:
        identifier: Address or public key to include in challenge

    Returns:
        Tuple of (challenge_message, expiry_datetime)
    """
    settings = get_settings()
    nonce = secrets.token_hex(16)
    timestamp = datetime.now(UTC).isoformat()

    challenge = (
        f"MultiVault Verification\n"
        f"Identifier: {identifier}\n"
        f"Nonce: {nonce}\n"
        f"Timestamp: {timestamp}\n"
        f"Please sign this message to verify ownership."
    )

    expires_at = datetime.now(UTC) + timedelta(seconds=settings.challenge_expiry_seconds)

    return challenge, expires_at


def verify_evm_signature(
    message: str,
    signature: str,
    expected_address: str,
) -> bool:
    """Verify an EVM personal_sign signature.

    Args:
        message: The original message that was signed
        signature: The signature in hex format (with or without 0x prefix)
        expected_address: The expected signer address

    Returns:
        True if signature is valid and from expected address
    """
    try:
        # Ensure signature has 0x prefix
        if not signature.startswith("0x"):
            signature = "0x" + signature

        # Encode message as per EIP-191
        message_hash = encode_defunct(text=message)

        # Recover address from signature
        w3 = Web3()
        recovered_address = w3.eth.account.recover_message(
            message_hash,
            signature=signature,
        )

        # Compare addresses (case-insensitive)
        return recovered_address.lower() == expected_address.lower()

    except Exception:
        return False


def verify_btc_signature(
    message: str,
    signature: str,
    public_key: str,
) -> bool:
    """Verify a Bitcoin message signature.

    Uses the standard Bitcoin message signing format with recoverable signatures.

    Args:
        message: The original message that was signed
        signature: The signature in hex or base64 format (65 bytes: recid+27 || r || s)
        public_key: The expected signer's public key in hex (compressed or uncompressed)

    Returns:
        True if signature is valid and from expected public key
    """
    try:
        import base64

        import coincurve

        # Parse expected public key
        pubkey_bytes = bytes.fromhex(public_key)
        expected_pubkey = coincurve.PublicKey(pubkey_bytes)

        # Bitcoin message signing uses double SHA256 with prefix
        prefix = b"\x18Bitcoin Signed Message:\n"
        message_bytes = message.encode("utf-8")
        msg_len = len(message_bytes)

        # Variable length encoding for message length
        if msg_len < 253:
            len_bytes = bytes([msg_len])
        elif msg_len < 0x10000:
            len_bytes = b"\xfd" + msg_len.to_bytes(2, "little")
        else:
            len_bytes = b"\xfe" + msg_len.to_bytes(4, "little")

        full_message = prefix + len_bytes + message_bytes
        message_hash = hashlib.sha256(hashlib.sha256(full_message).digest()).digest()

        # Try to parse signature
        try:
            # Try hex format first
            sig_bytes = bytes.fromhex(signature.replace("0x", ""))
        except ValueError:
            # Try base64 format
            sig_bytes = base64.b64decode(signature)

        # Handle recoverable signature format (65 bytes: recovery_byte + r + s)
        # Bitcoin format: [recid+27 (+4 if compressed)] [r:32] [s:32]
        # coincurve format: [r:32] [s:32] [recid:1] where recid is 0-3
        if len(sig_bytes) == 65:
            recovery_byte = sig_bytes[0]
            r_s = sig_bytes[1:]  # 64 bytes: r || s

            # Calculate recovery id (0-3)
            recovery_id = (recovery_byte - 27) & 3

            # Reformat for coincurve: r || s || recovery_id
            sig_coincurve = r_s + bytes([recovery_id])

            # Recover public key from signature and message
            recovered_pubkey = coincurve.PublicKey.from_signature_and_message(
                sig_coincurve, message_hash, hasher=None
            )

            # Compare recovered public key with expected
            return recovered_pubkey.format() == expected_pubkey.format()

        # Handle compact signature (64 bytes: r + s) - cannot recover, need direct verify
        elif len(sig_bytes) == 64:
            # For non-recoverable signatures, use direct verification
            return expected_pubkey.verify(sig_bytes, message_hash, hasher=None)

        return False

    except Exception:
        return False


def hash_message(message: str) -> bytes:
    """Hash a message using SHA256.

    Args:
        message: Message to hash

    Returns:
        32-byte hash
    """
    return hashlib.sha256(message.encode("utf-8")).digest()


def rsa_sign_for_keyvault(data: str) -> str:
    """Sign data with RSA-SHA256 for KeyVault QR verification.

    Args:
        data: The string to sign (typically JSON-encoded business_data).

    Returns:
        Base64-encoded RSA-SHA256 signature, or empty string when unconfigured.
    """
    import base64
    from pathlib import Path

    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    settings = get_settings()
    key_path = settings.keyvault_rsa_private_key_path
    if not key_path:
        return ""  # 未配置私钥路径时不执行签名

    pem_path = Path(key_path)
    if not pem_path.exists():
        return ""  # 私钥文件不存在时不执行签名

    raw = pem_path.read_bytes()
    raw = raw.strip()

    # If content doesn't look like PEM (no -----BEGIN), assume base64-encoded PEM
    if not raw.startswith(b"-----"):
        try:
            raw = base64.b64decode(raw, validate=True)
        except Exception as e:
            raise RuntimeError(
                f"RSA key file does not appear to be PEM or valid base64: {e}"
            ) from e

    private_key = serialization.load_pem_private_key(raw, password=None)
    signature = private_key.sign(  # type: ignore[union-attr]
        data.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("ascii")


def compress_public_key(public_key_hex: str) -> str:
    """Compress an uncompressed public key.

    Args:
        public_key_hex: 65-byte uncompressed public key in hex (130 chars)

    Returns:
        33-byte compressed public key in hex (66 chars)
    """
    if len(public_key_hex) == 66:
        # Already compressed
        return public_key_hex.lower()

    if len(public_key_hex) != 130:
        raise ValueError(f"Invalid public key length: {len(public_key_hex)}")

    # Remove 04 prefix if present
    if public_key_hex.startswith("04"):
        public_key_hex = public_key_hex[2:]

    x = int(public_key_hex[:64], 16)
    y = int(public_key_hex[64:], 16)

    # Prefix: 02 for even y, 03 for odd y
    prefix = "02" if y % 2 == 0 else "03"

    return prefix + public_key_hex[:64].lower()
