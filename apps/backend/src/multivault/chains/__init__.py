"""
Chain adapters for multi-chain support.

This module provides abstraction layers for different blockchain networks.
"""

from multivault.chains.base import (
    Balance,
    BroadcastResult,
    ChainAdapter,
    UnsignedTransaction,
    UTXO,
    WalletConfig,
)
from multivault.chains.bitcoin import BitcoinAdapter, BitcoinAdapterError
from multivault.chains.evm import EVMAdapter, EVMAdapterError

__all__ = [
    # Base
    "ChainAdapter",
    "WalletConfig",
    "UnsignedTransaction",
    "BroadcastResult",
    "Balance",
    "UTXO",
    # Bitcoin
    "BitcoinAdapter",
    "BitcoinAdapterError",
    # EVM
    "EVMAdapter",
    "EVMAdapterError",
]

