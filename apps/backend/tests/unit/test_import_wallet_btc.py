"""Tests for BTC P2WSH / P2SH-P2WSH wallet import (Mode A: manual, Mode B: auto-extract)."""

import json
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch, MagicMock
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.chains.bitcoin.address import (
    BitcoinNetwork,
    build_multisig_script,
    derive_p2sh_p2wsh_address,
    derive_p2wsh_address,
    sort_public_keys,
)
from multivault.models import (
    DeviceType,
    NetworkConfig,
    Signer,
    SignerStatus,
    Wallet,
    WalletStatus,
)
from multivault.models.wallet import WalletSource
from multivault.schemas.wallet import WalletImport
from multivault.services.wallet_service import WalletService
from multivault.errors.exceptions import ConflictError, ValidationError

PK1 = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"
PK2 = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
PK3 = "03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556"
TEST_PUBKEYS = [PK1, PK2, PK3]


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


@pytest_asyncio.fixture
def wallet_service(async_session: AsyncSession) -> WalletService:
    return WalletService(async_session)


def _derive_test_address(threshold: int, pubkeys: list[str]) -> str:
    """Helper: derive P2WSH address for test data."""
    addr, _ = derive_p2wsh_address(threshold, pubkeys, BitcoinNetwork.MAINNET)
    return addr


class TestImportBTCModeA:
    @pytest.mark.asyncio
    async def test_import_btc_manual_success(
        self, wallet_service, btc_network, async_session
    ):
        address = _derive_test_address(2, TEST_PUBKEYS)

        data = WalletImport(
            name="Imported BTC",
            chain_type="BTC",
            network_id=btc_network.id,
            address=address,
            threshold=2,
            public_keys=TEST_PUBKEYS,
        )

        wallet = await wallet_service.import_wallet(data)

        assert wallet.status == WalletStatus.ACTIVE
        assert wallet.source == WalletSource.IMPORTED
        assert wallet.address == address
        assert wallet.threshold == 2
        assert wallet.signer_count == 3

        # Verify signers
        stmt = select(Signer).where(Signer.chain_type == "BTC")
        result = await async_session.execute(stmt)
        signers = list(result.scalars().all())
        assert len(signers) == 3
        for s in signers:
            assert s.status == SignerStatus.UNVERIFIED
            assert s.device_type == DeviceType.UNKNOWN

    @pytest.mark.asyncio
    async def test_import_btc_pubkey_order_independent(
        self, wallet_service, btc_network
    ):
        """Reversed pubkey order should produce same result."""
        address = _derive_test_address(2, TEST_PUBKEYS)

        data = WalletImport(
            name="BTC reversed",
            chain_type="BTC",
            network_id=btc_network.id,
            address=address,
            threshold=2,
            public_keys=list(reversed(TEST_PUBKEYS)),
        )

        wallet = await wallet_service.import_wallet(data)
        assert wallet.address == address

    @pytest.mark.asyncio
    async def test_import_btc_address_mismatch(
        self, wallet_service, btc_network
    ):
        data = WalletImport(
            name="BTC wrong addr",
            chain_type="BTC",
            network_id=btc_network.id,
            address="bc1qwrongaddresshere",
            threshold=2,
            public_keys=TEST_PUBKEYS,
        )

        with pytest.raises(ValidationError, match="does not match"):
            await wallet_service.import_wallet(data)

    @pytest.mark.asyncio
    async def test_import_btc_invalid_pubkey(
        self, wallet_service, btc_network
    ):
        data = WalletImport(
            name="BTC bad key",
            chain_type="BTC",
            network_id=btc_network.id,
            address="bc1qexample",
            threshold=2,
            public_keys=["not-a-valid-hex-key", PK2, PK3],
        )

        with pytest.raises(ValidationError, match="[Ii]nvalid public key"):
            await wallet_service.import_wallet(data)

    @pytest.mark.asyncio
    async def test_import_btc_duplicate(
        self, wallet_service, btc_network, async_session
    ):
        address = _derive_test_address(2, TEST_PUBKEYS)

        existing = Wallet(
            name="Already here",
            chain_type="BTC",
            threshold=2,
            signer_count=3,
            address=address,
            network_id=btc_network.id,
            status=WalletStatus.ACTIVE,
        )
        async_session.add(existing)
        await async_session.commit()

        data = WalletImport(
            name="Dup BTC",
            chain_type="BTC",
            network_id=btc_network.id,
            address=address,
            threshold=2,
            public_keys=TEST_PUBKEYS,
        )

        with pytest.raises(ConflictError, match="already exists"):
            await wallet_service.import_wallet(data)


