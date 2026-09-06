"""Wallet request/response schemas."""

import json
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from multivault.models.signer import ChainType
from multivault.models.wallet import WalletStatus


# =============================================================================
# Wallet Signer Schemas
# =============================================================================


class WalletSignerInfo(BaseModel):
    """Signer info within wallet context."""

    id: str
    name: str
    device_type: str
    address: str | None = None
    public_key: str | None = None
    order_index: int

    model_config = {"from_attributes": True}


class UpdateSignerHmacRequest(BaseModel):
    """Request to update signer's Ledger policy HMAC."""

    hmac: str = Field(
        ...,
        min_length=64,
        max_length=64,
        pattern=r"^[a-fA-F0-9]{64}$",
        description="Ledger wallet policy HMAC (32 bytes hex)",
    )


# =============================================================================
# Wallet Request Schemas
# =============================================================================


class WalletCreate(BaseModel):
    """Request to create a new multisig wallet."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Human-readable wallet name",
    )
    chain_type: ChainType = Field(
        ...,
        description="Blockchain type (BTC or EVM)",
    )
    threshold: int = Field(
        ...,
        ge=1,
        description="Number of signatures required",
    )
    signer_ids: list[str] = Field(
        ...,
        min_length=1,
        max_length=15,
        description="List of signer IDs to include",
    )
    network_id: str = Field(
        ...,
        description="Target network ID",
    )

    @field_validator("signer_ids")
    @classmethod
    def validate_unique_signers(cls, v: list[str]) -> list[str]:
        """Ensure all signer IDs are unique."""
        if len(v) != len(set(v)):
            raise ValueError("Signer IDs must be unique")
        return v

    @field_validator("threshold")
    @classmethod
    def validate_threshold_positive(cls, v: int) -> int:
        """Ensure threshold is positive."""
        if v < 1:
            raise ValueError("Threshold must be at least 1")
        return v

    @model_validator(mode="after")
    def validate_network(self):
        """Validate network_id is provided."""
        if not self.network_id:
            raise ValueError("network_id is required")
        return self


class WalletImport(BaseModel):
    """Request to import an existing multisig wallet.

    Supports two chain types with different field requirements:
    - EVM: requires safe_address
    - BTC Mode A (manual): address + public_keys + threshold
    - BTC Mode B (auto-extract): address only, optional tx_id hint
    """

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Human-readable wallet name",
    )
    chain_type: ChainType = Field(
        ...,
        description="Blockchain type (BTC or EVM)",
    )
    network_id: str = Field(
        ...,
        description="Target network ID",
    )

    # EVM fields
    safe_address: str | None = Field(
        None,
        description="Safe contract address (EVM only)",
    )
    safe_owners: list[str] | None = Field(
        None,
        description="Pre-fetched Safe owner addresses (EVM only, skips chain query when provided with safe_threshold)",
    )
    safe_threshold: int | None = Field(
        None,
        ge=1,
        description="Pre-fetched Safe threshold (EVM only, skips chain query when provided with safe_owners)",
    )

    # BTC fields
    address: str | None = Field(
        None,
        description="Multisig address (BTC only, required for both modes)",
    )
    threshold: int | None = Field(
        None,
        ge=1,
        description="Number of signatures required (BTC Mode A only)",
    )
    public_keys: list[str] | None = Field(
        None,
        description="Ordered list of cosigner public keys (BTC Mode A only)",
    )
    tx_id: str | None = Field(
        None,
        description="Transaction ID hint for auto-extracting multisig params (BTC Mode B only)",
    )

    @model_validator(mode="after")
    def validate_chain_fields(self):
        """Enforce chain-specific field requirements."""
        if self.chain_type == ChainType.EVM:
            return self._validate_evm()
        return self._validate_btc()

    def _validate_evm(self):
        """EVM: safe_address required, BTC fields rejected."""
        if not self.safe_address:
            raise ValueError("safe_address is required for EVM wallets")
        btc_fields = {
            "address": self.address,
            "threshold": self.threshold,
            "public_keys": self.public_keys,
            "tx_id": self.tx_id,
        }
        provided = [k for k, v in btc_fields.items() if v is not None]
        if provided:
            raise ValueError(
                f"BTC-only fields not allowed for EVM: {', '.join(provided)}"
            )
        # safe_owners and safe_threshold must be provided together or not at all
        has_owners = self.safe_owners is not None
        has_safe_threshold = self.safe_threshold is not None
        if has_owners != has_safe_threshold:
            raise ValueError(
                "safe_owners and safe_threshold must be provided together"
            )
        return self

    def _validate_btc(self):
        """BTC: address required, safe_address rejected, mode A/B exclusive."""
        if self.safe_address:
            raise ValueError("safe_address is not allowed for BTC wallets")
        if self.safe_owners or self.safe_threshold:
            raise ValueError("safe_owners/safe_threshold are not allowed for BTC wallets")
        if not self.address:
            raise ValueError("address is required for BTC wallets")

        has_keys = self.public_keys is not None
        has_threshold = self.threshold is not None
        has_txid = self.tx_id is not None

        # Reject mixed modes: keys + txid
        if has_keys and has_txid:
            raise ValueError(
                "Cannot provide both public_keys and tx_id; "
                "use either Mode A (manual) or Mode B (auto-extract)"
            )

        # Partial manual: one of keys/threshold without the other
        if has_keys != has_threshold:
            raise ValueError(
                "Both public_keys and threshold are required for "
                "manual import (Mode A)"
            )

        # Mode A validations
        if has_keys:
            assert self.public_keys is not None  # type narrowing
            if len(self.public_keys) < 2:
                raise ValueError(
                    "public_keys must contain at least 2 keys for multisig"
                )
            if len(self.public_keys) > 15:
                raise ValueError(
                    "public_keys must contain at most 15 keys"
                )
            assert self.threshold is not None  # type narrowing
            if self.threshold > len(self.public_keys):
                raise ValueError(
                    f"threshold ({self.threshold}) cannot exceed "
                    f"number of public_keys ({len(self.public_keys)})"
                )

        return self


class BtcImportPreview(BaseModel):
    """Request to preview/verify BTC multisig import without saving.

    Supports the same two modes as WalletImport:
    - Mode A (manual): address + public_keys + threshold → re-derive and verify
    - Mode B (auto): address + optional tx_id → extract from chain
    """

    network_id: str = Field(..., description="Target network ID")
    address: str = Field(..., min_length=1, description="Multisig address to verify")

    # Manual mode fields
    public_keys: list[str] | None = Field(
        None,
        description="Cosigner public keys (Mode A only)",
    )
    threshold: int | None = Field(
        None,
        ge=1,
        description="Required signatures (Mode A only)",
    )

    # Auto mode fields
    tx_id: str | None = Field(
        None,
        description="TX ID hint for auto-extraction (Mode B only)",
    )

    @model_validator(mode="after")
    def validate_mode(self):
        """Ensure valid mode: manual (keys+threshold) or auto."""
        has_keys = self.public_keys is not None
        has_threshold = self.threshold is not None
        has_txid = self.tx_id is not None

        if has_keys and has_txid:
            raise ValueError(
                "Cannot provide both public_keys and tx_id; "
                "use either manual or auto mode"
            )
        if has_keys != has_threshold:
            raise ValueError(
                "Both public_keys and threshold are required for manual mode"
            )
        if has_keys:
            assert self.public_keys is not None
            if len(self.public_keys) < 2:
                raise ValueError("Need at least 2 public keys for multisig")
            if len(self.public_keys) > 15:
                raise ValueError("Maximum 15 public keys")
            assert self.threshold is not None
            if self.threshold > len(self.public_keys):
                raise ValueError(
                    f"threshold ({self.threshold}) > key count "
                    f"({len(self.public_keys)})"
                )
        return self


class WalletUpdate(BaseModel):
    """Request to update wallet (currently only name)."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="New wallet name",
    )


