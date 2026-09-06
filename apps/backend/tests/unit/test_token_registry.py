"""Tests for EVM preset token registry."""

from web3 import Web3

from multivault.chains.evm.token_registry import PresetToken, get_preset_tokens

# All mainnet chain_ids that should have preset tokens
MAINNET_CHAIN_IDS = [1, 10, 56, 137, 42161, 8453, 43114, 250, 100]


class TestGetPresetTokens:
    """Tests for get_preset_tokens function."""

    def test_returns_list_for_known_chain(self):
        tokens = get_preset_tokens(1)
        assert isinstance(tokens, list)
        assert len(tokens) > 0

    def test_returns_empty_for_unknown_chain(self):
        tokens = get_preset_tokens(999999)
        assert tokens == []

    def test_returns_empty_for_testnet(self):
        """Testnets should not have preset tokens."""
        assert get_preset_tokens(11155111) == []  # Sepolia
        assert get_preset_tokens(97) == []         # BNB testnet
        assert get_preset_tokens(80001) == []      # Mumbai

    def test_all_mainnets_have_tokens(self):
        for chain_id in MAINNET_CHAIN_IDS:
            tokens = get_preset_tokens(chain_id)
            assert len(tokens) > 0, f"chain_id {chain_id} has no preset tokens"

    def test_token_fields_complete(self):
        for chain_id in MAINNET_CHAIN_IDS:
            for token in get_preset_tokens(chain_id):
                assert isinstance(token, PresetToken)
                assert token.symbol, f"Empty symbol on chain {chain_id}"
                assert token.name, f"Empty name on chain {chain_id}"
                assert token.address, f"Empty address on chain {chain_id}"
                assert isinstance(token.decimals, int)
                assert token.decimals >= 0

    def test_all_addresses_are_checksum(self):
        for chain_id in MAINNET_CHAIN_IDS:
            for token in get_preset_tokens(chain_id):
                assert Web3.is_checksum_address(token.address), (
                    f"Non-checksum address {token.address} "
                    f"for {token.symbol} on chain {chain_id}"
                )

    def test_no_duplicate_addresses_per_chain(self):
        for chain_id in MAINNET_CHAIN_IDS:
            tokens = get_preset_tokens(chain_id)
            addresses = [t.address.lower() for t in tokens]
            assert len(addresses) == len(set(addresses)), (
                f"Duplicate address on chain {chain_id}"
            )

    def test_ethereum_has_major_stablecoins(self):
        tokens = get_preset_tokens(1)
        symbols = {t.symbol for t in tokens}
        assert "USDT" in symbols
        assert "USDC" in symbols
        assert "DAI" in symbols

    def test_ethereum_has_major_defi(self):
        tokens = get_preset_tokens(1)
        symbols = {t.symbol for t in tokens}
        for expected in ["WETH", "WBTC", "UNI", "LINK", "AAVE"]:
            assert expected in symbols, f"{expected} missing from Ethereum preset"
