"""
Multicall3 batch query implementation.

Provides efficient batch queries for token balances and contract calls
using the Multicall3 contract deployed on all major EVM chains.

Reference: https://github.com/mds1/multicall
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from eth_abi import encode, decode
from web3 import Web3

from .web3_client import Web3Client, Web3ClientError

logger = logging.getLogger(__name__)


# Multicall3 is deployed at the same address on all chains
MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11"

# ERC20 balanceOf(address) selector
ERC20_BALANCE_OF = Web3.keccak(text="balanceOf(address)")[:4]

# Multicall3 aggregate3 selector
AGGREGATE3_SELECTOR = Web3.keccak(
    text="aggregate3((address,bool,bytes)[])"
)[:4]


class MulticallError(Web3ClientError):
    """Raised when multicall operation fails."""

    pass


@dataclass
class BalanceQuery:
    """A balance query for an address/token pair."""

    address: str  # Wallet address
    token: str | None = None  # Token contract (None = native ETH)
    decimals: int = 18


@dataclass
class BalanceResult:
    """Result of a balance query."""

    address: str
    token: str | None
    balance: int
    success: bool
    error: str | None = None


@dataclass
class Call:
    """A single call in a multicall batch."""

    target: str
    call_data: bytes
    allow_failure: bool = True


@dataclass
class CallResult:
    """Result of a single call."""

    success: bool
    return_data: bytes


class Multicall3:
    """
    Multicall3 batch query client.

    Efficiently batches multiple contract calls into a single RPC request.
    Commonly used for batch balance queries but supports arbitrary calls.
    """

    def __init__(
        self,
        client: Web3Client,
        multicall_address: str = MULTICALL3_ADDRESS,
        batch_size: int = 100,
    ):
        """
        Initialize Multicall3 client.

        Args:
            client: Connected Web3 client.
            multicall_address: Multicall3 contract address.
            batch_size: Maximum calls per batch (prevents gas limits).
        """
        self._client = client
        self._address = Web3.to_checksum_address(multicall_address)
        self._batch_size = batch_size

    async def aggregate(self, calls: list[Call]) -> list[CallResult]:
        """
        Execute multiple calls in a single batch.

        Args:
            calls: List of calls to execute.

        Returns:
            List of CallResult with success status and return data.
        """
        if not calls:
            return []

        results: list[CallResult] = []

        # Split into batches to avoid gas limits
        for i in range(0, len(calls), self._batch_size):
            batch = calls[i : i + self._batch_size]
            batch_results = await self._execute_batch(batch)
            results.extend(batch_results)

        return results

    async def _execute_batch(self, calls: list[Call]) -> list[CallResult]:
        """Execute a single batch of calls."""
        # Build aggregate3 call data
        # struct Call3 { address target; bool allowFailure; bytes callData; }
        calls_encoded = [
            (Web3.to_checksum_address(c.target), c.allow_failure, c.call_data)
            for c in calls
        ]

        call_data = AGGREGATE3_SELECTOR + encode(
            ["(address,bool,bytes)[]"],
            [calls_encoded],
        )

        try:
            result = await self._client.call(self._address, call_data)

            # Decode results: (bool success, bytes returnData)[]
            (decoded,) = decode(["(bool,bytes)[]"], result)

            return [
                CallResult(success=success, return_data=bytes(return_data))
                for success, return_data in decoded
            ]
        except Exception as e:
            logger.error(f"Multicall batch failed: {e}")
            # Return failures for all calls
            return [CallResult(success=False, return_data=b"") for _ in calls]

    # -------------------------------------------------------------------------
    # Balance Queries
    # -------------------------------------------------------------------------

    async def get_balances(
        self,
        queries: list[BalanceQuery],
    ) -> list[BalanceResult]:
        """
        Get balances for multiple address/token pairs.

        Args:
            queries: List of balance queries.

        Returns:
            List of BalanceResult.
        """
        if not queries:
            return []

        # Separate native ETH and ERC20 queries
        eth_queries: list[tuple[int, BalanceQuery]] = []
        token_queries: list[tuple[int, BalanceQuery]] = []

        for idx, q in enumerate(queries):
            if q.token is None:
                eth_queries.append((idx, q))
            else:
                token_queries.append((idx, q))

        # Initialize results
        results: list[BalanceResult | None] = [None] * len(queries)

        # Handle native ETH balances (use getEthBalance on Multicall3)
        if eth_queries:
            eth_results = await self._get_eth_balances(
                [q.address for _, q in eth_queries]
            )
            for (idx, query), balance in zip(eth_queries, eth_results):
                results[idx] = BalanceResult(
                    address=query.address,
                    token=None,
                    balance=balance if balance is not None else 0,
                    success=balance is not None,
                    error=None if balance is not None else "Failed to fetch",
                )

        # Handle ERC20 balances
        if token_queries:
            calls = []
            for _, q in token_queries:
                call_data = ERC20_BALANCE_OF + encode(
                    ["address"], [Web3.to_checksum_address(q.address)]
                )
                calls.append(
                    Call(target=q.token, call_data=call_data, allow_failure=True)
                )

            call_results = await self.aggregate(calls)

            for (idx, query), call_result in zip(token_queries, call_results):
                if call_result.success and len(call_result.return_data) >= 32:
                    try:
                        (balance,) = decode(["uint256"], call_result.return_data)
                        results[idx] = BalanceResult(
                            address=query.address,
                            token=query.token,
                            balance=balance,
                            success=True,
                        )
                    except Exception:
                        results[idx] = BalanceResult(
                            address=query.address,
                            token=query.token,
                            balance=0,
                            success=False,
                            error="Failed to decode balance",
                        )
                else:
                    results[idx] = BalanceResult(
                        address=query.address,
                        token=query.token,
                        balance=0,
                        success=False,
                        error="Call failed",
                    )

        return [r for r in results if r is not None]

    async def _get_eth_balances(self, addresses: list[str]) -> list[int | None]:
        """Get native ETH balances using Multicall3.getEthBalance."""
        # getEthBalance(address) selector
        get_eth_balance = Web3.keccak(text="getEthBalance(address)")[:4]

        calls = [
            Call(
                target=self._address,  # Multicall3 itself
                call_data=get_eth_balance
                + encode(["address"], [Web3.to_checksum_address(addr)]),
                allow_failure=True,
            )
            for addr in addresses
        ]

        results = await self.aggregate(calls)

        balances: list[int | None] = []
        for result in results:
            if result.success and len(result.return_data) >= 32:
                try:
                    (balance,) = decode(["uint256"], result.return_data)
                    balances.append(balance)
                except Exception:
                    balances.append(None)
            else:
                balances.append(None)

        return balances

    # -------------------------------------------------------------------------
    # Token Metadata
    # -------------------------------------------------------------------------

    async def get_token_info(
        self,
        token_addresses: list[str],
    ) -> list[dict[str, Any]]:
        """
        Get token metadata (name, symbol, decimals) for multiple tokens.

        Args:
            token_addresses: List of token contract addresses.

        Returns:
            List of token info dicts.
        """
        if not token_addresses:
            return []

        # Build calls for each token: name(), symbol(), decimals()
        name_selector = Web3.keccak(text="name()")[:4]
        symbol_selector = Web3.keccak(text="symbol()")[:4]
        decimals_selector = Web3.keccak(text="decimals()")[:4]

        calls: list[Call] = []
        for token in token_addresses:
            calls.append(Call(target=token, call_data=name_selector, allow_failure=True))
            calls.append(
                Call(target=token, call_data=symbol_selector, allow_failure=True)
            )
            calls.append(
                Call(target=token, call_data=decimals_selector, allow_failure=True)
            )

        results = await self.aggregate(calls)

        token_infos: list[dict[str, Any]] = []
        for i, token in enumerate(token_addresses):
            idx = i * 3
            name_result = results[idx]
            symbol_result = results[idx + 1]
            decimals_result = results[idx + 2]

            info: dict[str, Any] = {"address": token}

            # Decode name (string)
            if name_result.success and name_result.return_data:
                try:
                    (name,) = decode(["string"], name_result.return_data)
                    info["name"] = name
                except Exception:
                    info["name"] = None
            else:
                info["name"] = None

            # Decode symbol (string)
            if symbol_result.success and symbol_result.return_data:
                try:
                    (symbol,) = decode(["string"], symbol_result.return_data)
                    info["symbol"] = symbol
                except Exception:
                    info["symbol"] = None
            else:
                info["symbol"] = None

            # Decode decimals (uint8)
            if decimals_result.success and decimals_result.return_data:
                try:
                    (decimals,) = decode(["uint8"], decimals_result.return_data)
                    info["decimals"] = decimals
                except Exception:
                    info["decimals"] = 18
            else:
                info["decimals"] = 18

            token_infos.append(info)

        return token_infos

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    async def check_deployed(self) -> bool:
        """Check if Multicall3 is deployed on the current chain."""
        try:
            code = await self._client.web3.eth.get_code(self._address)
            return len(code) > 0
        except Exception:
            return False