# ---------------------------------------------------------------------------
# Mode B helpers & tests
# ---------------------------------------------------------------------------


def _build_mock_raw_hex(address: str, pubkeys: list[str], threshold: int) -> str:
    """Build a mock raw transaction hex with multisig witness data.

    Constructs a real embit Transaction where vin[0] has a witness stack
    whose last item is the witnessScript derived from the given pubkeys,
    so _extract_witness_script can find it.
    """
    from embit import script as embit_script
    from embit.script import Witness
    from embit.transaction import Transaction, TransactionInput, TransactionOutput

    ws = build_multisig_script(threshold, pubkeys)
    # Witness: [OP_0, fake_sigs..., witnessScript]
    witness_items = [b""] + [b"\x30\x06\x02\x01\x01\x02\x01\x01"] * threshold + [ws]

    inp = TransactionInput(
        txid=bytes(32),
        vout=0,
        sequence=0xFFFFFFFF,
        witness=Witness(witness_items),
    )

    # Dummy P2WSH output (32 zero bytes as witness-program)
    out_spk = embit_script.Script(b"\x00\x20" + bytes(32))
    out = TransactionOutput(value=10000, script_pubkey=out_spk)

    tx = Transaction(version=2, locktime=0, vin=[inp], vout=[out])
    return tx.serialize().hex()


def _build_mock_non_matching_raw_hex() -> str:
    """Build a raw tx where no vin matches any P2WSH multisig address."""
    from embit import script as embit_script
    from embit.script import Witness
    from embit.transaction import Transaction, TransactionInput, TransactionOutput

    # Witness with a non-multisig script (just a single small push)
    inp = TransactionInput(
        txid=bytes(32),
        vout=0,
        sequence=0xFFFFFFFF,
        witness=Witness([b"", b"\x01"]),
    )
    out_spk = embit_script.Script(b"\x00\x20" + bytes(32))
    out = TransactionOutput(value=10000, script_pubkey=out_spk)
    tx = Transaction(version=2, locktime=0, vin=[inp], vout=[out])
    return tx.serialize().hex()


