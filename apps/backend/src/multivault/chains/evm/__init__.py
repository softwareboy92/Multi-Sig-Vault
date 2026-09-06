"""
EVM chain adapter module.

Provides Safe-based multisig functionality for EVM-compatible chains
including Ethereum, Polygon, Arbitrum, Base, etc.
"""

from .adapter import EVMAdapter, EVMAdapterError
from .multicall import Multicall3, BalanceQuery, BalanceResult
from .safe import (
    SafeManager,
    SafeTransaction,
    SafeSignature,
    SafeDeploymentInfo,
)
from .web3_client import Web3Client, Web3ClientError

__all__ = [
    # Adapter
    "EVMAdapter",
    "EVMAdapterError",
    # Web3 Client
    "Web3Client",
    "Web3ClientError",
    # Safe
    "SafeManager",
    "SafeTransaction",
    "SafeSignature",
    "SafeDeploymentInfo",
    # Multicall
    "Multicall3",
    "BalanceQuery",
    "BalanceResult",
]
