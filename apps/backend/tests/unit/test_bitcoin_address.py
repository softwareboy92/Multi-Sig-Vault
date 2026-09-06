"""
Unit tests for Bitcoin address derivation.

Tests BIP-67 compliant P2WSH multisig address generation.
"""

import pytest

from multivault.chains.bitcoin.address import (
    BitcoinNetwork,
    build_multisig_script,
    derive_p2wsh_address,
    parse_public_key,
    pubkey_from_xpub,
    sort_public_keys,
    validate_public_key,
)


# Test public keys (compressed format, 33 bytes)
TEST_PUBKEYS = [
    "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    "03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556",
]

# Known test vectors
# 2-of-3 multisig with above keys should produce deterministic address
# Keys are sorted per BIP-67 before script creation


class TestParsePublicKey:
    """Tests for public key parsing."""

    def test_parse_compressed_02(self):
        """Parse compressed key with 02 prefix."""
        pk = TEST_PUBKEYS[0]
        result = parse_public_key(pk)
        assert len(result) == 33
        assert result[0] == 0x02

    def test_parse_compressed_03(self):
        """Parse compressed key with 03 prefix."""
        pk = TEST_PUBKEYS[2]
        result = parse_public_key(pk)
        assert len(result) == 33
        assert result[0] == 0x03

    def test_parse_uncompressed(self):
        """Parse uncompressed key and convert to compressed."""
        # Uncompressed version of TEST_PUBKEYS[1] (secp256k1 generator point G)
        uncompressed = (
            "04"
            "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
            "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8"
        )
        result = parse_public_key(uncompressed)
        assert len(result) == 33
        # Y coordinate ends in 8 (even), so prefix should be 02
        assert result[0] == 0x02

    def test_parse_invalid_length(self):
        """Reject keys with invalid length."""
        with pytest.raises(ValueError, match="Invalid public key length"):
            parse_public_key("02c6047f9441ed7d")  # Too short

    def test_parse_invalid_hex(self):
        """Reject invalid hex."""
        with pytest.raises(ValueError, match="Invalid hex"):
            parse_public_key("not_valid_hex")

    def test_parse_invalid_prefix(self):
        """Reject keys with invalid prefix."""
        # Change 02 to 05 (invalid)
        invalid = "05" + TEST_PUBKEYS[0][2:]
        with pytest.raises(ValueError, match="Invalid compressed public key prefix"):
            parse_public_key(invalid)


class TestSortPublicKeys:
    """Tests for BIP-67 public key sorting."""

    def test_sort_already_sorted(self):
        """Keys already in lexicographic order."""
        keys = [TEST_PUBKEYS[1], TEST_PUBKEYS[0], TEST_PUBKEYS[2]]
        result = sort_public_keys(keys)
        # Should be sorted by bytes
        sorted_hex = [r.hex() for r in result]
        assert sorted_hex == sorted(sorted_hex)

    def test_sort_reverse_order(self):
        """Keys in reverse order."""
        keys = list(reversed(TEST_PUBKEYS))
        result = sort_public_keys(keys)
        sorted_hex = [r.hex() for r in result]
        assert sorted_hex == sorted(sorted_hex)

    def test_sort_deterministic(self):
        """Same keys in different order produce same result."""
        order1 = sort_public_keys(TEST_PUBKEYS)
        order2 = sort_public_keys(list(reversed(TEST_PUBKEYS)))
        assert order1 == order2