class TestImportBTCModeB:
    @pytest.mark.asyncio
    async def test_import_btc_auto_with_txid(
        self, wallet_service, btc_network, async_session
    ):
        """Mode B with user-provided txid."""
        address = _derive_test_address(2, TEST_PUBKEYS)
        raw_hex = _build_mock_raw_hex(address, TEST_PUBKEYS, 2)

        data = WalletImport(
            name="BTC auto",
            chain_type="BTC",
            network_id=btc_network.id,
            address=address,
            tx_id="aa" * 32,
        )

        with patch(
            "multivault.services.wallet_service.ElectrumClient"
        ) as MockElectrum:
            client = MockElectrum.return_value
            client.connect = AsyncMock()
            client.disconnect = AsyncMock()
            client.get_raw_transaction = AsyncMock(return_value=raw_hex)

            wallet = await wallet_service.import_wallet(data)

        assert wallet.status == WalletStatus.ACTIVE
        assert wallet.source == WalletSource.IMPORTED
        assert wallet.address == address
        assert wallet.threshold == 2

    @pytest.mark.asyncio
    async def test_import_btc_auto_discover(
        self, wallet_service, btc_network, async_session
    ):
        """Mode B without txid — auto-discover from history."""
        address = _derive_test_address(2, TEST_PUBKEYS)
        raw_hex = _build_mock_raw_hex(address, TEST_PUBKEYS, 2)

        data = WalletImport(
            name="BTC discover",
            chain_type="BTC",
            network_id=btc_network.id,
            address=address,
        )

        with patch(
            "multivault.services.wallet_service.ElectrumClient"
        ) as MockElectrum:
            client = MockElectrum.return_value
            client.connect = AsyncMock()
            client.disconnect = AsyncMock()
            client.get_history = AsyncMock(
                return_value=[MagicMock(txid="bb" * 32, height=100)]
            )
            client.get_raw_transaction = AsyncMock(return_value=raw_hex)

            wallet = await wallet_service.import_wallet(data)

        assert wallet.address == address
        assert wallet.threshold == 2

    @pytest.mark.asyncio
    async def test_import_btc_auto_no_spending_tx(
        self, wallet_service, btc_network
    ):
        """No spending tx found → ValidationError."""
        address = _derive_test_address(2, TEST_PUBKEYS)
        non_matching_hex = _build_mock_non_matching_raw_hex()

        data = WalletImport(
            name="BTC no spend",
            chain_type="BTC",
            network_id=btc_network.id,
            address=address,
        )

        with patch(
            "multivault.services.wallet_service.ElectrumClient"
        ) as MockElectrum:
            client = MockElectrum.return_value
            client.connect = AsyncMock()
            client.disconnect = AsyncMock()
            client.get_history = AsyncMock(
                return_value=[MagicMock(txid="cc" * 32, height=100)]
            )
            client.get_raw_transaction = AsyncMock(return_value=non_matching_hex)

            with pytest.raises(ValidationError, match="spending transaction"):
                await wallet_service.import_wallet(data)


# ---------------------------------------------------------------------------
# P2SH-P2WSH helpers & tests
# ---------------------------------------------------------------------------


def _derive_test_p2sh_p2wsh_address(
    threshold: int, pubkeys: list[str]
) -> tuple[str, bytes, bytes]:
    """Helper: derive P2SH-P2WSH address for test data."""
    return derive_p2sh_p2wsh_address(threshold, pubkeys, BitcoinNetwork.MAINNET)


def _build_mock_p2sh_p2wsh_raw_hex(
    address: str, pubkeys: list[str], threshold: int
) -> str:
    """Build a mock raw tx whose witness stack matches a P2SH-P2WSH address.

    The witnessScript is the same multisig script used for P2WSH; the only
    difference is the address derivation path (P2SH wrapping).  The
    _extract_witness_script helper tries both P2WSH and P2SH-P2WSH, so the
    raw tx structure is identical — only the target *address* differs.
    """
    from embit import script as embit_script
    from embit.script import Witness
    from embit.transaction import Transaction, TransactionInput, TransactionOutput

    ws = build_multisig_script(threshold, pubkeys)
    witness_items = [b""] + [b"\x30\x06\x02\x01\x01\x02\x01\x01"] * threshold + [ws]

    inp = TransactionInput(
        txid=bytes(32),
        vout=0,
        sequence=0xFFFFFFFF,
        witness=Witness(witness_items),
    )
    out_spk = embit_script.Script(b"\x00\x20" + bytes(32))
    out = TransactionOutput(value=10000, script_pubkey=out_spk)
    tx = Transaction(version=2, locktime=0, vin=[inp], vout=[out])
    return tx.serialize().hex()


