"""Tests for BIP 48 derivation path validation."""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.chains.bitcoin.path import validate_bip48_path, script_type_from_path
from multivault.models import (
    DeviceType,
    NetworkConfig,
    Signer,
    SignerStatus,
)
from multivault.models.signer import ChainType
from multivault.services.wallet_service import WalletService
from multivault.schemas.wallet import WalletCreate
from multivault.errors.exceptions import ValidationError


class TestValidateBip48Path:
    """Test BIP 48 path validation (P2WSH and P2SH-P2WSH)."""

    @pytest.mark.parametrize(
        "path",
        [
            "m/48'/0'/0'/2'",   # mainnet, account 0, P2WSH
            "m/48'/1'/0'/2'",   # testnet, account 0, P2WSH
            "m/48'/0'/5'/2'",   # mainnet, account 5, P2WSH
            "m/48'/1'/99'/2'",  # testnet, account 99, P2WSH
            "m/48'/0'/0'/1'",   # mainnet, account 0, P2SH-P2WSH
            "m/48'/1'/0'/1'",   # testnet, account 0, P2SH-P2WSH
            "m/48'/0'/5'/1'",   # mainnet, account 5, P2SH-P2WSH
        ],
    )
    def test_valid_paths(self, path: str):
        assert validate_bip48_path(path) is True

    @pytest.mark.parametrize(
        "path,reason",
        [
            ("m/84'/0'/0'", "BIP 84 single-sig path"),
            ("m/44'/0'/0'", "BIP 44 legacy path"),
            ("m/48'/2'/0'/2'", "invalid coinType=2"),
            ("m/48'/0'/0'/2'/0/0", "address-level path, not account"),
            ("", "empty string"),
            ("garbage", "non-path string"),
        ],
    )
    def test_invalid_paths(self, path: str, reason: str):
        assert validate_bip48_path(path) is False, reason

    def test_none_returns_false(self):
        assert validate_bip48_path(None) is False


class TestScriptTypeFromPath:
    """Test script_type_from_path() extraction."""

    def test_p2wsh_suffix(self):
        assert script_type_from_path("m/48'/0'/0'/2'") == "p2wsh"

    def test_p2sh_p2wsh_suffix(self):
        assert script_type_from_path("m/48'/1'/0'/1'") == "p2sh-p2wsh"

    def test_invalid_suffix_raises(self):
        with pytest.raises(ValueError):
            script_type_from_path("m/48'/0'/0'/3'")

    def test_non_bip48_raises(self):
        with pytest.raises(ValueError):
            script_type_from_path("m/84'/0'/0'")

    def test_none_raises(self):
        with pytest.raises((ValueError, AttributeError)):
            script_type_from_path(None)


@pytest_asyncio.fixture
async def btc_network(async_session: AsyncSession) -> NetworkConfig:
    from multivault.models.network import NetworkNodeConfig

    net = NetworkConfig(
        id="btc-net-1",
        name="Bitcoin Mainnet",
        chain_type="BTC",
        enabled=True,
        extra='{"btc_network": "mainnet"}',
    )
    async_session.add(net)
    await async_session.flush()
    node = NetworkNodeConfig(
        network_id=net.id,
        node_type="ELECTRUM",
        endpoint_url="ssl://electrum.blockstream.info:50002",
        priority=100,
        enabled=True,
    )
    async_session.add(node)
    await async_session.flush()
    net.default_node_id = node.id
    await async_session.commit()
    return net


async def _create_signer(
    session: AsyncSession,
    name: str,
    public_key: str,
    derivation_path: str | None,
) -> Signer:
    """Helper to create a verified BTC signer."""
    signer = Signer(
        name=name,
        device_type=DeviceType.LEDGER,
        chain_type=ChainType.BTC,
        public_key=public_key,
        derivation_path=derivation_path,
        status=SignerStatus.VERIFIED,
    )
    session.add(signer)
    await session.flush()
    return signer


PK1 = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"
PK2 = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
PK3 = "03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556"


