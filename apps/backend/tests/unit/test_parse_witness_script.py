"""Tests for parse_witness_script utility."""

import pytest

from multivault.chains.bitcoin.address import (
    build_multisig_script,
    parse_witness_script,
)

# Test pubkeys (compressed, 33 bytes each)
PK1 = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"
PK2 = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
PK3 = "03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556"

# Pre-sorted order (lexicographic by bytes, per BIP-67)
SORTED_PKS = sorted([PK1, PK2, PK3], key=lambda pk: bytes.fromhex(pk))


class TestParseWitnessScript:
    """Tests for parsing multisig witness scripts."""

    def test_parse_2_of_3(self):
        """Parse a 2-of-3 multisig witnessScript."""
        script = build_multisig_script(2, [PK1, PK2, PK3])
        threshold, pubkeys = parse_witness_script(script)
        assert threshold == 2
        assert len(pubkeys) == 3
        assert pubkeys == SORTED_PKS

    def test_parse_1_of_2(self):
        """Parse a 1-of-2 multisig witnessScript."""
        script = build_multisig_script(1, [PK1, PK2])
        threshold, pubkeys = parse_witness_script(script)
        assert threshold == 1
        assert len(pubkeys) == 2

    def test_parse_3_of_3(self):
        """Parse a 3-of-3 multisig witnessScript."""
        script = build_multisig_script(3, [PK1, PK2, PK3])
        threshold, pubkeys = parse_witness_script(script)
        assert threshold == 3
        assert len(pubkeys) == 3

    def test_roundtrip(self):
        """build_multisig_script -> parse_witness_script roundtrip."""
        script = build_multisig_script(2, [PK1, PK2, PK3])
        threshold, parsed_pks = parse_witness_script(script)
        script2 = build_multisig_script(threshold, parsed_pks)
        assert script == script2

    def test_invalid_empty_script(self):
        """Empty script raises ValueError."""
        with pytest.raises(ValueError, match="too short"):
            parse_witness_script(b"")

    def test_invalid_no_checkmultisig(self):
        """Script without OP_CHECKMULTISIG raises ValueError."""
        with pytest.raises(ValueError):
            parse_witness_script(b"\x52\x21" + b"\x02" * 33 + b"\x51\x00")

    def test_invalid_op_m_out_of_range(self):
        """OP_M below 0x51 raises ValueError."""
        with pytest.raises(ValueError, match="OP_M"):
            parse_witness_script(b"\x50\x21" + b"\x02" * 33 + b"\x51\xae")
