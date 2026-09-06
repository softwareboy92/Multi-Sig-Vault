"""Backup and restore service.

Supports v3 (unified network model) for export and import, with backward-
compatible import of v1/v2 per-chain backup files.
"""

import json
import structlog
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from multivault.config import get_settings
from multivault.errors.exceptions import ValidationError
from multivault.models.address_book import AddressBookEntry
from multivault.models.network import (
    NetworkConfig,
    NetworkNodeConfig,
    build_electrum_url,
)
from multivault.models.signer import Signer
from multivault.models.wallet import Wallet, WalletSigner
from multivault.utils.extra import get_extra, set_extra
from multivault.schemas.backup import (
    AddressBookBackup,
    BackupData,
    BackupFile,
    BackupMetadata,
    ExportRequest,
    ImportRequest,
    ImportResult,
    NetworkBackup,
    NetworkNodeBackup,
    SignerBackup,
    ValidationResult,
    WalletBackup,
    WalletSignerBackup,
)

logger = structlog.get_logger()


# ---------------------------------------------------------------------------
# v2 → v3 conversion helper
# ---------------------------------------------------------------------------

def _convert_v2_to_v3(data: BackupData) -> None:
    """Convert v2 legacy backup data to v3 unified format in-place.

    If ``data.networks`` is already populated (v3 format), this is a no-op.
    Otherwise, creates unified :class:`NetworkBackup` / :class:`NetworkNodeBackup`
    entries from the legacy per-chain lists and maps wallet network IDs.
    """
    if data.networks:
        return  # Already v3

    # Convert EVM networks
    for n in data.evm_networks:
        data.networks.append(NetworkBackup(
            id=n.id,
            chain_type="EVM",
            name=n.name,
            is_testnet=n.is_testnet,
            enabled=n.enabled,
            explorer_url=n.explorer_url,
            default_node_id=n.default_rpc_node_id,
            extra=json.dumps({"chain_id": n.chain_id}),
        ))

    # Convert BTC networks
    for n in data.btc_networks:
        data.networks.append(NetworkBackup(
            id=n.id,
            chain_type="BTC",
            name=n.name,
            is_testnet=n.is_testnet,
            enabled=n.enabled,
            explorer_url=n.explorer_url,
            default_node_id=n.default_node_id,
            extra=json.dumps({"btc_network": n.network}),
        ))

    # Convert EVM RPC nodes
    for n in data.evm_rpc_nodes:
        data.network_nodes.append(NetworkNodeBackup(
            id=n.id,
            network_id=n.network_id,
            node_type="JSON_RPC",
            endpoint_url=n.rpc_url,
            priority=n.priority,
            enabled=n.enabled,
            is_healthy=n.is_healthy,
        ))

    # Convert BTC nodes
    for n in data.btc_nodes:
        data.network_nodes.append(NetworkNodeBackup(
            id=n.id,
            network_id=n.network_id,
            node_type="ELECTRUM",
            endpoint_url=build_electrum_url(n.host, n.port, n.ssl),
            priority=n.priority,
            enabled=n.enabled,
            is_healthy=n.is_healthy,
        ))

    # Map v2 dual wallet FKs → unified network_id
    for w in data.wallets:
        if not w.network_id:
            w.network_id = w.evm_network_id or w.btc_network_id


