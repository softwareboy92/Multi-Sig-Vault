"""Tests for WalletImport schema validation."""

import pytest
from pydantic import ValidationError

from multivault.schemas.wallet import WalletImport


class TestWalletImportEVM:
    """EVM-specific validation."""

    def test_valid_evm_import(self):
        data = WalletImport(
            name="My Safe",
            chain_type="EVM",
            network_id="net-1",
            safe_address="0x1234567890abcdef1234567890abcdef12345678",
        )
        assert data.chain_type == "EVM"
        assert data.safe_address is not None

    def test_evm_missing_safe_address(self):
        with pytest.raises(ValidationError, match="safe_address"):
            WalletImport(
                name="My Safe",
                chain_type="EVM",
                network_id="net-1",
            )

    def test_evm_with_btc_fields_rejected(self):
        with pytest.raises(ValidationError, match="BTC"):
            WalletImport(
                name="My Safe",
                chain_type="EVM",
                network_id="net-1",
                safe_address="0x1234567890abcdef1234567890abcdef12345678",
                public_keys=["02abc123"],
            )


class TestWalletImportBTCModeA:
    """BTC Mode A (manual) validation."""

    def test_valid_btc_manual(self):
        data = WalletImport(
            name="My BTC",
            chain_type="BTC",
            network_id="net-2",
            address="bc1qexample",
            threshold=2,
            public_keys=[
                "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
                "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
                "03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556",
            ],
        )
        assert data.threshold == 2
        assert len(data.public_keys) == 3

    def test_btc_missing_address(self):
        with pytest.raises(ValidationError, match="address"):
            WalletImport(
                name="My BTC",
                chain_type="BTC",
                network_id="net-2",
                threshold=2,
                public_keys=["02abc", "03def"],
            )

    def test_btc_threshold_exceeds_keys(self):
        with pytest.raises(ValidationError, match="threshold"):
            WalletImport(
                name="My BTC",
                chain_type="BTC",
                network_id="net-2",
                address="bc1qexample",
                threshold=3,
                public_keys=["02abc", "03def"],
            )

    def test_btc_single_key_rejected(self):
        with pytest.raises(ValidationError, match="at least 2"):
            WalletImport(
                name="My BTC",
                chain_type="BTC",
                network_id="net-2",
                address="bc1qexample",
                threshold=1,
                public_keys=["02abc"],
            )


class TestWalletImportBTCModeB:
    """BTC Mode B (auto-extract) validation."""

    def test_valid_btc_auto_no_txid(self):
        data = WalletImport(
            name="My BTC",
            chain_type="BTC",
            network_id="net-2",
            address="bc1qexample",
        )
        assert data.public_keys is None
        assert data.threshold is None
        assert data.tx_id is None

    def test_valid_btc_auto_with_txid(self):
        data = WalletImport(
            name="My BTC",
            chain_type="BTC",
            network_id="net-2",
            address="bc1qexample",
            tx_id="a1b2c3d4e5f6" * 6 + "a1b2c3d4",
        )
        assert data.tx_id is not None

    def test_btc_mixed_modes_rejected(self):
        """Providing both public_keys AND tx_id is invalid."""
        with pytest.raises(ValidationError, match="Cannot provide both"):
            WalletImport(
                name="My BTC",
                chain_type="BTC",
                network_id="net-2",
                address="bc1qexample",
                threshold=2,
                public_keys=["02abc", "03def"],
                tx_id="a1b2c3d4e5f6" * 6 + "a1b2c3d4",
            )

    def test_btc_partial_manual_rejected(self):
        """Providing threshold without public_keys is invalid."""
        with pytest.raises(ValidationError):
            WalletImport(
                name="My BTC",
                chain_type="BTC",
                network_id="net-2",
                address="bc1qexample",
                threshold=2,
            )