class TestImportBTCP2SHP2WSHModeA:
    """Mode A (manual) tests for P2SH-P2WSH addresses."""

    @pytest.mark.asyncio
    async def test_import_p2sh_p2wsh_manual_success(
        self, wallet_service, btc_network, async_session
    ):
        address, redeem_script, witness_script = _derive_test_p2sh_p2wsh_address(
            2, TEST_PUBKEYS
        )
        assert address.startswith("3"), "P2SH-P2WSH mainnet address must start with '3'"

        data = WalletImport(
            name="Imported P2SH-P2WSH",
            chain_type="BTC",
            network_id=btc_network.id,
            address=address,
            threshold=2,
            public_keys=TEST_PUBKEYS,
        )

        wallet = await wallet_service.import_wallet(data)

        assert wallet.status == WalletStatus.ACTIVE
        assert wallet.source == WalletSource.IMPORTED
        assert wallet.address == address
        assert wallet.threshold == 2
        assert wallet.signer_count == 3

        # Verify extra fields
        extra = json.loads(wallet.extra) if wallet.extra else {}
        assert extra.get("script_type") == "p2sh-p2wsh"
        assert extra.get("redeem_script") == redeem_script.hex()
        assert "witness_script" in extra

    @pytest.mark.asyncio
    async def test_import_p2sh_p2wsh_pubkey_order_independent(
        self, wallet_service, btc_network
    ):
        """Reversed pubkey order should produce same P2SH-P2WSH result."""
        address, _, _ = _derive_test_p2sh_p2wsh_address(2, TEST_PUBKEYS)

        data = WalletImport(
            name="P2SH reversed",
            chain_type="BTC",
            network_id=btc_network.id,
            address=address,
            threshold=2,
            public_keys=list(reversed(TEST_PUBKEYS)),
        )

        wallet = await wallet_service.import_wallet(data)
        assert wallet.address == address

    @pytest.mark.asyncio
    async def test_import_p2sh_p2wsh_address_mismatch(
        self, wallet_service, btc_network
    ):
        """Wrong P2SH address should raise ValidationError."""
        data = WalletImport(
            name="P2SH wrong addr",
            chain_type="BTC",
            network_id=btc_network.id,
            address="3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
            threshold=2,
            public_keys=TEST_PUBKEYS,
        )

        with pytest.raises(ValidationError, match="does not match"):
            await wallet_service.import_wallet(data)


class TestImportBTCP2SHP2WSHModeB:
    """Mode B (auto-extract) tests for P2SH-P2WSH addresses."""

    @pytest.mark.asyncio
    async def test_import_p2sh_p2wsh_auto_with_txid(
        self, wallet_service, btc_network, async_session
    ):
        """Mode B with user-provided txid for P2SH-P2WSH."""
        address, redeem_script, _ = _derive_test_p2sh_p2wsh_address(2, TEST_PUBKEYS)
        raw_hex = _build_mock_p2sh_p2wsh_raw_hex(address, TEST_PUBKEYS, 2)

        data = WalletImport(
            name="P2SH auto",
            chain_type="BTC",
            network_id=btc_network.id,
            address=address,
            tx_id="dd" * 32,
        )

        with patch(
            "multivault.services.wallet_service.ElectrumClient"
        ) as MockElectrum:
            client = MockElectrum.return_value
            client.connect = AsyncMock()
            client.disconnect = AsyncMock()
            client.get_raw_transaction = AsyncMock(return_value=raw_hex)

            wallet = await wallet_service.import_wallet(data)

        assert wallet.status == WalletStatus.ACTIVE
        assert wallet.source == WalletSource.IMPORTED
        assert wallet.address == address
        assert wallet.threshold == 2

        extra = json.loads(wallet.extra) if wallet.extra else {}
        assert extra.get("script_type") == "p2sh-p2wsh"
        assert extra.get("redeem_script") == redeem_script.hex()

    @pytest.mark.asyncio
    async def test_import_p2sh_p2wsh_auto_discover(
        self, wallet_service, btc_network, async_session
    ):
        """Mode B without txid — auto-discover for P2SH-P2WSH."""
        address, _, _ = _derive_test_p2sh_p2wsh_address(2, TEST_PUBKEYS)
        raw_hex = _build_mock_p2sh_p2wsh_raw_hex(address, TEST_PUBKEYS, 2)

        data = WalletImport(
            name="P2SH discover",
            chain_type="BTC",
            network_id=btc_network.id,
            address=address,
        )

        with patch(
            "multivault.services.wallet_service.ElectrumClient"
        ) as MockElectrum:
            client = MockElectrum.return_value
            client.connect = AsyncMock()
            client.disconnect = AsyncMock()
            client.get_history = AsyncMock(
                return_value=[MagicMock(txid="ee" * 32, height=200)]
            )
            client.get_raw_transaction = AsyncMock(return_value=raw_hex)

            wallet = await wallet_service.import_wallet(data)

        assert wallet.address == address
        assert wallet.threshold == 2
