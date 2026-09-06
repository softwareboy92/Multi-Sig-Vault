"""Address validation helpers."""

import re

from web3 import Web3


def normalize_btc_network_category(network: str | None) -> str:
    if not network:
        return "any"
    return "testnet" if "test" in network.lower() else "mainnet"


def _is_btc_prefix_valid(address: str, category: str) -> bool:
    addr = address.strip().lower()
    if category == "any":
        return addr.startswith(("tb1", "m", "n", "2", "bcrt1", "bc1", "1", "3"))
    if category == "testnet":
        return addr.startswith(("tb1", "m", "n", "2", "bcrt1"))
    return addr.startswith(("bc1", "1", "3"))


def validate_btc_address(address: str, category: str | None) -> None:
    from embit import script

    if not address or not address.strip():
        raise ValueError("Empty BTC address")

    normalized = normalize_btc_network_category(category)
    if not _is_btc_prefix_valid(address, normalized):
        raise ValueError("BTC address network mismatch")

    try:
        _ = script.address_to_scriptpubkey(address)
    except Exception as exc:
        raise ValueError("Invalid BTC address") from exc


def validate_evm_address(address: str) -> None:
    if not address or not address.strip():
        raise ValueError("Empty EVM address")
    if not Web3.is_address(address):
        raise ValueError("Invalid EVM address")


def is_evm_address(address: str) -> bool:
    return bool(address) and Web3.is_address(address)


def is_btc_address(address: str, category: str | None) -> bool:
    try:
        validate_btc_address(address, category)
        return True
    except ValueError:
        return False


def is_hex_address(address: str) -> bool:
    return bool(address) and re.fullmatch(r"0x[a-fA-F0-9]{40}", address) is not None
