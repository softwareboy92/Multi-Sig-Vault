"""Native coin metadata lookup by chain type and chain ID.

Used to dynamically determine the correct native coin symbol/name
for any EVM-compatible network, instead of hardcoding ETH.
"""

from __future__ import annotations

from typing import TypedDict


class NativeCoinInfo(TypedDict):
    symbol: str
    name: str
    decimals: int


# EVM chain_id → native coin mapping
_EVM_NATIVE_COINS: dict[int, NativeCoinInfo] = {
    1: {"symbol": "ETH", "name": "Ethereum", "decimals": 18},
    5: {"symbol": "ETH", "name": "Goerli ETH", "decimals": 18},
    10: {"symbol": "ETH", "name": "Optimism ETH", "decimals": 18},
    11155111: {"symbol": "ETH", "name": "Sepolia ETH", "decimals": 18},
    56: {"symbol": "BNB", "name": "BNB", "decimals": 18},
    97: {"symbol": "tBNB", "name": "BNB Testnet", "decimals": 18},
    137: {"symbol": "POL", "name": "Polygon", "decimals": 18},
    80001: {"symbol": "POL", "name": "Polygon Mumbai", "decimals": 18},
    42161: {"symbol": "ETH", "name": "Arbitrum ETH", "decimals": 18},
    421614: {"symbol": "ETH", "name": "Arbitrum Sepolia ETH", "decimals": 18},
    8453: {"symbol": "ETH", "name": "Base ETH", "decimals": 18},
    84532: {"symbol": "ETH", "name": "Base Sepolia ETH", "decimals": 18},
    43114: {"symbol": "AVAX", "name": "Avalanche", "decimals": 18},
    250: {"symbol": "FTM", "name": "Fantom", "decimals": 18},
    100: {"symbol": "xDAI", "name": "Gnosis", "decimals": 18},
}

# BTC is always BTC, no chain_id differentiation needed
_BTC_NATIVE: NativeCoinInfo = {"symbol": "BTC", "name": "Bitcoin", "decimals": 8}

# Default fallback for unknown EVM chains
_EVM_DEFAULT: NativeCoinInfo = {"symbol": "ETH", "name": "Ether", "decimals": 18}


def get_native_coin_info(
    chain_type: str,
    chain_id: int | None = None,
) -> NativeCoinInfo:
    """Look up native coin metadata for the given chain.

    Args:
        chain_type: "EVM" or "BTC"
        chain_id: EVM chain ID (ignored for BTC)

    Returns:
        NativeCoinInfo with symbol, name, and decimals.
    """
    if chain_type == "BTC":
        return _BTC_NATIVE

    if chain_type == "EVM" and chain_id is not None:
        return _EVM_NATIVE_COINS.get(chain_id, _EVM_DEFAULT)

    return _EVM_DEFAULT