class WalletQuery(BaseModel):
    """Query parameters for listing wallets."""

    chain_type: ChainType | None = Field(
        None,
        description="Filter by chain type",
    )
    status: WalletStatus | None = Field(
        None,
        description="Filter by wallet status",
    )
    page: int = Field(1, ge=1, description="Page number")
    page_size: int = Field(20, ge=1, le=100, description="Items per page")


# =============================================================================
# Wallet Response Schemas
# =============================================================================


class WalletSignerResponse(BaseModel):
    """Signer info in wallet response."""

    id: str
    name: str
    device_type: str
    status: str | None = None
    address: str | None = None
    public_key: str | None = None
    derivation_path: str | None = None
    # Convenience fields (populated from signer.extra and wallet_signer.extra)
    master_fingerprint: str | None = None
    xpub: str | None = None
    ledger_policy_hmac: str | None = None
    order_index: int

    model_config = {"from_attributes": True}


class WalletResponse(BaseModel):
    """Wallet detail response."""

    id: str
    name: str
    chain_type: ChainType
    threshold: int
    signer_count: int
    verified_signer_count: int = 0
    address: str | None = None
    status: WalletStatus
    source: str | None = None
    deployed_at: datetime | None = None
    extra: dict | None = None
    network_id: str
    created_at: datetime
    updated_at: datetime
    signers: list[WalletSignerResponse] = Field(default_factory=list)

    # Convenience fields extracted from extra
    salt: str | None = None
    deployment_tx_hash: str | None = None
    factory_address: str | None = None
    witness_script: str | None = None
    redeem_script: str | None = None

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _extract_extra_fields(cls, data: object) -> object:
        """Extract chain-specific convenience fields from extra JSON."""
        if hasattr(data, "__dict__"):
            raw_extra = getattr(data, "extra", None)
        elif isinstance(data, dict):
            raw_extra = data.get("extra")
        else:
            return data

        if raw_extra is None:
            return data

        extra = raw_extra if isinstance(raw_extra, dict) else json.loads(raw_extra)

        convenience_keys = (
            "salt", "deployment_tx_hash", "factory_address",
            "witness_script", "redeem_script",
        )

        if hasattr(data, "__dict__"):
            d = {
                key: getattr(data, key)
                for key in (
                    "id", "name", "chain_type", "threshold", "signer_count",
                    "address", "status", "deployed_at", "network_id",
                    "created_at", "updated_at",
                )
            }
            d["extra"] = extra
            # wallet_signers handled separately by the API layer
            d["signers"] = getattr(data, "signers", [])
            for key in convenience_keys:
                d[key] = extra.get(key)
            return d
        else:
            data = dict(data) if not isinstance(data, dict) else data
            if isinstance(data.get("extra"), str):
                data["extra"] = extra
            for key in convenience_keys:
                data.setdefault(key, extra.get(key))
            return data


