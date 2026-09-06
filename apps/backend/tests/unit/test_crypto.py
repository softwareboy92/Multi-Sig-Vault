"""Tests for crypto utilities."""

import pytest

from multivault.utils.crypto import (
    compress_public_key,
    generate_challenge,
    hash_message,
    verify_evm_signature,
)


class TestGenerateChallenge:
    """Tests for challenge generation."""

    def test_generates_challenge_with_identifier(self):
        """Test challenge includes identifier."""
        identifier = "0x742d35cc6634c0532925a3b844bc9e7595f1e3c7"
        challenge, expires_at = generate_challenge(identifier)

        assert identifier in challenge
        assert "MultiVault" in challenge
        assert "Nonce:" in challenge
        assert expires_at is not None

    def test_generates_unique_challenges(self):
        """Test each challenge is unique (different nonces)."""
        identifier = "0x742d35cc6634c0532925a3b844bc9e7595f1e3c7"
        challenge1, _ = generate_challenge(identifier)
        challenge2, _ = generate_challenge(identifier)

        # Challenges should be different due to different nonces
        assert challenge1 != challenge2


class TestHashMessage:
    """Tests for message hashing."""

    def test_hash_produces_32_bytes(self):
        """Test hash output is 32 bytes."""
        result = hash_message("test message")
        assert len(result) == 32

    def test_hash_is_deterministic(self):
        """Test same input produces same hash."""
        message = "test message"
        hash1 = hash_message(message)
        hash2 = hash_message(message)
        assert hash1 == hash2

    def test_different_messages_different_hashes(self):
        """Test different inputs produce different hashes."""
        hash1 = hash_message("message 1")
        hash2 = hash_message("message 2")
        assert hash1 != hash2


class TestCompressPublicKey:
    """Tests for public key compression."""

    def test_already_compressed(self):
        """Test already compressed key is returned as-is."""
        compressed = "02" + "a" * 64
        result = compress_public_key(compressed)
        assert result == compressed.lower()

    def test_compress_with_even_y(self):
        """Test compression with even y coordinate."""
        # This is a valid uncompressed key format
        # x = all 'a's, y = even number (ends with even digit)
        uncompressed = "04" + "a" * 64 + "a" * 62 + "02"  # y ends in 02 (even)
        result = compress_public_key(uncompressed)
        assert result.startswith("02")
        assert len(result) == 66

    def test_compress_with_odd_y(self):
        """Test compression with odd y coordinate."""
        uncompressed = "04" + "a" * 64 + "a" * 62 + "03"  # y ends in 03 (odd)
        result = compress_public_key(uncompressed)
        assert result.startswith("03")
        assert len(result) == 66

    def test_invalid_length_raises(self):
        """Test invalid length raises error."""
        with pytest.raises(ValueError):
            compress_public_key("invalid")


class TestVerifyEvmSignature:
    """Tests for EVM signature verification."""

    def test_valid_signature_does_not_crash(self):
        """Test that verify_evm_signature handles arbitrary input without crashing.

        NOTE: This does NOT test correctness — a real test would use a
        pre-computed (message, signature, address) triple from eth_account.
        This only validates the function is resilient to malformed input.
        """
        message = "Hello, World!"
        signature = (
            "0x"
            "9a0c31857e6c55d04f4fca11a7bb1e3a0c4c2b0b6f8e8a8d8c8b8a898887868584838281807f7e7d7c7b7a"
            "797877767574737271706f6e6d6c6b6a696867666564636261605f5e5d5c5b5a59585756"
            "1c"
        )
        address = "0xfcad0b19bb29d4674531d6f115237e16afce377c"

        result = verify_evm_signature(message, signature, address)
        assert isinstance(result, bool)

    def test_invalid_signature_format(self):
        """Test invalid signature format returns False."""
        result = verify_evm_signature(
            message="test",
            signature="invalid",
            expected_address="0x742d35cc6634c0532925a3b844bc9e7595f1e3c7",
        )
        assert result is False

    def test_wrong_address_returns_false(self):
        """Test wrong address returns False."""
        # Even if signature format is valid, wrong address should fail
        result = verify_evm_signature(
            message="test",
            signature="0x" + "a" * 130,
            expected_address="0x742d35cc6634c0532925a3b844bc9e7595f1e3c7",
        )
        assert result is False
