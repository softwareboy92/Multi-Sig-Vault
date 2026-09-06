"""Tests for Tenderly simulation client."""

import json

import pytest

from multivault.chains.evm.tenderly import (
    GUARD_STORAGE_SLOT,
    NONCE_STORAGE_SLOT,
    THRESHOLD_STORAGE_SLOT,
    SimulationResult,
    _safe_int,
    build_state_overrides,
    parse_simulation_response,
)


class TestSafeInt:
    def test_int_passthrough(self):
        assert _safe_int(42) == 42

    def test_decimal_string(self):
        assert _safe_int("1000000000000000000") == 1000000000000000000

    def test_hex_string(self):
        assert _safe_int("0xde0b6b3a7640000") == 10**18

    def test_empty_string(self):
        assert _safe_int("") == 0

    def test_whitespace_string(self):
        assert _safe_int("  ") == 0


class TestBuildStateOverrides:
    def test_no_overrides_returns_none(self):
        result = build_state_overrides("0xSafe")
        assert result is None

    def test_threshold_override(self):
        result = build_state_overrides("0xSafe", override_threshold=True)
        assert result is not None
        storage = result["0xSafe"]["storage"]
        assert THRESHOLD_STORAGE_SLOT in storage
        assert storage[THRESHOLD_STORAGE_SLOT].endswith("1")

    def test_nonce_override(self):
        result = build_state_overrides("0xSafe", nonce_override=42)
        assert result is not None
        storage = result["0xSafe"]["storage"]
        assert NONCE_STORAGE_SLOT in storage
        assert int(storage[NONCE_STORAGE_SLOT], 16) == 42

    def test_guard_override(self):
        result = build_state_overrides("0xSafe", guard_override=True)
        assert result is not None
        storage = result["0xSafe"]["storage"]
        assert GUARD_STORAGE_SLOT in storage
        assert int(storage[GUARD_STORAGE_SLOT], 16) == 0

    def test_all_overrides_combined(self):
        result = build_state_overrides(
            "0xSafe",
            override_threshold=True,
            nonce_override=10,
            guard_override=True,
        )
        storage = result["0xSafe"]["storage"]
        assert len(storage) == 3


