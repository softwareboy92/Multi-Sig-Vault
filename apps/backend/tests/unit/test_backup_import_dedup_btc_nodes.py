from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select

from multivault.schemas.backup import (
    BackupData,
    BackupFile,
    BackupMetadata,
    BTCNetworkBackup,
    BTCNodeBackup,
    ImportRequest,
)
from multivault.services.backup_service import BackupService
from multivault.models.network import NetworkConfig, NetworkNodeConfig


@pytest.mark.asyncio
async def test_backup_import_dedup_btc_nodes_by_endpoint(async_session):
    network_id = "net-1"
    node_1_id = "node-1"
    node_2_id = "node-2"

    backup = BackupFile(
        exported_at=datetime.now(UTC),
        metadata=BackupMetadata(app_name="MultiVault", app_version="test"),
        data=BackupData(
            btc_networks=[
                BTCNetworkBackup(
                    id=network_id,
                    name="Bitcoin Testnet4",
                    network="testnet4",
                    is_testnet=True,
                    enabled=True,
                    explorer_url=None,
                    default_node_id=node_1_id,
                )
            ],
            btc_nodes=[
                BTCNodeBackup(
                    id=node_1_id,
                    network_id=network_id,
                    host="electrum.example.com",
                    port=51002,
                    ssl=True,
                    priority=100,
                    enabled=True,
                    is_healthy=True,
                ),
                # Same endpoint, different ID (should be deduped)
                BTCNodeBackup(
                    id=node_2_id,
                    network_id=network_id,
                    host="electrum.example.com",
                    port=51002,
                    ssl=True,
                    priority=200,
                    enabled=True,
                    is_healthy=True,
                ),
            ],
        ),
    )

    service = BackupService(async_session)
    result = await service.import_data(backup, ImportRequest(conflict_strategy="skip", validate_only=False))

    assert result.success is True
    assert result.imported.get("network_nodes") == 1
    assert result.skipped.get("network_nodes") == 1

    count_result = await async_session.execute(select(func.count()).select_from(NetworkNodeConfig))
    assert count_result.scalar_one() == 1

    net_result = await async_session.execute(
        select(NetworkConfig).where(NetworkConfig.name == "Bitcoin Testnet4")
    )
    network = net_result.scalar_one()
    assert network.default_node_id is not None