class WalletListItem(BaseModel):
    """Wallet item in list response (without full signer details)."""

    id: str
    name: str
    chain_type: ChainType
    threshold: int
    signer_count: int
    verified_signer_count: int = 0
    address: str | None = None
    status: WalletStatus
    network_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


# =============================================================================
# Sync Request/Response
# =============================================================================


class WalletSyncRequest(BaseModel):
    """Request to trigger wallet sync."""

    force: bool = Field(
        False,
        description="Force full re-sync even if recently synced",
    )


class WalletSyncResponse(BaseModel):
    """Response after triggering wallet sync."""

    wallet_id: str
    sync_started: bool
    message: str


# =============================================================================
# Address Derivation Response
# =============================================================================


class AddressDerivationResult(BaseModel):
    """Result of address derivation for wallet."""

    address: str
    chain_type: ChainType
    script_type: str | None = None  # BTC: p2wsh, p2sh-p2wsh
    witness_script: str | None = None  # BTC only
    factory_address: str | None = None  # EVM only
    salt: str | None = None  # EVM only


# =============================================================================
# EVM Safe Deployment Schemas
# =============================================================================


class SafeDeploymentInfoResponse(BaseModel):
    """Information needed to deploy a Safe multisig wallet."""

    wallet_id: str
    predicted_address: str
    owners: list[str]
    threshold: int
    salt_nonce: int
    factory_address: str
    singleton_address: str
    fallback_handler: str
    is_deployed: bool
    chain_id: int = Field(
        default=1,
        description="Chain ID of the network (e.g., 1 for mainnet, 11155111 for Sepolia)",
    )
    deployment_tx: dict | None = Field(
        None,
        description="Transaction data for deployment (to, data, value)",
    )


class SafeDeploymentConfirm(BaseModel):
    """Request to confirm Safe deployment after transaction is mined."""

    tx_hash: str = Field(
        ...,
        description="Transaction hash of the deployment transaction",
    )


class WalletActivateRequest(BaseModel):
    """Request to activate a wallet after deployment/derivation."""

    address: str = Field(
        ...,
        description="On-chain multisig address",
    )
    tx_hash: str | None = Field(
        None,
        description="Deployment transaction hash (EVM only)",
    )
    salt: str | None = Field(
        None,
        description="CREATE2 salt (EVM only)",
    )
    factory_address: str | None = Field(
        None,
        description="Factory address used (EVM only)",
    )
    witness_script: str | None = Field(
        None,
        description="Witness script hex (BTC only)",
    )
    redeem_script: str | None = Field(
        None,
        description="Redeem script hex (BTC only)",
    )