class BackupService:
    """Service for backup and restore operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def export_data(self, request: ExportRequest) -> BackupFile:
        """Export data to backup file (v3 unified format)."""
        data = BackupData()

        if request.include_signers:
            data.signers = await self._export_signers(request.signer_ids)

        if request.include_wallets:
            data.wallets = await self._export_wallets(request.wallet_ids)

        if request.include_networks:
            data.networks = await self._export_networks()
            data.network_nodes = await self._export_network_nodes()

        if request.include_address_book:
            data.address_book = await self._export_address_book()

        settings = get_settings()
        metadata = BackupMetadata(
            app_name=settings.app_name,
            app_version=settings.app_version,
        )

        return BackupFile(
            exported_at=datetime.now(UTC),
            metadata=metadata,
            data=data,
        )

    async def validate_backup(self, backup: BackupFile) -> ValidationResult:
        """Validate backup file (accepts v1/v2/v3)."""
        result = ValidationResult(is_valid=True, version_compatible=True)

        if not (
            backup.version.startswith("1.")
            or backup.version.startswith("2.")
            or backup.version.startswith("3.")
        ):
            result.version_compatible = False
            result.errors.append(f"Unsupported version: {backup.version}")
            result.is_valid = False
            return result

        # Normalise v2 → v3 so counts and validation are consistent
        _convert_v2_to_v3(backup.data)

        result.items_to_import = {
            "signers": len(backup.data.signers),
            "wallets": len(backup.data.wallets),
            "networks": len(backup.data.networks),
            "network_nodes": len(backup.data.network_nodes),
            "address_book": len(backup.data.address_book),
        }

        await self._validate_references(backup, result)

        return result

    async def import_data(
        self,
        backup: BackupFile,
        request: ImportRequest,
    ) -> ImportResult:
        """Import data from backup file (v1/v2/v3 compatible)."""
        result = ImportResult(
            success=True,
            imported={},
            skipped={},
            replaced={},
            renamed={},
        )

        # Validate (also normalises v2 → v3 internally)
        validation = await self.validate_backup(backup)
        if not validation.is_valid:
            raise ValidationError(
                message="Invalid backup file",
                details={"errors": validation.errors},
            )

        if request.validate_only:
            return result

        try:
            logger.info("import_started", data_counts={
                "signers": len(backup.data.signers),
                "wallets": len(backup.data.wallets),
                "networks": len(backup.data.networks),
                "network_nodes": len(backup.data.network_nodes),
                "address_book": len(backup.data.address_book),
            })
            
            # ---- 1. Networks (no dependencies) ----
            net_stats = await self._import_networks(
                backup.data.networks, request.conflict_strategy
            )
            result.imported["networks"] = net_stats[0]
            result.skipped["networks"] = net_stats[1]
            result.replaced["networks"] = net_stats[2]
            result.renamed["networks"] = net_stats[3]

            await self.db.flush()

            # Build network ID map (backup.id → db.id)
            network_id_map: dict[str, str] = {}
            for net in backup.data.networks:
                existing = await self._find_existing_network(net)
                if existing:
                    network_id_map[net.id] = existing.id

            # Remap node.network_id
            if network_id_map:
                for node in backup.data.network_nodes:
                    mapped = network_id_map.get(node.network_id)
                    if mapped and node.network_id != mapped:
                        node.network_id = mapped

            logger.info("networks_imported", count=result.imported["networks"])

            # ---- 2. Nodes (depend on networks) ----
            node_stats = await self._import_network_nodes(
                backup.data.network_nodes, request.conflict_strategy
            )
            result.imported["network_nodes"] = node_stats[0]
            result.skipped["network_nodes"] = node_stats[1]
            result.replaced["network_nodes"] = node_stats[2]
            result.renamed["network_nodes"] = node_stats[3]
            
            await self.db.flush()

            # Build node ID map and restore default_node_id on networks
            node_id_map: dict[str, str] = {}
            for node in backup.data.network_nodes:
                stmt = select(NetworkNodeConfig).where(
                    NetworkNodeConfig.network_id == node.network_id,
                    NetworkNodeConfig.endpoint_url == node.endpoint_url,
                )
                node_result = await self.db.execute(
                    stmt.order_by(
                        NetworkNodeConfig.updated_at.desc(),
                        NetworkNodeConfig.created_at.desc(),
                        NetworkNodeConfig.id.desc(),
                    ).limit(2)
                )
                matches = node_result.scalars().all()
                if not matches:
                    continue
                if len(matches) > 1:
                    logger.warning(
                        "node_endpoint_duplicate",
                        network_id=node.network_id,
                        endpoint_url=node.endpoint_url,
                        matches=len(matches),
                    )
                node_id_map[node.id] = matches[0].id

            for net in backup.data.networks:
                if not net.default_node_id:
                    continue
                mapped_node_id = node_id_map.get(net.default_node_id)
                if not mapped_node_id:
                    continue
                existing_net = await self._find_existing_network(net)
                if existing_net:
                    existing_net.default_node_id = mapped_node_id

            # Remap wallet network_id
            if network_id_map:
                for wallet in backup.data.wallets:
                    if wallet.network_id:
                        mapped = network_id_map.get(wallet.network_id)
                        if mapped and wallet.network_id != mapped:
                            wallet.network_id = mapped

            # ---- 3. Signers (no dependencies) ----
            signer_stats = await self._import_signers(
                backup.data.signers, request.conflict_strategy
            )
            result.imported["signers"] = signer_stats[0]
            result.skipped["signers"] = signer_stats[1]
            result.replaced["signers"] = signer_stats[2]
            result.renamed["signers"] = signer_stats[3]
            signer_id_map: dict[str, str] = signer_stats[4]
            
            await self.db.flush()
            logger.info("signers_imported", count=result.imported["signers"])

            # Remap wallet signer references using signer ID map
            if signer_id_map:
                for wallet in backup.data.wallets:
                    for ws in wallet.signers:
                        mapped = signer_id_map.get(ws.signer_id)
                        if mapped and ws.signer_id != mapped:
                            ws.signer_id = mapped

            # 4. Wallets (depend on signers)
            wallet_stats = await self._import_wallets(
                backup.data.wallets, request.conflict_strategy
            )
            result.imported["wallets"] = wallet_stats[0]
            result.skipped["wallets"] = wallet_stats[1]
            result.replaced["wallets"] = wallet_stats[2]
            result.renamed["wallets"] = wallet_stats[3]
            
            await self.db.flush()
            logger.info("wallets_imported", count=result.imported["wallets"])

            # 5. Address book (no dependencies)
            addr_stats = await self._import_address_book(
                backup.data.address_book, request.conflict_strategy
            )
            result.imported["address_book"] = addr_stats[0]
            result.skipped["address_book"] = addr_stats[1]
            result.replaced["address_book"] = addr_stats[2]
            result.renamed["address_book"] = addr_stats[3]
            
            await self.db.flush()
            logger.info("address_book_imported", count=result.imported["address_book"])

            await self.db.commit()
            logger.info("import_committed", total_imported=result.imported)

        except Exception as e:
            await self.db.rollback()
            result.success = False
            result.errors.append({"error": str(e)})
            raise

        return result

    # ------------------------------------------------------------------
    # Network lookup helper
    # ------------------------------------------------------------------

    async def _find_existing_network(self, net: NetworkBackup) -> NetworkConfig | None:
        """Find an existing network matching a backup entry.

        Search order:
        1. Exact ID match
        2. ``(chain_type, name)`` UNIQUE constraint match
        3. Chain-specific natural key (``chain_id`` for EVM, ``btc_network`` for BTC)
        """
        existing = await self.db.get(NetworkConfig, net.id)
        if existing:
            return existing

        stmt = select(NetworkConfig).where(
            NetworkConfig.chain_type == net.chain_type,
            NetworkConfig.name == net.name,
        )
        res = await self.db.execute(stmt)
        existing = res.scalar_one_or_none()
        if existing:
            return existing

        # Chain-specific natural key fallback (for v2 imports where names
        # might differ between source and target)
        if net.extra:
            extra = json.loads(net.extra)
            if net.chain_type == "EVM" and "chain_id" in extra:
                stmt = select(NetworkConfig).where(NetworkConfig.chain_type == "EVM")
                res = await self.db.execute(stmt)
                for n in res.scalars().all():
                    n_extra = json.loads(n.extra or "{}")
                    if n_extra.get("chain_id") == extra["chain_id"]:
                        return n
            elif net.chain_type == "BTC" and "btc_network" in extra:
                stmt = select(NetworkConfig).where(NetworkConfig.chain_type == "BTC")
                res = await self.db.execute(stmt)
                for n in res.scalars().all():
                    n_extra = json.loads(n.extra or "{}")
                    if n_extra.get("btc_network") == extra["btc_network"]:
                        return n

        return None

    # Export methods
    async def _export_signers(self, signer_ids: list[str] | None) -> list[SignerBackup]:
        """Export signers."""
        stmt = select(Signer).where(Signer.deleted_at.is_(None))
        if signer_ids:
            stmt = stmt.where(Signer.id.in_(signer_ids))

        result = await self.db.execute(stmt)
        signers = result.scalars().all()

        return [
            SignerBackup(
                id=s.id,
                name=s.name,
                device_type=s.device_type.value if hasattr(s.device_type, 'value') else s.device_type,
                chain_type=s.chain_type.value if hasattr(s.chain_type, 'value') else s.chain_type,
                public_key=s.public_key,
                address=s.address,
                derivation_path=s.derivation_path,
                master_fingerprint=get_extra(s).get("master_fingerprint"),
                xpub=get_extra(s).get("xpub"),
                status=s.status.value if hasattr(s.status, 'value') else s.status,
            )
            for s in signers
        ]

    async def _export_wallets(self, wallet_ids: list[str] | None) -> list[WalletBackup]:
        """Export wallets with their signers."""
        # Include all wallets (including ARCHIVED) — backup should preserve everything
        stmt = select(Wallet)
        if wallet_ids:
            stmt = stmt.where(Wallet.id.in_(wallet_ids))

        result = await self.db.execute(stmt)
        wallets = result.scalars().all()

        wallet_backups = []
        for w in wallets:
            # Get wallet signers
            ws_stmt = (
                select(WalletSigner)
                .where(WalletSigner.wallet_id == w.id)
                .order_by(WalletSigner.order_index)
            )
            ws_result = await self.db.execute(ws_stmt)
            wallet_signers = ws_result.scalars().all()

            w_extra = get_extra(w)
            wallet_backups.append(
                WalletBackup(
                    id=w.id,
                    name=w.name,
                    chain_type=w.chain_type.value if hasattr(w.chain_type, 'value') else w.chain_type,
                    threshold=w.threshold,
                    signer_count=w.signer_count,
                    address=w.address,
                    network_id=w.network_id,
                    status=w.status.value if hasattr(w.status, 'value') else w.status,
                    deployed_at=w.deployed_at,
                    salt=w_extra.get("salt"),
                    deployment_tx_hash=w_extra.get("deployment_tx_hash"),
                    factory_address=w_extra.get("factory_address"),
                    witness_script=w_extra.get("witness_script"),
                    redeem_script=w_extra.get("redeem_script"),
                    signers=[
                        WalletSignerBackup(
                            signer_id=ws.signer_id,
                            order_index=ws.order_index,
                            ledger_policy_hmac=get_extra(ws).get("ledger_policy_hmac"),
                        )
                        for ws in wallet_signers
                    ],
                )
            )

        return wallet_backups

    async def _export_networks(self) -> list[NetworkBackup]:
        """Export all networks (unified)."""
        stmt = select(NetworkConfig)
        result = await self.db.execute(stmt)
        networks = result.scalars().all()

        return [
            NetworkBackup(
                id=n.id,
                chain_type=n.chain_type,
                name=n.name,
                is_testnet=n.is_testnet,
                enabled=n.enabled,
                explorer_url=n.explorer_url,
                default_node_id=n.default_node_id,
                extra=n.extra,
            )
            for n in networks
        ]

    async def _export_network_nodes(self) -> list[NetworkNodeBackup]:
        """Export all network nodes (unified)."""
        stmt = select(NetworkNodeConfig)
        result = await self.db.execute(stmt)
        nodes = result.scalars().all()

        return [
            NetworkNodeBackup(
                id=n.id,
                network_id=n.network_id,
                node_type=n.node_type,
                endpoint_url=n.endpoint_url,
                priority=n.priority,
                enabled=n.enabled,
                is_healthy=n.is_healthy,
                extra=n.extra,
            )
            for n in nodes
        ]

    async def _export_address_book(self) -> list[AddressBookBackup]:
        """Export address book entries."""
        stmt = select(AddressBookEntry)
        result = await self.db.execute(stmt)
        entries = result.scalars().all()

        return [
            AddressBookBackup(
                id=e.id,
                name=e.name,
                address=e.address,
                chain_type=e.chain_type.value if hasattr(e.chain_type, 'value') else e.chain_type,
                btc_network=e.btc_network,
                note=e.note,
            )
            for e in entries
        ]

    # Import methods
    async def _import_networks(
        self, networks: list[NetworkBackup], strategy: str
    ) -> tuple[int, int, int, int]:
        """Import networks (unified). Returns (imported, skipped, replaced, renamed)."""
        imported = skipped = replaced = renamed = 0
        for net in networks:
            existing = await self._find_existing_network(net)
            if existing:
                if strategy == "skip":
                    skipped += 1
                    continue
                elif strategy in {"replace", "rename"}:
                    existing.chain_type = net.chain_type
                    existing.name = net.name
                    existing.is_testnet = net.is_testnet
                    existing.enabled = net.enabled
                    existing.explorer_url = net.explorer_url
                    existing.extra = net.extra
                    existing.default_node_id = None
                    replaced += 1
            else:
                new_net = NetworkConfig(
                    id=net.id,
                    chain_type=net.chain_type,
                    name=net.name,
                    is_testnet=net.is_testnet,
                    enabled=net.enabled,
                    explorer_url=net.explorer_url,
                    extra=net.extra,
                    default_node_id=None,
                )
                self.db.add(new_net)
                imported += 1

        return imported, skipped, replaced, renamed

    async def _import_network_nodes(
        self, nodes: list[NetworkNodeBackup], strategy: str
    ) -> tuple[int, int, int, int]:
        """Import network nodes (unified). Returns (imported, skipped, replaced, renamed).

        De-duplicates within the same import run by ``(network_id, endpoint_url)``
        to avoid UNIQUE constraint violations on flush.
        """
        imported = skipped = replaced = renamed = 0

        seen_endpoints: dict[tuple[str, str], NetworkNodeConfig] = {}
        for node in nodes:
            endpoint_key = (node.network_id, node.endpoint_url)
            existing = seen_endpoints.get(endpoint_key)

            if not existing:
                existing = await self.db.get(NetworkNodeConfig, node.id)
                if not existing:
                    stmt = (
                        select(NetworkNodeConfig)
                        .where(
                            NetworkNodeConfig.network_id == node.network_id,
                            NetworkNodeConfig.endpoint_url == node.endpoint_url,
                        )
                        .limit(1)
                    )
                    result = await self.db.execute(stmt)
                    existing = result.scalar_one_or_none()

                if existing:
                    seen_endpoints[endpoint_key] = existing

            if existing:
                if strategy == "skip":
                    skipped += 1
                    continue
                elif strategy == "replace":
                    existing.network_id = node.network_id
                    existing.node_type = node.node_type
                    existing.endpoint_url = node.endpoint_url
                    existing.priority = node.priority
                    existing.enabled = node.enabled
                    existing.is_healthy = node.is_healthy
                    existing.extra = node.extra
                    replaced += 1
                elif strategy == "rename":
                    logger.warning(
                        "node_conflict_rename_ignored",
                        node_id=node.id,
                        network_id=node.network_id,
                        endpoint_url=node.endpoint_url,
                    )
                    skipped += 1
            else:
                new_node = NetworkNodeConfig(
                    id=node.id,
                    network_id=node.network_id,
                    node_type=node.node_type,
                    endpoint_url=node.endpoint_url,
                    priority=node.priority,
                    enabled=node.enabled,
                    is_healthy=node.is_healthy,
                    extra=node.extra,
                )
                self.db.add(new_node)
                seen_endpoints[endpoint_key] = new_node
                imported += 1

        return imported, skipped, replaced, renamed

    async def _import_signers(
        self, signers: list[SignerBackup], strategy: str
    ) -> tuple[int, int, int, int, dict[str, str]]:
        """Import signers. Returns (imported, skipped, replaced, renamed, id_map).

        Detects existing signers by ID first, then by natural key
        ``(chain_type, address)`` to avoid UNIQUE constraint violations when
        importing backups from different installations (different IDs, same
        signer).

        ``id_map`` maps backup signer IDs to DB signer IDs for downstream
        wallet-signer relationship remapping.
        """
        from multivault.models.signer import DeviceType, SignerStatus

        logger.info("importing_signers", count=len(signers), strategy=strategy)
        imported = skipped = replaced = renamed = 0
        signer_id_map: dict[str, str] = {}  # backup_id → db_id
        for sig in signers:
            existing = await self.db.get(Signer, sig.id)
            if existing and existing.deleted_at:
                existing = None  # treat soft-deleted as absent

            # Fallback: check by natural key (chain_type + address) to avoid
            # UNIQUE constraint violations across installations.
            matched_by_natural_key = False
            if not existing and sig.address:
                stmt = select(Signer).where(
                    Signer.chain_type == sig.chain_type,
                    Signer.address == sig.address,
                    Signer.deleted_at.is_(None),
                )
                res = await self.db.execute(stmt)
                existing = res.scalar_one_or_none()
                if existing:
                    matched_by_natural_key = True

            if existing:
                # Record the mapping from backup ID → DB ID
                signer_id_map[sig.id] = existing.id
                if strategy == "skip":
                    logger.debug("skipping_existing_signer", signer_id=sig.id)
                    skipped += 1
                    continue
                elif strategy == "replace":
                    existing.name = sig.name
                    existing.device_type = DeviceType(sig.device_type)
                    existing.public_key = sig.public_key
                    existing.address = sig.address
                    existing.derivation_path = sig.derivation_path
                    set_extra(
                        existing,
                        master_fingerprint=sig.master_fingerprint,
                        xpub=sig.xpub,
                    )
                    existing.status = SignerStatus(sig.status)
                    replaced += 1
                elif strategy == "rename":
                    if matched_by_natural_key:
                        # Can't duplicate a signer with the same address
                        # (UNIQUE constraint), fall back to skip.
                        logger.debug(
                            "rename_skipped_natural_key_match",
                            signer_id=sig.id,
                            address=sig.address,
                        )
                        skipped += 1
                    else:
                        from multivault.models.signer import ChainType
                        sig.id = f"{sig.id}_{datetime.now().timestamp()}"
                        renamed_sig = Signer(
                            id=sig.id,
                            name=sig.name,
                            device_type=DeviceType(sig.device_type),
                            chain_type=ChainType(sig.chain_type),
                            public_key=sig.public_key,
                            address=sig.address,
                            derivation_path=sig.derivation_path,
                            status=SignerStatus(sig.status),
                        )
                        set_extra(
                            renamed_sig,
                            master_fingerprint=sig.master_fingerprint,
                            xpub=sig.xpub,
                        )
                        self.db.add(renamed_sig)
                        renamed += 1
            else:
                from multivault.models.signer import ChainType

                new_sig = Signer(
                    id=sig.id,
                    name=sig.name,
                    device_type=DeviceType(sig.device_type),
                    chain_type=ChainType(sig.chain_type),
                    public_key=sig.public_key,
                    address=sig.address,
                    derivation_path=sig.derivation_path,
                    status=SignerStatus(sig.status),
                )
                set_extra(
                    new_sig,
                    master_fingerprint=sig.master_fingerprint,
                    xpub=sig.xpub,
                )
                self.db.add(new_sig)
                signer_id_map[sig.id] = sig.id  # same ID for new signers
                logger.debug("added_new_signer", signer_id=sig.id, name=sig.name)
                imported += 1

        logger.info("signers_import_complete", imported=imported, skipped=skipped, replaced=replaced, renamed=renamed)
        return imported, skipped, replaced, renamed, signer_id_map

    async def _import_wallets(
        self, wallets: list[WalletBackup], strategy: str
    ) -> tuple[int, int, int, int]:
        """Import wallets with their signers. Returns (imported, skipped, replaced, renamed).

        Handles v1 (``evm_chain_id`` / ``btc_network``), v2 (``evm_network_id`` /
        ``btc_network_id``), and v3 (``network_id``) wallet schemas.
        """
        from multivault.models.signer import ChainType
        from multivault.models.wallet import WalletStatus

        imported = skipped = replaced = renamed = 0
        for wal in wallets:
            # --- v1 backward compat: resolve chain-specific identifiers ---
            if not wal.network_id and wal.evm_chain_id:
                stmt = select(NetworkConfig).where(NetworkConfig.chain_type == "EVM")
                res = await self.db.execute(stmt)
                for net in res.scalars().all():
                    n_extra = json.loads(net.extra or "{}")
                    if n_extra.get("chain_id") == wal.evm_chain_id:
                        wal.network_id = net.id
                        break
                if not wal.network_id:
                    logger.warning(
                        "evm_chain_id_not_found",
                        wallet_id=wal.id,
                        evm_chain_id=wal.evm_chain_id,
                    )
                    skipped += 1
                    continue

            if not wal.network_id and wal.btc_network:
                stmt = select(NetworkConfig).where(NetworkConfig.chain_type == "BTC")
                res = await self.db.execute(stmt)
                for net in res.scalars().all():
                    n_extra = json.loads(net.extra or "{}")
                    if n_extra.get("btc_network") == wal.btc_network:
                        wal.network_id = net.id
                        break
                if not wal.network_id:
                    logger.warning(
                        "btc_network_not_found",
                        wallet_id=wal.id,
                        btc_network=wal.btc_network,
                    )
                    skipped += 1
                    continue

            # Validate unified network_id
            if wal.network_id:
                network_exists = await self.db.get(NetworkConfig, wal.network_id)
                if not network_exists:
                    logger.warning(
                        "network_id_invalid",
                        wallet_id=wal.id,
                        network_id=wal.network_id,
                    )
                    skipped += 1
                    continue

            existing = await self.db.get(Wallet, wal.id)
            if existing and existing.deleted_at:
                existing = None

            # Fallback: check by address (cross-installation import)
            if not existing and wal.address:
                stmt = select(Wallet).where(
                    Wallet.address == wal.address,
                    Wallet.deleted_at.is_(None),
                )
                res = await self.db.execute(stmt)
                existing = res.scalar_one_or_none()

            if existing:
                incoming_status = WalletStatus(wal.status)

                if strategy == "skip":
                    # Non-destructive merge: fill missing fields only.
                    # This makes backup import idempotent and avoids losing wallet
                    # addresses/deployment metadata when the wallet record already
                    # exists locally.
                    changed = False

                    if existing.address is None and wal.address:
                        existing.address = wal.address
                        changed = True
                    if existing.deployed_at is None and wal.deployed_at:
                        existing.deployed_at = wal.deployed_at
                        changed = True

                    # Merge chain-specific fields into extra JSON
                    ex = get_extra(existing)
                    for key in ("salt", "deployment_tx_hash", "factory_address",
                                "witness_script", "redeem_script"):
                        wal_val = getattr(wal, key, None)
                        if ex.get(key) is None and wal_val:
                            set_extra(existing, **{key: wal_val})
                            changed = True

                    # Promote status only when it is a monotonic improvement.
                    if existing.status == WalletStatus.PENDING_DEPLOY and incoming_status == WalletStatus.ACTIVE:
                        existing.status = incoming_status
                        changed = True

                    if changed:
                        logger.info(
                            "wallet_merged_from_backup",
                            wallet_id=wal.id,
                            name=wal.name,
                        )
                        replaced += 1
                    else:
                        skipped += 1
                    continue

                # Replace/rename not fully supported for wallets due to relationship complexity.
                # For now, behave as skip.
                skipped += 1
                continue

            # Create new wallet
            new_wal = Wallet(
                id=wal.id,
                name=wal.name,
                chain_type=ChainType(wal.chain_type),
                threshold=wal.threshold,
                signer_count=wal.signer_count,
                address=wal.address,
                network_id=wal.network_id,
                status=WalletStatus(wal.status),
                deployed_at=wal.deployed_at,
            )
            # Store chain-specific fields in extra JSON
            set_extra(
                new_wal,
                salt=wal.salt,
                deployment_tx_hash=wal.deployment_tx_hash,
                factory_address=wal.factory_address,
                witness_script=wal.witness_script,
                redeem_script=wal.redeem_script,
            )
            self.db.add(new_wal)

            # Add wallet signers
            for ws in wal.signers:
                # Verify signer exists
                signer_exists = await self.db.get(Signer, ws.signer_id)
                if not signer_exists:
                    continue

                new_ws = WalletSigner(
                    wallet_id=wal.id,
                    signer_id=ws.signer_id,
                    order_index=ws.order_index,
                )
                if ws.ledger_policy_hmac:
                    set_extra(new_ws, ledger_policy_hmac=ws.ledger_policy_hmac)
                self.db.add(new_ws)

            imported += 1

        return imported, skipped, replaced, renamed

    async def _import_address_book(
        self, entries: list[AddressBookBackup], strategy: str
    ) -> tuple[int, int, int, int]:
        """Import address book entries. Returns (imported, skipped, replaced, renamed)."""
        from multivault.models.signer import ChainType

        imported = skipped = replaced = renamed = 0
        for entry in entries:
            existing = await self.db.get(AddressBookEntry, entry.id)
            if existing:
                if strategy == "skip":
                    skipped += 1
                    continue
                elif strategy == "replace":
                    existing.name = entry.name
                    existing.address = entry.address
                    existing.chain_type = ChainType(entry.chain_type)
                    existing.btc_network = entry.btc_network
                    existing.note = entry.note
                    replaced += 1
                elif strategy == "rename":
                    entry.id = f"{entry.id}_{datetime.now().timestamp()}"
                    renamed_entry = AddressBookEntry(
                        id=entry.id,
                        name=entry.name,
                        address=entry.address,
                        chain_type=ChainType(entry.chain_type),
                        btc_network=entry.btc_network,
                        note=entry.note,
                    )
                    self.db.add(renamed_entry)
                    renamed += 1
            else:
                new_entry = AddressBookEntry(
                    id=entry.id,
                    name=entry.name,
                    address=entry.address,
                    chain_type=ChainType(entry.chain_type),
                    btc_network=entry.btc_network,
                    note=entry.note,
                )
                self.db.add(new_entry)
                imported += 1

        return imported, skipped, replaced, renamed

    async def _validate_references(
        self, backup: BackupFile, result: ValidationResult
    ) -> None:
        """Validate foreign key references in backup data."""
        # Collect IDs
        signer_ids = {s.id for s in backup.data.signers}
        network_ids = {n.id for n in backup.data.networks}

        # Check wallet signer references
        for wallet in backup.data.wallets:
            for ws in wallet.signers:
                if ws.signer_id not in signer_ids:
                    existing = await self.db.get(Signer, ws.signer_id)
                    if not existing:
                        result.warnings.append(
                            f"Wallet '{wallet.name}' references missing signer: {ws.signer_id}"
                        )

        # Check node → network references
        for node in backup.data.network_nodes:
            if node.network_id not in network_ids:
                existing = await self.db.get(NetworkConfig, node.network_id)
                if not existing:
                    result.warnings.append(
                        f"Node references missing network: {node.network_id}"
                    )

        # Check wallet → network references
        for wallet in backup.data.wallets:
            if wallet.network_id:
                if wallet.network_id not in network_ids:
                    existing = await self.db.get(NetworkConfig, wallet.network_id)
                    if not existing:
                        result.warnings.append(
                            f"Wallet '{wallet.name}' references missing network: {wallet.network_id}"
                        )
