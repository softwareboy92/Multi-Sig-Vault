"""
Unit tests for Safe manager.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from web3 import Web3

from multivault.chains.evm.safe import (
    Operation,
    SafeDeploymentInfo,
    SafeManager,
    SafeManagerError,
    SafeSignature,
    SafeTransaction,
    SafeTransactionError,
    EXECUTION_SUCCESS_TOPIC,
    EXECUTION_FAILURE_TOPIC,
)
from multivault.chains.evm.web3_client import Web3Client


# Test addresses
TEST_OWNERS = [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
]


@pytest.fixture
def mock_client():
    """Create a mock Web3 client."""
    client = MagicMock(spec=Web3Client)
    client.chain_id = 1
    client.is_connected = True
    client.web3 = MagicMock()
    client.call = AsyncMock()
    return client


@pytest.fixture
def safe_manager(mock_client):
    """Create a Safe manager with mock client."""
    return SafeManager(
        client=mock_client,
        factory_address="0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
        singleton_address="0x41675C099F32341bf84BFc5382aF534df5C7461a",
        fallback_handler="0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    )


class TestSafeManagerInit:
    """Tests for Safe manager initialization."""

    def test_init_with_custom_addresses(self, mock_client):
        """Init with custom contract addresses."""
        manager = SafeManager(
            client=mock_client,
            factory_address="0xFactoryAddress0000000000000000000000000",
            singleton_address="0xSingletonAddress0000000000000000000000",
        )
        assert manager._factory == "0xFactoryAddress0000000000000000000000000"
        assert manager._singleton == "0xSingletonAddress0000000000000000000000"

    def test_get_default_addresses(self, mock_client):
        """Get default addresses for known chain."""
        manager = SafeManager(client=mock_client)
        addresses = manager._get_addresses()
        assert "factory" in addresses
        assert "singleton" in addresses


class TestSafeSetupData:
    """Tests for setup data building."""

    def test_build_setup_data(self, safe_manager):
        """Build valid setup data."""
        data = safe_manager.build_setup_data(
            owners=TEST_OWNERS,
            threshold=2,
        )

        # Should have function selector (4 bytes) + encoded params
        assert len(data) > 4
        # Function selector for setup()
        assert data[:4] == Web3.keccak(
            text="setup(address[],uint256,address,bytes,address,address,uint256,address)"
        )[:4]

    def test_build_setup_data_sorts_owners(self, safe_manager):
        """Owners are sorted in setup data."""
        # Provide unsorted owners
        unsorted = [
            "0x3333333333333333333333333333333333333333",
            "0x1111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
        ]
        data = safe_manager.build_setup_data(owners=unsorted, threshold=2)

        # Data should be deterministic regardless of input order
        sorted_data = safe_manager.build_setup_data(owners=sorted(unsorted), threshold=2)
        assert data == sorted_data


class TestPredictSafeAddress:
    """Tests for CREATE2 address prediction."""

    @pytest.mark.asyncio
    async def test_predict_address_deterministic(self, safe_manager, mock_client):
        """Predicted address is deterministic."""
        # Mock proxy creation code
        mock_proxy_code = b"\x60\x80" + b"\x00" * 100  # Minimal mock bytecode
        mock_client.call.return_value = bytes.fromhex(
            "0000000000000000000000000000000000000000000000000000000000000020"  # offset
            "0000000000000000000000000000000000000000000000000000000000000066"  # length (102 bytes)
        ) + mock_proxy_code.ljust(128, b"\x00")  # padded data

        addr1 = await safe_manager.predict_safe_address(
            owners=TEST_OWNERS,
            threshold=2,
            salt_nonce=0,
        )
        addr2 = await safe_manager.predict_safe_address(
            owners=TEST_OWNERS,
            threshold=2,
            salt_nonce=0,
        )
        assert addr1 == addr2

    @pytest.mark.asyncio
    async def test_predict_address_different_salt(self, safe_manager, mock_client):
        """Different salt produces different address."""
        # Mock proxy creation code
        from eth_abi import encode
        mock_proxy_code = b"\x60\x80" + b"\x00" * 100
        mock_client.call.return_value = encode(["bytes"], [mock_proxy_code])

        addr1 = await safe_manager.predict_safe_address(
            owners=TEST_OWNERS,
            threshold=2,
            salt_nonce=0,
        )
        addr2 = await safe_manager.predict_safe_address(
            owners=TEST_OWNERS,
            threshold=2,
            salt_nonce=1,
        )
        assert addr1 != addr2

    @pytest.mark.asyncio
    async def test_predict_address_valid_format(self, safe_manager, mock_client):
        """Predicted address is valid checksum address."""
        # Mock proxy creation code
        from eth_abi import encode
        mock_proxy_code = b"\x60\x80" + b"\x00" * 100
        mock_client.call.return_value = encode(["bytes"], [mock_proxy_code])

        addr = await safe_manager.predict_safe_address(
            owners=TEST_OWNERS,
            threshold=2,
            salt_nonce=0,
        )
        assert addr.startswith("0x")
        assert len(addr) == 42
        assert addr == Web3.to_checksum_address(addr)


class TestDeploymentInfo:
    """Tests for deployment info."""

    @pytest.mark.asyncio
    async def test_get_deployment_info_not_deployed(self, safe_manager, mock_client):
        """Get info for non-deployed Safe."""
        from eth_abi import encode
        mock_proxy_code = b"\x60\x80" + b"\x00" * 100
        mock_client.call.return_value = encode(["bytes"], [mock_proxy_code])

        # First call checks factory (has code), second checks Safe (empty)
        mock_client.web3.eth.get_code = AsyncMock(
            side_effect=[b"\x60\x80", b""],
        )

        info = await safe_manager.get_deployment_info(
            owners=TEST_OWNERS,
            threshold=2,
            salt_nonce=0,
        )

        assert isinstance(info, SafeDeploymentInfo)
        assert not info.is_deployed
        assert info.threshold == 2
        assert len(info.owners) == 3

    @pytest.mark.asyncio
    async def test_get_deployment_info_deployed(self, safe_manager, mock_client):
        """Get info for deployed Safe."""
        from eth_abi import encode
        mock_proxy_code = b"\x60\x80" + b"\x00" * 100
        mock_client.call.return_value = encode(["bytes"], [mock_proxy_code])
        mock_client.web3.eth.get_code = AsyncMock(return_value=b"\x60\x80")

        info = await safe_manager.get_deployment_info(
            owners=TEST_OWNERS,
            threshold=2,
            salt_nonce=0,
        )

        assert info.is_deployed


class TestBuildDeploymentTx:
    """Tests for deployment transaction building."""

    def test_build_deployment_tx(self, safe_manager):
        """Build valid deployment transaction."""
        tx = safe_manager.build_deployment_tx(
            owners=TEST_OWNERS,
            threshold=2,
            salt_nonce=0,
        )

        assert "to" in tx
        assert "data" in tx
        assert "value" in tx
        assert tx["value"] == 0


class TestSafeTransaction:
    """Tests for Safe transaction handling."""

    def test_safe_transaction_typed_data(self):
        """SafeTransaction generates valid typed data."""
        tx = SafeTransaction(
            to="0x1111111111111111111111111111111111111111",
            value=1000000000000000000,
            data=b"",
            operation=Operation.CALL,
            nonce=0,
            safe_address="0x2222222222222222222222222222222222222222",
            chain_id=1,
        )

        typed_data = tx.get_typed_data()
        assert typed_data["primaryType"] == "SafeTx"
        assert typed_data["domain"]["chainId"] == 1
        assert "SafeTx" in typed_data["types"]

    @pytest.mark.asyncio
    async def test_build_safe_transaction(self, safe_manager, mock_client):
        """Build a Safe transaction."""
        # Mock nonce call
        from eth_abi import encode
        mock_client.call.return_value = encode(["uint256"], [5])

        tx = await safe_manager.build_safe_transaction(
            safe_address="0x2222222222222222222222222222222222222222",
            to="0x1111111111111111111111111111111111111111",
            value=1000000000000000000,
        )

        assert isinstance(tx, SafeTransaction)
        assert tx.nonce == 5
        assert tx.value == 1000000000000000000
        assert len(tx.tx_hash) == 32

    @pytest.mark.asyncio
    async def test_get_nonce(self, safe_manager, mock_client):
        """Get Safe nonce."""
        from eth_abi import encode
        mock_client.call.return_value = encode(["uint256"], [10])

        nonce = await safe_manager.get_nonce(
            "0x2222222222222222222222222222222222222222"
        )
        assert nonce == 10


class TestSignatureHandling:
    """Tests for signature operations."""

    def test_combine_signatures(self, safe_manager):
        """Combine signatures in sorted order."""
        sig1 = SafeSignature(
            signer="0x1111111111111111111111111111111111111111",
            data=b"\x01" * 65,
        )
        sig2 = SafeSignature(
            signer="0x2222222222222222222222222222222222222222",
            data=b"\x02" * 65,
        )

        # Provide in reverse order
        combined = safe_manager.combine_signatures([sig2, sig1])

        # Should be sorted by address
        assert combined[:65] == b"\x01" * 65
        assert combined[65:] == b"\x02" * 65

    def test_combine_signatures_invalid_length(self, safe_manager):
        """Invalid signature length raises error."""
        sig = SafeSignature(
            signer="0x1111111111111111111111111111111111111111",
            data=b"\x01" * 64,  # Wrong length
        )

        with pytest.raises(SafeTransactionError):
            safe_manager.combine_signatures([sig])

    def test_signature_components(self):
        """SafeSignature extracts r, s, v."""
        data = bytes(range(65))
        sig = SafeSignature(signer="0x1234", data=data)

        assert sig.r == bytes(range(32))
        assert sig.s == bytes(range(32, 64))
        assert sig.v == 64


class TestExecTransactionData:
    """Tests for execTransaction encoding."""

    def test_build_exec_transaction_data(self, safe_manager):
        """Build valid execTransaction call data."""
        tx = SafeTransaction(
            to="0x1111111111111111111111111111111111111111",
            value=1000,
            data=b"",
            safe_address="0x2222222222222222222222222222222222222222",
            chain_id=1,
            nonce=0,
        )
        signatures = b"\x00" * 130  # Two signatures

        data = safe_manager.build_exec_transaction_data(tx, signatures)

        # Should have function selector
        expected_selector = Web3.keccak(
            text="execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)"
        )[:4]
        assert data[:4] == expected_selector


class TestEventParsing:
    """Tests for event parsing."""

    def test_parse_execution_success(self):
        """Parse ExecutionSuccess event."""
        from eth_abi import encode

        # EXECUTION_SUCCESS_TOPIC is hex string without 0x prefix from Web3.keccak().hex()
        topic_hex = EXECUTION_SUCCESS_TOPIC
        # If it starts with 0x, strip it; otherwise use as-is
        if topic_hex.startswith("0x"):
            topic_bytes = bytes.fromhex(topic_hex[2:])
        else:
            topic_bytes = bytes.fromhex(topic_hex)

        log = {
            "topics": [topic_bytes],
            "data": encode(["bytes32", "uint256"], [b"\x01" * 32, 1000]),
            "address": "0x1234567890123456789012345678901234567890",
            "blockNumber": 12345,
            "transactionHash": b"\xab" * 32,
        }

        parsed = SafeManager.parse_execution_event(log)

        assert parsed is not None
        assert parsed["event"] == "ExecutionSuccess"
        assert parsed["payment"] == 1000

    def test_parse_execution_failure(self):
        """Parse ExecutionFailure event."""
        from eth_abi import encode

        # EXECUTION_FAILURE_TOPIC is hex string without 0x prefix from Web3.keccak().hex()
        topic_hex = EXECUTION_FAILURE_TOPIC
        if topic_hex.startswith("0x"):
            topic_bytes = bytes.fromhex(topic_hex[2:])
        else:
            topic_bytes = bytes.fromhex(topic_hex)

        log = {
            "topics": [topic_bytes],
            "data": encode(["bytes32", "uint256"], [b"\x02" * 32, 0]),
            "address": "0x1234567890123456789012345678901234567890",
            "blockNumber": 12345,
            "transactionHash": b"\xcd" * 32,
        }

        parsed = SafeManager.parse_execution_event(log)

        assert parsed is not None
        assert parsed["event"] == "ExecutionFailure"

    def test_parse_unknown_event(self):
        """Unknown event returns None."""
        log = {
            "topics": [b"\x00" * 32],
            "data": b"",
            "address": "0x1234",
            "blockNumber": 12345,
            "transactionHash": b"\x00" * 32,
        }

        parsed = SafeManager.parse_execution_event(log)
        assert parsed is None


class TestSafePolicyABI:
    """Tests for policy change ABI entries."""

    def test_safe_abi_has_add_owner(self):
        """SAFE_ABI must include addOwnerWithThreshold."""
        from multivault.chains.evm.safe import SAFE_ABI
        names = [entry.get("name") for entry in SAFE_ABI]
        assert "addOwnerWithThreshold" in names

    def test_safe_abi_has_remove_owner(self):
        """SAFE_ABI must include removeOwner."""
        from multivault.chains.evm.safe import SAFE_ABI
        names = [entry.get("name") for entry in SAFE_ABI]
        assert "removeOwner" in names

    def test_safe_abi_has_swap_owner(self):
        """SAFE_ABI must include swapOwner."""
        from multivault.chains.evm.safe import SAFE_ABI
        names = [entry.get("name") for entry in SAFE_ABI]
        assert "swapOwner" in names

    def test_safe_abi_has_change_threshold(self):
        """SAFE_ABI must include changeThreshold."""
        from multivault.chains.evm.safe import SAFE_ABI
        names = [entry.get("name") for entry in SAFE_ABI]
        assert "changeThreshold" in names


SENTINEL_ADDRESS = "0x0000000000000000000000000000000000000001"


class TestDerivePrevOwner:
    """Tests for derive_prev_owner static method."""

    def test_first_owner_returns_sentinel(self):
        """First owner's prev is SENTINEL."""
        owners = [
            "0x1111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
            "0x3333333333333333333333333333333333333333",
        ]
        result = SafeManager.derive_prev_owner(owners, owners[0])
        assert result == SENTINEL_ADDRESS

    def test_second_owner_returns_first(self):
        """Second owner's prev is the first owner."""
        owners = [
            "0x1111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
            "0x3333333333333333333333333333333333333333",
        ]
        result = SafeManager.derive_prev_owner(owners, owners[1])
        assert result == owners[0]

    def test_third_owner_returns_second(self):
        """Third owner's prev is the second owner."""
        owners = [
            "0x1111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
            "0x3333333333333333333333333333333333333333",
        ]
        result = SafeManager.derive_prev_owner(owners, owners[2])
        assert result == owners[1]

    def test_owner_not_in_list_raises(self):
        """Unknown owner raises ValueError."""
        owners = [
            "0x1111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
        ]
        with pytest.raises(ValueError, match="not found in owners"):
            SafeManager.derive_prev_owner(
                owners, "0x9999999999999999999999999999999999999999"
            )

    def test_case_insensitive_match(self):
        """Address matching is case-insensitive."""
        owners = [
            "0xABCDabcdABCDabcdABCDabcdABCDabcdABCDabcd",
            "0x1111111111111111111111111111111111111111",
        ]
        result = SafeManager.derive_prev_owner(
            owners, "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd"
        )
        assert result == SENTINEL_ADDRESS


