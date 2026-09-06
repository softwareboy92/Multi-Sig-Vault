from datetime import UTC, datetime

import pytest

from multivault.models.network import NetworkConfig
from multivault.models.signer import ChainType, DeviceType, SignerStatus, Signer
from multivault.schemas.backup import (
    BackupData,
    BackupFile,
    BackupMetadata,
    EVMNetworkBackup,
    ImportRequest,
    SignerBackup,
    WalletBackup,
    WalletSignerBackup,
)
from multivault.services.backup_service import BackupService


@pytest.mark.asyncio
async def test_backup_import_wallets_remap_network_ids_when_defaults_exist(async_session):
    # Database already has a default EVM network with chain_id=11155111 but a different ID.
    db_network_id = "11111111-1111-1111-1111-111111111111"
    backup_network_id = "f86f049f-d5ff-43b0-9af6-6b5b177d8121"

    async_session.add(
        NetworkConfig(
            id=db_network_id,
            chain_type="EVM",
            name="Ethereum (Sepolia)",
            is_testnet=True,
            enabled=True,
            explorer_url="https://sepolia.etherscan.io",
            default_node_id=None,
            extra='{"chain_id": 11155111}',
        )
    )

    signer_id = "0fdcf904-dfc9-423b-bc54-3b189ee639d0"
    async_session.add(
        Signer(
            id=signer_id,
            name="MetaMask #1",
            device_type=DeviceType.METAMASK,
            chain_type=ChainType.EVM,
            public_key=None,
            address="0xf649104bf6ef002f311c76ab8d7f961d53316dd1",
            derivation_path=None,
            status=SignerStatus.VERIFIED,
        )
    )

    await async_session.commit()

    wallet_id = "cff7ee27-b28e-4c5d-818a-3ca01a119416"

    backup = BackupFile(
        exported_at=datetime.now(UTC),
        metadata=BackupMetadata(app_name="MultiVault", app_version="test"),
        data=BackupData(
            evm_networks=[
                EVMNetworkBackup(
                    id=backup_network_id,
                    name="Ethereum (Sepolia)",
                    chain_id=11155111,
                    is_testnet=True,
                    enabled=True,
                    explorer_url="https://sepolia.etherscan.io",
                    default_rpc_node_id=None,
                )
            ],
            signers=[
                SignerBackup(
                    id=signer_id,
                    name="MetaMask #1",
                    device_type="METAMASK",
                    chain_type="EVM",
                    public_key=None,
                    address="0xf649104bf6ef002f311c76ab8d7f961d53316dd1",
                    derivation_path=None,
                    master_fingerprint=None,
                    xpub=None,
                    status="VERIFIED",
                )
            ],
            wallets=[
                WalletBackup(
                    id=wallet_id,
                    name="ETH Vault - 1",
                    chain_type="EVM",
                    threshold=1,
                    signer_count=1,
                    address="0xc7aa5AaA9Db9864B4F75FC4F5EDe92CE23023Da9",
                    evm_network_id=backup_network_id,
                    btc_network_id=None,
                    evm_chain_id=None,
                    btc_network=None,
                    status="ACTIVE",
                    deployed_at=None,
                    salt=None,
                    deployment_tx_hash=None,
                    factory_address=None,
                    witness_script=None,
                    redeem_script=None,
                    signers=[
                        WalletSignerBackup(
                            signer_id=signer_id,
                            order_index=0,
                            ledger_policy_hmac=None,
                        )
                    ],
                )
            ],
        ),
    )

    service = BackupService(async_session)
    result = await service.import_data(backup, ImportRequest(conflict_strategy="skip", validate_only=False))

    assert result.success is True
    assert result.imported.get("wallets") == 1
