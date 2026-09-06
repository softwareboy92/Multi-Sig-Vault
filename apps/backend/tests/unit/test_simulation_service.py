"""Tests for SimulationService."""

import json
from unittest.mock import MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.errors.exceptions import ValidationError
from multivault.models.base import generate_uuid
from multivault.models.simulation import SimulationStatus
from multivault.services.simulation_service import SimulationService


# ---------------------------------------------------------------------------
# Helpers for _build_simulation_signatures tests
# ---------------------------------------------------------------------------


def _make_wallet_signer(signer_id: str, address: str) -> MagicMock:
    ws = MagicMock()
    ws.signer = MagicMock()
    ws.signer.id = signer_id
    ws.signer.address = address
    return ws


def _make_wallet(signers: list[tuple[str, str]], threshold: int) -> MagicMock:
    """signers: list of (signer_id, address)"""
    wallet = MagicMock()
    wallet.wallet_signers = [_make_wallet_signer(sid, addr) for sid, addr in signers]
    wallet.signers = [ws.signer for ws in wallet.wallet_signers]
    wallet.threshold = threshold
    return wallet


def _make_sig(signer_id: str, sig_hex: str) -> MagicMock:
    sig = MagicMock()
    sig.signer_id = signer_id
    sig.signature_data = sig_hex
    return sig


def _make_tx(signatures: list) -> MagicMock:
    tx = MagicMock()
    tx.signatures = signatures
    return tx


class TestExtractSafeTxParams:
    """Test _extract_safe_tx_params without DB."""

    def setup_method(self):
        self.service = SimulationService.__new__(SimulationService)

    def test_valid_eip712_payload(self):
        tx = MagicMock()
        tx.payload = json.dumps({
            "types": {},
            "domain": {},
            "primaryType": "SafeTx",
            "message": {
                "to": "0xRecipient",
                "value": "1000000000000000000",
                "data": "0x",
                "operation": 0,
                "safeTxGas": 0,
                "baseGas": 0,
                "gasPrice": 0,
                "gasToken": "0x" + "0" * 40,
                "refundReceiver": "0x" + "0" * 40,
                "nonce": 5,
            },
        })
        params = self.service._extract_safe_tx_params(tx)
        assert params["to"] == "0xRecipient"
        assert params["value"] == "1000000000000000000"
        assert params["nonce"] == 5

    def test_missing_payload(self):
        tx = MagicMock()
        tx.payload = None
        with pytest.raises(ValidationError, match="no payload"):
            self.service._extract_safe_tx_params(tx)

    def test_invalid_json(self):
        tx = MagicMock()
        tx.payload = "not json"
        with pytest.raises(ValidationError, match="Invalid"):
            self.service._extract_safe_tx_params(tx)

    def test_missing_message_field(self):
        tx = MagicMock()
        tx.payload = json.dumps({"types": {}, "domain": {}})
        with pytest.raises(ValidationError, match="message"):
            self.service._extract_safe_tx_params(tx)


@pytest.mark.asyncio
async def test_upsert_creates_new(async_session: AsyncSession):
    """_upsert_simulation creates a new record when none exists."""
    service = SimulationService(async_session)
    tx_id = generate_uuid()

    sim = await service._upsert_simulation(tx_id, {
        "status": SimulationStatus.SUCCESS,
        "result": json.dumps({"gas_estimate": 50000}),
        "gas_used": 50000,
    })

    assert sim.transaction_id == tx_id
    assert sim.status == SimulationStatus.SUCCESS


@pytest.mark.asyncio
async def test_upsert_updates_existing(async_session: AsyncSession):
    """_upsert_simulation updates existing record."""
    service = SimulationService(async_session)
    tx_id = generate_uuid()

    # Create first
    await service._upsert_simulation(tx_id, {
        "status": SimulationStatus.SUCCESS,
        "result": json.dumps({}),
        "gas_used": 50000,
    })

    # Update
    sim = await service._upsert_simulation(tx_id, {
        "status": SimulationStatus.FAILURE,
        "result": json.dumps({"revert_reason": "out of gas"}),
        "error_message": "out of gas",
        "gas_used": 30000,
    })

    assert sim.status == SimulationStatus.FAILURE
    assert sim.error_message == "out of gas"

    # Verify only one record
    fetched = await service.get_simulation(tx_id)
    assert fetched is not None
    assert fetched.status == SimulationStatus.FAILURE


# ---------------------------------------------------------------------------
# _build_simulation_signatures
# ---------------------------------------------------------------------------

# Use deterministic 65-byte dummy ECDSA signatures (v=27)
DUMMY_SIG_A = "aa" * 64 + "1b"  # 65 bytes hex
DUMMY_SIG_B = "bb" * 64 + "1b"
DUMMY_SIG_C = "cc" * 64 + "1b"