class TestBuildMultisigScript:
    """Tests for multisig script construction."""

    def test_build_2_of_3(self):
        """Build 2-of-3 multisig script."""
        script = build_multisig_script(2, TEST_PUBKEYS)

        # Script should start with OP_2 (0x52)
        assert script[0] == 0x52

        # Script should end with OP_3 OP_CHECKMULTISIG (0x53 0xAE)
        assert script[-2] == 0x53
        assert script[-1] == 0xAE

        # Should contain all three pubkeys (33 bytes each)
        assert len(script) > 100

    def test_build_1_of_2(self):
        """Build 1-of-2 multisig script."""
        keys = TEST_PUBKEYS[:2]
        script = build_multisig_script(1, keys)

        # OP_1 = 0x51, OP_2 = 0x52
        assert script[0] == 0x51
        assert script[-2] == 0x52
        assert script[-1] == 0xAE

    def test_build_3_of_3(self):
        """Build 3-of-3 multisig script."""
        script = build_multisig_script(3, TEST_PUBKEYS)

        # OP_3 = 0x53
        assert script[0] == 0x53
        assert script[-2] == 0x53

    def test_threshold_exceeds_keys(self):
        """Reject threshold greater than number of keys."""
        with pytest.raises(ValueError, match="exceeds key count"):
            build_multisig_script(4, TEST_PUBKEYS)

    def test_threshold_zero(self):
        """Reject zero threshold."""
        with pytest.raises(ValueError, match="at least 1"):
            build_multisig_script(0, TEST_PUBKEYS)

    def test_too_many_keys(self):
        """Reject more than 15 keys."""
        # Create 16 fake pubkeys
        many_keys = [TEST_PUBKEYS[0]] * 16
        with pytest.raises(ValueError, match="Too many public keys"):
            build_multisig_script(2, many_keys)


class TestDeriveP2WSHAddress:
    """Tests for P2WSH address derivation."""

    def test_derive_mainnet_address(self):
        """Derive mainnet P2WSH address."""
        address, script = derive_p2wsh_address(
            threshold=2,
            public_keys=TEST_PUBKEYS,
            network=BitcoinNetwork.MAINNET,
        )

        # Mainnet P2WSH starts with "bc1q"
        assert address.startswith("bc1q")
        # P2WSH address is 62 characters (bc1q + 58 chars)
        assert len(address) == 62

    def test_derive_testnet_address(self):
        """Derive testnet P2WSH address."""
        address, script = derive_p2wsh_address(
            threshold=2,
            public_keys=TEST_PUBKEYS,
            network=BitcoinNetwork.TESTNET,
        )

        # Testnet P2WSH starts with "tb1q"
        assert address.startswith("tb1q")

    def test_derive_deterministic(self):
        """Same inputs produce same address regardless of key order."""
        addr1, _ = derive_p2wsh_address(2, TEST_PUBKEYS)
        addr2, _ = derive_p2wsh_address(2, list(reversed(TEST_PUBKEYS)))

        assert addr1 == addr2

    def test_different_threshold_different_address(self):
        """Different threshold produces different address."""
        addr_2of3, _ = derive_p2wsh_address(2, TEST_PUBKEYS)
        addr_3of3, _ = derive_p2wsh_address(3, TEST_PUBKEYS)

        assert addr_2of3 != addr_3of3


class TestValidatePublicKey:
    """Tests for public key validation."""

    def test_valid_compressed(self):
        """Accept valid compressed keys."""
        for pk in TEST_PUBKEYS:
            assert validate_public_key(pk) is True

    def test_invalid_hex(self):
        """Reject invalid hex."""
        assert validate_public_key("not_hex") is False

    def test_invalid_length(self):
        """Reject wrong length."""
        assert validate_public_key("02c6047f") is False

    def test_empty_string(self):
        """Reject empty string."""
        assert validate_public_key("") is False


class TestPubkeyFromXpub:
    """Tests for extended public key derivation."""

    # Known xpub test vector
    TEST_XPUB = (
        "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8"
    )

    def test_derive_default_path(self):
        """Derive pubkey at default path 0/0."""
        pubkey = pubkey_from_xpub(self.TEST_XPUB, "0/0")
        assert len(pubkey) == 66  # 33 bytes = 66 hex chars
        assert pubkey.startswith("02") or pubkey.startswith("03")

    def test_derive_different_paths(self):
        """Different paths produce different pubkeys."""
        pk1 = pubkey_from_xpub(self.TEST_XPUB, "0/0")
        pk2 = pubkey_from_xpub(self.TEST_XPUB, "0/1")
        pk3 = pubkey_from_xpub(self.TEST_XPUB, "1/0")

        assert pk1 != pk2
        assert pk1 != pk3
        assert pk2 != pk3

    def test_hardened_path_fails(self):
        """Cannot derive hardened path from xpub."""
        with pytest.raises(ValueError, match="hardened"):
            pubkey_from_xpub(self.TEST_XPUB, "0'/0")