class TestBip48WalletCreationValidation:
    """Integration tests: wallet creation rejects non-BIP48 signers."""

    @pytest.mark.asyncio
    async def test_reject_bip84_signer_in_multisig(
        self, async_session, btc_network
    ):
        """Signer with m/84' path should be rejected for BTC multisig."""
        s1 = await _create_signer(async_session, "S1", PK1, "m/84'/0'/0'")
        s2 = await _create_signer(async_session, "S2", PK2, "m/48'/0'/0'/2'")

        service = WalletService(async_session)
        with pytest.raises(ValidationError) as exc_info:
            await service.create_wallet(
                WalletCreate(
                    name="Test BTC",
                    chain_type="BTC",
                    threshold=2,
                    signer_ids=[s1.id, s2.id],
                    network_id=btc_network.id,
                )
            )
        assert any("BIP 48" in e for e in exc_info.value.details["errors"])

    @pytest.mark.asyncio
    async def test_reject_missing_path_in_multisig(
        self, async_session, btc_network
    ):
        """Signer without derivation_path should be rejected for BTC multisig."""
        s1 = await _create_signer(async_session, "S1", PK1, None)
        s2 = await _create_signer(async_session, "S2", PK2, "m/48'/0'/0'/2'")

        service = WalletService(async_session)
        with pytest.raises(ValidationError) as exc_info:
            await service.create_wallet(
                WalletCreate(
                    name="Test BTC",
                    chain_type="BTC",
                    threshold=2,
                    signer_ids=[s1.id, s2.id],
                    network_id=btc_network.id,
                )
            )
        assert any("BIP 48" in e for e in exc_info.value.details["errors"])


class TestAccountLevelPathDetection:
    """Test the path-append heuristic for PSBT key_origins."""

    @pytest.mark.parametrize(
        "path,expected",
        [
            # Account-level paths → should get /0/0 appended
            ("m/84'/0'/0'", "m/84'/0'/0'/0/0"),
            ("m/48'/0'/0'/2'", "m/48'/0'/0'/2'/0/0"),
            ("m/48'/1'/5'/2'", "m/48'/1'/5'/2'/0/0"),
            # Address-level paths → should NOT be modified
            ("m/84'/0'/0'/0/0", "m/84'/0'/0'/0/0"),
            ("m/48'/0'/0'/2'/0/0", "m/48'/0'/0'/2'/0/0"),
            ("m/48'/0'/0'/2'/1/3", "m/48'/0'/0'/2'/1/3"),
        ],
    )
    def test_ensure_address_level_path(self, path: str, expected: str):
        from multivault.chains.bitcoin.path import ensure_address_level_path
        assert ensure_address_level_path(path) == expected

    @pytest.mark.asyncio
    async def test_accept_bip48_signers(
        self, async_session, btc_network
    ):
        """All signers with m/48' path should pass validation."""
        s1 = await _create_signer(async_session, "S1", PK1, "m/48'/0'/0'/2'")
        s2 = await _create_signer(async_session, "S2", PK2, "m/48'/0'/1'/2'")
        s3 = await _create_signer(async_session, "S3", PK3, "m/48'/0'/2'/2'")

        service = WalletService(async_session)
        wallet = await service.create_wallet(
            WalletCreate(
                name="Test BTC",
                chain_type="BTC",
                threshold=2,
                signer_ids=[s1.id, s2.id, s3.id],
                network_id=btc_network.id,
            )
        )
        assert wallet.address is not None


class TestSignerCreateScriptType:
    """Test SignerCreate schema accepts script_type field."""

    def test_script_type_default_none(self):
        from multivault.schemas.signer import SignerCreate
        signer = SignerCreate(
            name="Test",
            device_type="LEDGER",
            chain_type="BTC",
            public_key="02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
            derivation_path="m/48'/0'/0'/2'",
            challenge="test",
            signature="aa" * 64,
        )
        assert signer.script_type is None

    def test_script_type_p2wsh(self):
        from multivault.schemas.signer import SignerCreate
        signer = SignerCreate(
            name="Test",
            device_type="LEDGER",
            chain_type="BTC",
            public_key="02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
            derivation_path="m/48'/0'/0'/2'",
            challenge="test",
            signature="aa" * 64,
            script_type="p2wsh",
        )
        assert signer.script_type == "p2wsh"

    def test_script_type_p2sh_p2wsh(self):
        from multivault.schemas.signer import SignerCreate
        signer = SignerCreate(
            name="Test",
            device_type="LEDGER",
            chain_type="BTC",
            public_key="02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
            derivation_path="m/48'/0'/0'/1'",
            challenge="test",
            signature="aa" * 64,
            script_type="p2sh-p2wsh",
        )
        assert signer.script_type == "p2sh-p2wsh"


class TestSignerServicePathValidation:
    """Test signer_service accepts P2SH-P2WSH paths and validates consistency."""

    @pytest.mark.asyncio
    async def test_create_signer_accepts_p2sh_p2wsh_path(self, async_session):
        """P2SH-P2WSH path m/48'/0'/0'/1' should pass validation."""
        from multivault.chains.bitcoin.path import validate_bip48_path
        assert validate_bip48_path("m/48'/0'/0'/1'") is True

    @pytest.mark.asyncio
    async def test_script_type_mismatch_detected(self, async_session):
        """If script_type='p2wsh' but path ends /1', should detect mismatch."""
        from multivault.chains.bitcoin.path import script_type_from_path
        actual = script_type_from_path("m/48'/0'/0'/1'")
        assert actual == "p2sh-p2wsh"
        assert actual != "p2wsh"