class TestParseSimulationResponse:
    def test_successful_simulation(self):
        data = {
            "simulation": {"status": True},
            "transaction": {
                "gas_used": 85000,
                "transaction_info": {
                    "asset_changes": [],
                    "balance_diff": [],
                },
                "call_trace": [],
            },
        }
        result = parse_simulation_response(data)
        assert result.success is True
        assert result.gas_used == 85000
        assert result.revert_reason is None

    def test_failed_simulation_with_revert(self):
        data = {
            "simulation": {"status": False},
            "transaction": {
                "gas_used": 30000,
                "error_info": {"error_message": "ERC20: insufficient allowance"},
                "transaction_info": {},
                "call_trace": [],
            },
        }
        result = parse_simulation_response(data)
        assert result.success is False
        assert result.revert_reason == "ERC20: insufficient allowance"

    def test_success_with_inner_revert(self):
        data = {
            "simulation": {"status": True},
            "transaction": {
                "gas_used": 50000,
                "transaction_info": {},
                "call_trace": [
                    {"error": "execution reverted"},
                ],
            },
        }
        result = parse_simulation_response(data)
        assert result.success is False
        assert "reverted" in result.revert_reason

    def test_asset_changes_parsed(self):
        data = {
            "simulation": {"status": True},
            "transaction": {
                "gas_used": 60000,
                "transaction_info": {
                    "asset_changes": [
                        {
                            "from": "0xSender",
                            "to": "0xReceiver",
                            "type": "Transfer",
                            "raw_amount": "1000000",
                            "amount": "1.0",
                            "dollar_value": "1.00",
                            "token_info": {
                                "symbol": "USDC",
                                "contract_address": "0xToken",
                                "decimals": 6,
                            },
                        },
                    ],
                },
                "call_trace": [],
            },
        }
        result = parse_simulation_response(data)
        assert len(result.asset_changes) == 1
        ac = result.asset_changes[0]
        assert ac.token_symbol == "USDC"
        assert ac.raw_amount == "1000000"
        assert ac.from_address == "0xSender"
        assert ac.to_address == "0xReceiver"
        assert ac.dollar_value == "1.00"
        assert ac.direction == "Sent"

    def test_balance_diff_with_string_values(self):
        """Tenderly returns balance_diff original/dirty as strings, not ints."""
        data = {
            "simulation": {"status": True},
            "transaction": {
                "gas_used": 45000,
                "transaction_info": {
                    "asset_changes": [],
                    "balance_diff": [
                        {
                            "address": "0xSafe",
                            "original": "1000000000000000000",
                            "dirty": "900000000000000000",
                        },
                        {
                            "address": "0xRecipient",
                            "original": "500000000000000000",
                            "dirty": "600000000000000000",
                        },
                    ],
                },
                "call_trace": [],
            },
        }
        result = parse_simulation_response(data)
        assert len(result.eth_balance_changes) == 2

        sender = result.eth_balance_changes[0]
        assert sender.address == "0xSafe"
        assert sender.before == "1000000000000000000"
        assert sender.after == "900000000000000000"
        assert sender.diff == "-100000000000000000"

        recipient = result.eth_balance_changes[1]
        assert recipient.address == "0xRecipient"
        assert recipient.diff == "100000000000000000"

    def test_to_dict_roundtrip(self):
        result = SimulationResult(success=True, gas_used=100)
        d = result.to_dict()
        assert d["gas_estimate"] == 100
        assert d["revert_reason"] is None
        assert isinstance(d["asset_changes"], list)

    def test_call_trace_dict_with_own_error(self):
        """When call_trace is a dict with an error field, it should be detected."""
        data = {
            "simulation": {"status": True},
            "transaction": {
                "gas_used": 40000,
                "transaction_info": {},
                "call_trace": {
                    "error": "execution reverted",
                    "calls": [],
                },
            },
        }
        result = parse_simulation_response(data)
        assert result.success is False
        assert "reverted" in result.revert_reason

    def test_balance_diff_with_hex_values(self):
        """Tenderly may return balance_diff as hex strings."""
        data = {
            "simulation": {"status": True},
            "transaction": {
                "gas_used": 21000,
                "transaction_info": {
                    "balance_diff": [
                        {
                            "address": "0xSafe",
                            "original": "0xde0b6b3a7640000",
                            "dirty": "0xc249fdd327780000",
                        },
                    ],
                },
                "call_trace": [],
            },
        }
        result = parse_simulation_response(data)
        assert len(result.eth_balance_changes) == 1
        assert result.eth_balance_changes[0].before == str(10**18)
        assert result.eth_balance_changes[0].after == str(14 * 10**18)

    def test_native_currency_uses_platform_symbol(self):
        """NativeCurrency asset changes should use platform-configured symbol."""
        data = {
            "simulation": {"status": True},
            "transaction": {
                "gas_used": 21000,
                "transaction_info": {
                    "asset_changes": [
                        {
                            "from": "0xSender",
                            "to": "0xReceiver",
                            "type": "Transfer",
                            "raw_amount": "1000000000000000000",
                            "amount": "1.0",
                            "dollar_value": "",
                            "token_info": {
                                "symbol": "ETH",
                                "standard": "NativeCurrency",
                                "type": "Fungible",
                                "contract_address": "0x0000000000000000000000000000000000000000",
                                "decimals": 18,
                            },
                        },
                    ],
                },
                "call_trace": [],
            },
        }
        # BSC chain_id=56 → symbol should be BNB, not ETH
        result = parse_simulation_response(data, chain_id=56)
        assert result.asset_changes[0].token_symbol == "BNB"

    def test_native_currency_without_chain_id_keeps_original(self):
        """Without chain_id, NativeCurrency keeps the Tenderly-provided symbol."""
        data = {
            "simulation": {"status": True},
            "transaction": {
                "gas_used": 21000,
                "transaction_info": {
                    "asset_changes": [
                        {
                            "from": "0xSender",
                            "to": "0xReceiver",
                            "type": "Transfer",
                            "raw_amount": "1000000000000000000",
                            "amount": "1.0",
                            "dollar_value": "",
                            "token_info": {
                                "symbol": "ETH",
                                "standard": "NativeCurrency",
                                "type": "Fungible",
                                "decimals": 18,
                            },
                        },
                    ],
                },
                "call_trace": [],
            },
        }
        result = parse_simulation_response(data)
        assert result.asset_changes[0].token_symbol == "ETH"

    def test_erc20_token_not_affected_by_chain_id(self):
        """ERC20 tokens should keep their own symbol regardless of chain_id."""
        data = {
            "simulation": {"status": True},
            "transaction": {
                "gas_used": 50000,
                "transaction_info": {
                    "asset_changes": [
                        {
                            "from": "0xSender",
                            "to": "0xReceiver",
                            "type": "Transfer",
                            "raw_amount": "1000000",
                            "amount": "1.0",
                            "dollar_value": "1.00",
                            "token_info": {
                                "symbol": "USDC",
                                "type": "ERC20",
                                "contract_address": "0xToken",
                                "decimals": 6,
                            },
                        },
                    ],
                },
                "call_trace": [],
            },
        }
        result = parse_simulation_response(data, chain_id=56)
        assert result.asset_changes[0].token_symbol == "USDC"
