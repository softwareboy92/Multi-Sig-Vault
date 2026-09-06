"""Backup and restore data schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# Export schemas
class ExportRequest(BaseModel):
    """Request schema for exporting data."""

    include_wallets: bool = True
    wallet_ids: list[str] | None = None
    include_signers: bool = True
    signer_ids: list[str] | None = None
    include_networks: bool = True
    include_address_book: bool = True
    # Legacy aliases (mapped internally)
    include_evm_networks: bool = True
    include_btc_networks: bool = True


class BackupMetadata(BaseModel):
    """Metadata for backup file."""

    app_name: str
    app_version: str
    exported_by: str = "MultiVault"


class SignerBackup(BaseModel):
    """Signer data for backup."""

    id: str
    name: str
    device_type: str
    chain_type: str
    public_key: str | None = None
    address: str | None = None
    derivation_path: str | None = None
    master_fingerprint: str | None = None
    xpub: str | None = None
    status: str


class WalletSignerBackup(BaseModel):
    """Wallet signer relationship for backup."""

    signer_id: str
    order_index: int
    ledger_policy_hmac: str | None = None


class WalletBackup(BaseModel):
    """Wallet data for backup."""

    id: str
    name: str
    chain_type: str
    threshold: int
    signer_count: int
    address: str | None = None
    network_id: str | None = None
    # Legacy fields for backward compatibility (v1.x / v2.x)
    evm_network_id: str | None = None
    btc_network_id: str | None = None
    evm_chain_id: int | None = None
    btc_network: str | None = None
    status: str
    deployed_at: datetime | None = None
    salt: str | None = None
    deployment_tx_hash: str | None = None
    factory_address: str | None = None
    witness_script: str | None = None
    redeem_script: str | None = None
    signers: list[WalletSignerBackup] = Field(default_factory=list)


class EVMNetworkBackup(BaseModel):
    """EVM network data for backup."""

    id: str
    name: str
    chain_id: int
    is_testnet: bool
    enabled: bool
    explorer_url: str | None = None
    default_rpc_node_id: str | None = None


class EVMRpcNodeBackup(BaseModel):
    """EVM RPC node data for backup."""

    id: str
    network_id: str
    rpc_url: str
    priority: int
    enabled: bool
    is_healthy: bool | None = None


class BTCNetworkBackup(BaseModel):
    """BTC network data for backup."""

    id: str
    name: str
    network: str
    is_testnet: bool
    enabled: bool
    explorer_url: str | None = None
    default_node_id: str | None = None


class BTCNodeBackup(BaseModel):
    """BTC node data for backup."""

    id: str
    network_id: str
    host: str
    port: int
    ssl: bool
    priority: int
    enabled: bool
    is_healthy: bool | None = None


class AddressBookBackup(BaseModel):
    """Address book entry data for backup."""

    id: str
    name: str
    address: str
    chain_type: str
    btc_network: str | None = None
    note: str | None = None


# v3.0.0 unified network schemas
class NetworkBackup(BaseModel):
    """Unified network data for backup (v3)."""

    id: str
    chain_type: str
    name: str
    is_testnet: bool
    enabled: bool
    explorer_url: str | None = None
    default_node_id: str | None = None
    extra: str | None = None


class NetworkNodeBackup(BaseModel):
    """Unified network node data for backup (v3)."""

    id: str
    network_id: str
    node_type: str
    endpoint_url: str
    priority: int
    enabled: bool
    is_healthy: bool | None = None
    extra: str | None = None


class BackupData(BaseModel):
    """Container for all backup data."""

    signers: list[SignerBackup] = Field(default_factory=list)
    wallets: list[WalletBackup] = Field(default_factory=list)
    # v3 unified format
    networks: list[NetworkBackup] = Field(default_factory=list)
    network_nodes: list[NetworkNodeBackup] = Field(default_factory=list)
    # v2 legacy format (for backward-compatible import)
    evm_networks: list[EVMNetworkBackup] = Field(default_factory=list)
    evm_rpc_nodes: list[EVMRpcNodeBackup] = Field(default_factory=list)
    btc_networks: list[BTCNetworkBackup] = Field(default_factory=list)
    btc_nodes: list[BTCNodeBackup] = Field(default_factory=list)
    address_book: list[AddressBookBackup] = Field(default_factory=list)


class BackupFile(BaseModel):
    """Complete backup file structure."""

    version: str = "3.0.0"
    exported_at: datetime
    metadata: BackupMetadata
    data: BackupData


# Import schemas
class ImportRequest(BaseModel):
    """Request schema for importing data."""

    conflict_strategy: str = Field(
        default="skip",
        pattern="^(skip|replace|rename)$",
    )
    validate_only: bool = False


class ImportResult(BaseModel):
    """Result of import operation."""

    success: bool
    imported: dict[str, int] = Field(default_factory=dict)
    skipped: dict[str, int] = Field(default_factory=dict)
    replaced: dict[str, int] = Field(default_factory=dict)
    renamed: dict[str, int] = Field(default_factory=dict)
    errors: list[dict[str, Any]] = Field(default_factory=list)


class ValidationResult(BaseModel):
    """Result of backup file validation."""

    is_valid: bool
    version_compatible: bool
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    items_to_import: dict[str, int] = Field(default_factory=dict)