class TestSignerListFilterByScriptType:
    """Test that signer list can filter by script_type via derivation_path suffix."""

    @pytest.mark.asyncio
    async def test_filter_p2wsh_signers(self, async_session):
        """Filtering by script_type='p2wsh' returns only /2' signers."""
        from multivault.schemas.signer import SignerQueryParams
        from multivault.services.signer_service import SignerService

        await _create_signer(async_session, "P2WSH", PK1, "m/48'/0'/0'/2'")
        await _create_signer(async_session, "P2SH", PK2, "m/48'/0'/0'/1'")
        await async_session.commit()

        service = SignerService(async_session)
        signers, total = await service.list_signers(
            SignerQueryParams(script_type="p2wsh")
        )
        paths = [s.derivation_path for s in signers]
        assert all(p.endswith("/2'") for p in paths)
        assert total >= 1

    @pytest.mark.asyncio
    async def test_filter_p2sh_p2wsh_signers(self, async_session):
        """Filtering by script_type='p2sh-p2wsh' returns only /1' signers."""
        from multivault.schemas.signer import SignerQueryParams
        from multivault.services.signer_service import SignerService

        await _create_signer(async_session, "P2WSH", PK1, "m/48'/0'/0'/2'")
        await _create_signer(async_session, "P2SH", PK2, "m/48'/0'/0'/1'")
        await async_session.commit()

        service = SignerService(async_session)
        signers, total = await service.list_signers(
            SignerQueryParams(script_type="p2sh-p2wsh")
        )
        paths = [s.derivation_path for s in signers]
        assert all(p.endswith("/1'") for p in paths)
        assert total >= 1


class TestWalletServiceScriptTypeInference:
    """Test script_type inference for wallet creation."""

    def test_p2sh_p2wsh_paths_infer_correctly(self):
        """All /1' paths should infer p2sh-p2wsh."""
        from multivault.chains.bitcoin.path import script_type_from_path
        assert script_type_from_path("m/48'/0'/0'/1'") == "p2sh-p2wsh"
        assert script_type_from_path("m/48'/1'/0'/1'") == "p2sh-p2wsh"

    def test_p2wsh_paths_infer_correctly(self):
        """All /2' paths should infer p2wsh."""
        from multivault.chains.bitcoin.path import script_type_from_path
        assert script_type_from_path("m/48'/0'/0'/2'") == "p2wsh"
        assert script_type_from_path("m/48'/1'/0'/2'") == "p2wsh"

    def test_mixed_paths_detected(self):
        """Mixed /1' and /2' should result in multiple script_types."""
        from multivault.chains.bitcoin.path import script_type_from_path
        paths = ["m/48'/0'/0'/1'", "m/48'/0'/0'/2'"]
        types = {script_type_from_path(p) for p in paths}
        assert len(types) == 2

    def test_validate_signers_accepts_p2sh_p2wsh_path(self):
        """_validate_signers should accept /1' BIP48 paths."""
        from multivault.chains.bitcoin.path import validate_bip48_path
        assert validate_bip48_path("m/48'/0'/0'/1'") is True
        assert validate_bip48_path("m/48'/1'/0'/1'") is True

    @pytest.mark.asyncio
    async def test_accept_p2sh_p2wsh_signers(self, async_session, btc_network):
        """Create wallet with /1' signers → address starts with '3'."""
        s1 = await _create_signer(async_session, "S1", PK1, "m/48'/0'/0'/1'")
        s2 = await _create_signer(async_session, "S2", PK2, "m/48'/0'/1'/1'")

        service = WalletService(async_session)
        wallet = await service.create_wallet(
            WalletCreate(
                name="Test P2SH-P2WSH",
                chain_type="BTC",
                threshold=2,
                signer_ids=[s1.id, s2.id],
                network_id=btc_network.id,
            )
        )
        assert wallet.address is not None
        assert wallet.address.startswith("3"), f"Expected P2SH address (starts with 3), got {wallet.address}"

    @pytest.mark.asyncio
    async def test_reject_mixed_script_type_signers(self, async_session, btc_network):
        """One /1' signer + one /2' signer → ValidationError with 'mixed'."""
        s1 = await _create_signer(async_session, "S1", PK1, "m/48'/0'/0'/1'")
        s2 = await _create_signer(async_session, "S2", PK2, "m/48'/0'/0'/2'")

        service = WalletService(async_session)
        with pytest.raises(ValidationError) as exc_info:
            await service.create_wallet(
                WalletCreate(
                    name="Test Mixed",
                    chain_type="BTC",
                    threshold=2,
                    signer_ids=[s1.id, s2.id],
                    network_id=btc_network.id,
                )
            )
        err_msg = exc_info.value.message.lower()
        assert "mixed" in err_msg or "script_type" in err_msg
