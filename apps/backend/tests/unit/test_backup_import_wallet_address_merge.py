from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from multivault.models.network import NetworkConfig
from multivault.models.signer import ChainType, DeviceType, SignerStatus, Signer
from multivault.models.wallet import Wallet, WalletSigner, WalletStatus
from multivault.schemas.backup import (
    BackupData,
    BackupFile,
    BackupMetadata,
    BTCNetworkBackup,
    ImportRequest,
    SignerBackup,
    WalletBackup,
    WalletSignerBackup,
)
from multivault.services.backup_service import BackupService


@pytest.mark.asyncio
async def test_backup_import_merges_wallet_address_on_skip(async_session):
    network_id = "8e1d4249-9d30-461d-bd01-0c19222c7343"
    wallet_id = "1286a6d6-4d92-4df0-96e5-a8fde5105336"
    signer_1_id = "51baa72e-a2f1-4d44-8104-ce241b5bea37"
    signer_2_id = "a17f167f-6f76-49ec-9ae0-35e88e13a862"

    # Pre-create network + signers + wallet without address
    async_session.add(
        NetworkConfig(
            id=network_id,
            chain_type="BTC",
            name="Testnet3",
            explorer_url=None,
            enabled=True,
            is_testnet=True,
            default_node_id=None,
            extra='{"btc_network": "testnet3"}',
        )
    )

    async_session.add_all(
        [
            Signer(
                id=signer_1_id,
                name="S1",
                device_type=DeviceType.METAMASK,
                chain_type=ChainType.BTC,
                public_key="02" + "11" * 32,
                address=None,
                derivation_path=None,
                status=SignerStatus.VERIFIED,
            ),
            Signer(
                id=signer_2_id,
                name="S2",
                device_type=DeviceType.METAMASK,
                chain_type=ChainType.BTC,
                public_key="02" + "22" * 32,
                address=None,
                derivation_path=None,
                status=SignerStatus.VERIFIED,
            ),
        ]
    )

    existing_wallet = Wallet(
        id=wallet_id,
        name="BTC Vault",
        chain_type=ChainType.BTC,
        threshold=2,
        signer_count=2,
        address=None,
        network_id=network_id,
        status=WalletStatus.PENDING_DEPLOY,
        deployed_at=None,
        deleted_at=None,
    )
    async_session.add(existing_wallet)
    async_session.add_all(
        [
            WalletSigner(wallet_id=wallet_id, signer_id=signer_1_id, order_index=0),
            WalletSigner(wallet_id=wallet_id, signer_id=signer_2_id, order_index=1),
        ]
    )
    await async_session.commit()

    backup = BackupFile(
        exported_at=datetime.now(UTC),
        metadata=BackupMetadata(app_name="MultiVault", app_version="test"),
        data=BackupData(
            btc_networks=[
                BTCNetworkBackup(
                    id=network_id,
                    name="Testnet3",
                    network="testnet3",
                    is_testnet=True,
                    enabled=True,
                    explorer_url=None,
                    default_node_id=None,
                )
            ],
            signers=[
                SignerBackup(
                    id=signer_1_id,
                    name="S1",
                    device_type="METAMASK",
                    chain_type="BTC",
                    public_key="02" + "11" * 32,
                    address=None,
                    derivation_path=None,
                    master_fingerprint=None,
                    xpub=None,
                    status="VERIFIED",
                ),
                SignerBackup(
                    id=signer_2_id,
                    name="S2",
                    device_type="METAMASK",
                    chain_type="BTC",
                    public_key="02" + "22" * 32,
                    address=None,
                    derivation_path=None,
                    master_fingerprint=None,
                    xpub=None,
                    status="VERIFIED",
                ),
            ],
            wallets=[
                WalletBackup(
                    id=wallet_id,
                    name="BTC Vault",
                    chain_type="BTC",
                    threshold=2,
                    signer_count=2,
                    address="tb1qexampleaddress",
                    evm_network_id=None,
                    btc_network_id=network_id,
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
                        WalletSignerBackup(signer_id=signer_1_id, order_index=0, ledger_policy_hmac=None),
                        WalletSignerBackup(signer_id=signer_2_id, order_index=1, ledger_policy_hmac=None),
                    ],
                )
            ],
        ),
    )

    service = BackupService(async_session)
    result = await service.import_data(backup, ImportRequest(conflict_strategy="skip", validate_only=False))

    assert result.success is True
    assert result.replaced.get("wallets") == 1

    refreshed = (await async_session.execute(select(Wallet).where(Wallet.id == wallet_id))).scalar_one()
    assert refreshed.address == "tb1qexampleaddress"
    assert refreshed.status == WalletStatus.ACTIVE
