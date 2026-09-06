"""HTTP client for Safe Transaction Service API (api.safe.global)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from web3 import Web3

logger = logging.getLogger(__name__)


def _to_checksum(address: str) -> str:
    """Convert to EIP-55 checksum address, pass through on failure."""
    try:
        return Web3.to_checksum_address(address)
    except (ValueError, TypeError):
        return address

# Safe Transaction Service API base
_SAFE_TX_SERVICE_BASE = "https://api.safe.global/tx-service"

# chain_id → short name used in Safe TX Service URL path
_CHAIN_SHORT_NAMES: dict[int, str] = {
    1: "eth",           # Ethereum Mainnet
    10: "oeth",         # Optimism
    56: "bnb",          # BNB Chain
    100: "gno",         # Gnosis Chain
    137: "matic",       # Polygon
    8453: "base",       # Base
    42161: "arb",       # Arbitrum One
    43114: "avax",      # Avalanche C-Chain
    11155111: "sep",    # Sepolia
    84532: "basesep",   # Base Sepolia
}

_HTTP_TIMEOUT = 30.0
_MAX_RETRIES = 3


class SafeTxServiceError(Exception):
    """Error communicating with Safe Transaction Service."""


class SafeTxServiceClient:
    """HTTP client for Safe Transaction Service API.

    Usage::

        client = SafeTxServiceClient(chain_id=1)
        if not client.is_supported():
            raise ValueError("Unsupported network")
        txs = await client.get_multisig_transactions("0xSafe...")
    """

    def __init__(self, chain_id: int | str) -> None:
        self.chain_id = int(chain_id)
        short_name = _CHAIN_SHORT_NAMES.get(self.chain_id)
        if short_name:
            self._base_api_url: str | None = (
                f"{_SAFE_TX_SERVICE_BASE}/{short_name}/api/v1"
            )
        else:
            self._base_api_url = None

    def is_supported(self) -> bool:
        """Whether the chain_id is supported by Safe Transaction Service."""
        return self._base_api_url is not None

    async def get_multisig_transactions(
        self,
        safe_address: str,
        limit: int = 200,
        executed: bool = True,
    ) -> list[dict[str, Any]]:
        """Fetch multisig transactions from Safe Transaction Service."""
        if not self._base_api_url:
            raise SafeTxServiceError(
                f"Chain ID {self.chain_id} not supported by Safe Transaction Service"
            )

        checksummed = _to_checksum(safe_address)
        url = f"{self._base_api_url}/safes/{checksummed}/multisig-transactions/"
        params: dict[str, Any] = {"ordering": "-nonce", "limit": min(limit, 100)}
        if executed:
            params["executed"] = "true"

        return await self._paginated_fetch(url, params, limit)

    async def get_incoming_transfers(
        self,
        safe_address: str,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """Fetch incoming transfers to a Safe address."""
        if not self._base_api_url:
            raise SafeTxServiceError(
                f"Chain ID {self.chain_id} not supported by Safe Transaction Service"
            )

        checksummed = _to_checksum(safe_address)
        url = f"{self._base_api_url}/safes/{checksummed}/incoming-transfers/"
        params: dict[str, Any] = {"limit": min(limit, 100)}

        return await self._paginated_fetch(url, params, limit)

    async def _paginated_fetch(
        self,
        url: str,
        params: dict[str, Any],
        limit: int,
    ) -> list[dict[str, Any]]:
        """Fetch paginated results, following 'next' links up to limit."""
        results: list[dict[str, Any]] = []
        current_url: str | None = url
        current_params: dict[str, Any] | None = params

        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, follow_redirects=True) as http:
            while current_url and len(results) < limit:
                response = await self._request_with_retry(
                    http, current_url, current_params
                )
                data = response.json()

                page_results = data.get("results", [])
                results.extend(page_results)

                next_url = data.get("next")
                if next_url and len(results) < limit:
                    current_url = next_url
                    current_params = None
                else:
                    break

        return results[:limit]

    async def _request_with_retry(
        self,
        http: httpx.AsyncClient,
        url: str,
        params: dict[str, Any] | None,
    ) -> httpx.Response:
        """Execute GET with exponential backoff on 429/5xx."""
        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                resp = await http.get(url, params=params)
                if resp.status_code == 429:
                    wait = 2 ** attempt
                    logger.warning(
                        "Safe TX Service rate limited, retrying in %ds (attempt %d/%d)",
                        wait, attempt + 1, _MAX_RETRIES,
                    )
                    last_exc = SafeTxServiceError(
                        "Rate limited (429) by Safe TX Service"
                    )
                    await asyncio.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code >= 500:
                    wait = 2 ** attempt
                    logger.warning(
                        "Safe TX Service error %d, retrying in %ds",
                        exc.response.status_code, wait,
                    )
                    await asyncio.sleep(wait)
                    last_exc = exc
                    continue
                raise SafeTxServiceError(
                    f"Safe TX Service request failed: {exc}"
                ) from exc
            except httpx.RequestError as exc:
                last_exc = exc
                if attempt < _MAX_RETRIES - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue

        raise SafeTxServiceError(
            f"Safe TX Service request failed after {_MAX_RETRIES} retries: {last_exc}"
        ) from last_exc