class TestBuildPolicyChangeData:
    """Tests for build_policy_change_data."""

    def test_add_owner_encodes_correctly(self, safe_manager):
        """add_owner produces addOwnerWithThreshold calldata."""
        data = safe_manager.build_policy_change_data(
            action="add_owner",
            new_owner="0x4444444444444444444444444444444444444444",
            new_threshold=2,
        )
        expected_selector = Web3.keccak(
            text="addOwnerWithThreshold(address,uint256)"
        )[:4]
        assert data[:4] == expected_selector

    def test_remove_owner_encodes_correctly(self, safe_manager):
        """remove_owner produces removeOwner calldata with prevOwner."""
        owners = [
            "0x1111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
            "0x3333333333333333333333333333333333333333",
        ]
        data = safe_manager.build_policy_change_data(
            action="remove_owner",
            owners=owners,
            removed_owner="0x2222222222222222222222222222222222222222",
            new_threshold=1,
        )
        expected_selector = Web3.keccak(
            text="removeOwner(address,address,uint256)"
        )[:4]
        assert data[:4] == expected_selector

    def test_swap_owner_encodes_correctly(self, safe_manager):
        """swap_owner produces swapOwner calldata."""
        owners = [
            "0x1111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
        ]
        data = safe_manager.build_policy_change_data(
            action="swap_owner",
            owners=owners,
            removed_owner="0x2222222222222222222222222222222222222222",
            new_owner="0x4444444444444444444444444444444444444444",
        )
        expected_selector = Web3.keccak(
            text="swapOwner(address,address,address)"
        )[:4]
        assert data[:4] == expected_selector

    def test_change_threshold_encodes_correctly(self, safe_manager):
        """change_threshold produces changeThreshold calldata."""
        data = safe_manager.build_policy_change_data(
            action="change_threshold",
            new_threshold=3,
        )
        expected_selector = Web3.keccak(text="changeThreshold(uint256)")[:4]
        assert data[:4] == expected_selector

    def test_invalid_action_raises(self, safe_manager):
        """Unknown action raises ValueError."""
        with pytest.raises(ValueError, match="Unknown policy action"):
            safe_manager.build_policy_change_data(action="invalid")