# Addresses chosen so sort order is: ADDR_LOW < ADDR_MID < ADDR_HIGH
ADDR_LOW = "0x1111111111111111111111111111111111111111"
ADDR_MID = "0x5555555555555555555555555555555555555555"
ADDR_HIGH = "0x9999999999999999999999999999999999999999"


class TestBuildSimulationSignatures:
    """Test signature assembly for execTransaction simulation."""

    def test_full_signatures_no_pre_validated(self):
        """With all 3/3 sigs collected, no preValidated should be added."""
        wallet = _make_wallet(
            [("s1", ADDR_HIGH), ("s2", ADDR_LOW), ("s3", ADDR_MID)],
            threshold=3,
        )
        tx = _make_tx([
            _make_sig("s1", DUMMY_SIG_A),
            _make_sig("s2", DUMMY_SIG_B),
            _make_sig("s3", DUMMY_SIG_C),
        ])

        all_sigs, execution_owner, override = SimulationService._build_simulation_signatures(wallet, tx)

        # Exactly 3 sigs × 65 bytes — no extra preValidated
        assert len(all_sigs) == 3 * 65
        assert override is False

    def test_full_signatures_sorted_by_address(self):
        """Signatures must be sorted by signer address ascending."""
        wallet = _make_wallet(
            [("s1", ADDR_HIGH), ("s2", ADDR_LOW), ("s3", ADDR_MID)],
            threshold=3,
        )
        tx = _make_tx([
            _make_sig("s1", DUMMY_SIG_A),  # ADDR_HIGH
            _make_sig("s2", DUMMY_SIG_B),  # ADDR_LOW
            _make_sig("s3", DUMMY_SIG_C),  # ADDR_MID
        ])

        all_sigs, _, _ = SimulationService._build_simulation_signatures(wallet, tx)

        # Expected order: ADDR_LOW(sig_B), ADDR_MID(sig_C), ADDR_HIGH(sig_A)
        sig_b = bytes.fromhex(DUMMY_SIG_B)
        sig_c = bytes.fromhex(DUMMY_SIG_C)
        sig_a = bytes.fromhex(DUMMY_SIG_A)
        assert all_sigs == sig_b + sig_c + sig_a

    def test_partial_sigs_adds_pre_validated(self):
        """With 1/3 sigs, preValidated is added for an unsigned owner."""
        wallet = _make_wallet(
            [("s1", ADDR_HIGH), ("s2", ADDR_LOW), ("s3", ADDR_MID)],
            threshold=3,
        )
        tx = _make_tx([
            _make_sig("s1", DUMMY_SIG_A),  # ADDR_HIGH signed
        ])

        all_sigs, execution_owner, override = SimulationService._build_simulation_signatures(wallet, tx)

        # 1 ECDSA + 1 preValidated = 2 sigs
        assert len(all_sigs) == 2 * 65
        assert override is True
        # preValidated owner must not be s1 (already signed)
        assert execution_owner.lower() != ADDR_HIGH.lower()

    def test_partial_sigs_pre_validated_avoids_duplicate(self):
        """preValidated must pick a signer who hasn't already signed."""
        wallet = _make_wallet(
            [("s1", ADDR_LOW), ("s2", ADDR_MID), ("s3", ADDR_HIGH)],
            threshold=3,
        )
        # s1 already signed
        tx = _make_tx([_make_sig("s1", DUMMY_SIG_A)])

        _, execution_owner, _ = SimulationService._build_simulation_signatures(wallet, tx)

        # execution_owner should be s2 or s3, NOT s1
        assert execution_owner.lower() in (ADDR_MID.lower(), ADDR_HIGH.lower())

    def test_no_signatures_uses_pre_validated(self):
        """With 0 sigs, preValidated is added and threshold override requested."""
        wallet = _make_wallet(
            [("s1", ADDR_LOW), ("s2", ADDR_HIGH)],
            threshold=2,
        )
        tx = _make_tx([])

        all_sigs, execution_owner, override = SimulationService._build_simulation_signatures(wallet, tx)

        assert len(all_sigs) == 65
        assert override is True
        assert execution_owner.lower() in (ADDR_LOW.lower(), ADDR_HIGH.lower())

    def test_pre_validated_sorted_with_ecdsa(self):
        """preValidated + ECDSA must still be sorted by address."""
        wallet = _make_wallet(
            [("s1", ADDR_HIGH), ("s2", ADDR_LOW)],
            threshold=2,
        )
        # Only s1 (ADDR_HIGH) signed; preValidated should be s2 (ADDR_LOW)
        tx = _make_tx([_make_sig("s1", DUMMY_SIG_A)])

        all_sigs, execution_owner, _ = SimulationService._build_simulation_signatures(wallet, tx)

        assert execution_owner.lower() == ADDR_LOW.lower()
        # ADDR_LOW preValidated should come BEFORE ADDR_HIGH ECDSA
        pre_validated_addr_bytes = all_sigs[12:32]
        assert pre_validated_addr_bytes == bytes.fromhex(ADDR_LOW[2:].lower())
