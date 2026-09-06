"""Unified network configuration service.

Replaces the per-chain NetworkService with a single service that handles
all chain types via the unified ``networks`` / ``network_nodes`` tables.
"""

import json
import time
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.chains.bitcoin.electrum import ElectrumClient
from multivault.chains.evm import Web3Client
from multivault.errors.exceptions import NotFoundError, ValidationError
from multivault.models.network import (
    BTCNetwork,
    NetworkConfig,
    NetworkNodeConfig,
    NodeType,
    parse_electrum_url,
)


class NetworkService:
    """Service for unified network configuration and validation."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ========================================================================
    # Network CRUD
    # ========================================================================

    async def list_networks(
        self,
        chain_type: str | None = None,
    ) -> list[NetworkConfig]:
        """List networks, optionally filtered by chain_type."""
        stmt = select(NetworkConfig).order_by(NetworkConfig.created_at.desc())
        if chain_type:
            stmt = stmt.where(NetworkConfig.chain_type == chain_type.upper())
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_network(self, network_id: str) -> NetworkConfig | None:
        """Get network by ID."""
        stmt = select(NetworkConfig).where(NetworkConfig.id == network_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_network_by_name(
        self,
        chain_type: str,
        name: str,
    ) -> NetworkConfig | None:
        """Get network by (chain_type, name) natural key."""
        stmt = select(NetworkConfig).where(
            NetworkConfig.chain_type == chain_type.upper(),
            NetworkConfig.name == name,
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def create_network(
        self,
        chain_type: str,
        name: str,
        explorer_url: str | None = None,
        enabled: bool = True,
        is_testnet: bool = False,
        extra: dict | None = None,
    ) -> NetworkConfig:
        """Create a new network with validated extra metadata."""
        chain_type = chain_type.upper()
        self._validate_network_extra(chain_type, extra)

        if chain_type == "EVM" and extra and "chain_id" in extra:
            await self._check_chain_id_unique(extra["chain_id"])

        network = NetworkConfig(
            chain_type=chain_type,
            name=name,
            explorer_url=explorer_url,
            enabled=enabled,
            is_testnet=is_testnet,
            extra=json.dumps(extra) if extra else None,
        )
        self.db.add(network)
        await self.db.commit()
        await self.db.refresh(network)
        return network

    async def update_network(
        self,
        network: NetworkConfig,
        name: str,
        explorer_url: str | None = None,
        enabled: bool = True,
        is_testnet: bool = False,
        extra: dict | None = None,
    ) -> NetworkConfig:
        """Update network metadata."""
        if extra is not None:
            self._validate_network_extra(network.chain_type, extra)
            if network.chain_type == "EVM":
                self._check_chain_id_immutable(network, extra)

        network.name = name
        network.explorer_url = explorer_url
        network.enabled = enabled
        network.is_testnet = is_testnet
        if extra is not None:
            network.extra = json.dumps(extra)
        await self.db.commit()
        await self.db.refresh(network)
        return network

    async def delete_network(self, network: NetworkConfig) -> None:
        """Delete network (CASCADE deletes nodes)."""
        await self.db.delete(network)
        await self.db.commit()

    async def set_default_node(
        self,
        network: NetworkConfig,
        node_id: str,
    ) -> None:
        """Set default node for a network."""
        node = await self.get_node(node_id)
        if not node or node.network_id != network.id:
            raise ValidationError(
                message="Node does not belong to this network",
                details={"network_id": network.id, "node_id": node_id},
            )
        network.default_node_id = node_id
        await self.db.commit()

    async def get_default_node(
        self,
        network_id: str,
    ) -> NetworkNodeConfig | None:
        """Get the default node for a network."""
        network = await self.get_network(network_id)
        if not network or not network.default_node_id:
            return None
        return await self.get_node(network.default_node_id)

    # ========================================================================
    # Node CRUD
    # ========================================================================

    async def list_nodes(self, network_id: str) -> list[NetworkNodeConfig]:
        """List all nodes for a network, ordered by priority."""
        stmt = (
            select(NetworkNodeConfig)
            .where(NetworkNodeConfig.network_id == network_id)
            .order_by(
                NetworkNodeConfig.priority.desc(),
                NetworkNodeConfig.created_at.asc(),
            )
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_node(self, node_id: str) -> NetworkNodeConfig | None:
        """Get node by ID."""
        stmt = select(NetworkNodeConfig).where(NetworkNodeConfig.id == node_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def create_node(
        self,
        network: NetworkConfig,
        node_type: str,
        endpoint_url: str,
        priority: int = 100,
        enabled: bool = True,
        extra: dict | None = None,
    ) -> NetworkNodeConfig:
        """Create a new node for a network."""
        node = NetworkNodeConfig(
            network_id=network.id,
            node_type=node_type,
            endpoint_url=endpoint_url,
            priority=priority,
            enabled=enabled,
            is_healthy=False,
            last_health_check=None,
            extra=json.dumps(extra) if extra else None,
        )
        self.db.add(node)
        await self.db.commit()
        await self.db.refresh(node)

        # Auto-set as default if first node
        if not network.default_node_id:
            await self.set_default_node(network, node.id)

        return node

    async def update_node(
        self,
        node: NetworkNodeConfig,
        endpoint_url: str,
        priority: int = 100,
        enabled: bool = True,
        extra: dict | None = None,
    ) -> NetworkNodeConfig:
        """Update node configuration."""
        network = await self.get_network(node.network_id)
        if not network:
            raise NotFoundError("Network", node.network_id)

        node.endpoint_url = endpoint_url
        node.priority = priority
        node.enabled = enabled
        if extra is not None:
            node.extra = json.dumps(extra)
        node.last_health_check = datetime.now(UTC)
        await self.db.commit()
        await self.db.refresh(node)
        return node

    async def delete_node(self, node: NetworkNodeConfig) -> None:
        """Delete node (prevent deleting last node)."""
        remaining = await self.list_nodes(node.network_id)
        if len(remaining) <= 1:
            raise ValidationError(
                message="Cannot delete last node for network",
                details={"network_id": node.network_id},
            )

        # Unset default if this is the default node
        network = await self.get_network(node.network_id)
        if network and network.default_node_id == node.id:
            network.default_node_id = None
            await self.db.commit()

        await self.db.delete(node)
        await self.db.commit()

    async def test_node(self, node_id: str) -> dict:
        """Test node connectivity and update health status.

        Returns dict with ``success`` (bool) and ``latency_ms`` (float | None).
        """
        node = await self.get_node(node_id)
        if not node:
            raise NotFoundError("Node", node_id)

        network = await self.get_network(node.network_id)
        if not network:
            raise NotFoundError("Network", node.network_id)

        latency_ms: float | None = None
        try:
            network_extra = self._parse_extra(network.extra)
            result = await self.validate_endpoint(
                network.chain_type,
                node.node_type,
                node.endpoint_url,
                network_extra,
            )
            node.is_healthy = True
            latency_ms = result.get("latency_ms")
        except Exception:
            node.is_healthy = False

        node.last_health_check = datetime.now(UTC)
        await self.db.commit()
        return {"success": node.is_healthy, "latency_ms": latency_ms}

    # ========================================================================
    # Validation
    # ========================================================================

    async def validate_endpoint(
        self,
        chain_type: str,
        node_type: str,
        endpoint_url: str,
        network_extra: dict | None = None,
    ) -> dict:
        """Validate endpoint connectivity and return chain info.

        Delegates to chain-specific validation based on chain_type+node_type.
        Always includes ``latency_ms`` (round-trip time in milliseconds).
        """
        t0 = time.monotonic()
        if chain_type == "EVM" and node_type == NodeType.JSON_RPC:
            result = await self._validate_evm_rpc(endpoint_url, network_extra)
        elif chain_type == "BTC" and node_type == NodeType.ELECTRUM:
            result = await self._validate_btc_electrum(endpoint_url, network_extra)
        else:
            # Future chains: basic success
            result = {"success": True}
        elapsed = (time.monotonic() - t0) * 1000  # ms
        result["latency_ms"] = round(elapsed, 1)
        return result

    async def _validate_evm_rpc(
        self,
        rpc_url: str,
        network_extra: dict | None = None,
    ) -> dict:
        """Validate EVM RPC URL and return chain_id."""
        client = Web3Client(rpc_url=rpc_url)
        await client.connect()
        try:
            chain_id = client.chain_id
            if not chain_id:
                raise ValidationError(
                    message="Unable to detect chain ID from RPC",
                    details={"rpc_url": rpc_url},
                )
            _ = await client.get_block_number()
            detected_chain_id = int(chain_id)

            # Verify chain_id matches network extra if provided
            if network_extra and "chain_id" in network_extra:
                expected = network_extra["chain_id"]
                if detected_chain_id != expected:
                    raise ValidationError(
                        message="RPC chain ID mismatch",
                        details={"expected": expected, "actual": detected_chain_id},
                    )

            return {"chain_id": detected_chain_id}
        finally:
            await client.disconnect()

    async def _validate_btc_electrum(
        self,
        endpoint_url: str,
        network_extra: dict | None = None,
    ) -> dict:
        """Validate BTC Electrum endpoint."""
        host, port, ssl = parse_electrum_url(endpoint_url)
        async with ElectrumClient(host, port, ssl) as client:
            ok = await client.ping()
            if not ok:
                raise ValidationError(
                    message="Electrum server did not respond",
                    details={"host": host, "port": port, "ssl": ssl},
                )

            if network_extra and "btc_network" in network_extra:
                features = await client.server_features()
                genesis_hash = (features or {}).get("genesis_hash")
                if not genesis_hash:
                    raise ValidationError(
                        message="Unable to detect Electrum network",
                        details={"host": host, "port": port, "ssl": ssl},
                    )

                expected = self._expected_btc_genesis_hash(
                    network_extra["btc_network"]
                )
                if expected and genesis_hash.lower() != expected.lower():
                    raise ValidationError(
                        message="BTC node network mismatch",
                        details={
                            "expected": network_extra["btc_network"],
                            "actual": genesis_hash,
                        },
                    )

        return {"success": True}

    # ========================================================================
    # Helpers
    # ========================================================================

    async def _check_chain_id_unique(self, chain_id: int) -> None:
        """Ensure no other enabled EVM network uses this chain_id."""
        from sqlalchemy import select

        stmt = select(NetworkConfig).where(
            NetworkConfig.chain_type == "EVM",
        )
        result = await self.db.execute(stmt)
        for network in result.scalars().all():
            if network.extra:
                existing_extra = self._parse_extra(network.extra)
                if existing_extra and existing_extra.get("chain_id") == chain_id:
                    raise ValidationError(
                        message=f"EVM network with chain_id {chain_id} already exists",
                        details={"chain_id": chain_id, "existing_network": network.name},
                    )

    @staticmethod
    def _check_chain_id_immutable(network: NetworkConfig, new_extra: dict) -> None:
        """Reject chain_id changes on existing EVM networks."""
        if not network.extra:
            return
        existing = json.loads(network.extra) if isinstance(network.extra, str) else network.extra
        old_chain_id = existing.get("chain_id")
        new_chain_id = new_extra.get("chain_id")
        if old_chain_id is not None and new_chain_id != old_chain_id:
            raise ValidationError(
                message="chain_id cannot be changed after network creation",
                details={"current": old_chain_id, "requested": new_chain_id},
            )

    @staticmethod
    def _validate_network_extra(chain_type: str, extra: dict | None) -> None:
        """Validate chain-specific extra metadata."""
        if chain_type == "EVM":
            if not extra or "chain_id" not in extra:
                raise ValidationError(
                    message="EVM network requires extra.chain_id",
                    details={"chain_type": chain_type},
                )
            if not isinstance(extra["chain_id"], int) or extra["chain_id"] <= 0:
                raise ValidationError(
                    message="extra.chain_id must be a positive integer",
                    details={"chain_id": extra["chain_id"]},
                )
        elif chain_type == "BTC":
            if extra and "btc_network" in extra:
                valid_values = {m.value for m in BTCNetwork}
                if extra["btc_network"] not in valid_values:
                    raise ValidationError(
                        message=f"Invalid btc_network: {extra['btc_network']}",
                        details={"valid_values": sorted(valid_values)},
                    )

    @staticmethod
    def _parse_extra(raw: str | None) -> dict | None:
        """Parse JSON extra column to dict."""
        if raw is None:
            return None
        return json.loads(raw) if isinstance(raw, str) else raw

    @staticmethod
    def _expected_btc_genesis_hash(network: str) -> str | None:
        """Get expected genesis hash for BTC network."""
        normalized = network.lower()
        if normalized == "mainnet":
            return "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"
        if normalized in {"testnet", "testnet3"}:
            return "000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943"
        if normalized == "testnet4":
            return "00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043"
        return None
