"""Signer-related Pydantic schemas for request/response validation."""

import json
import re
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class DeviceTypeEnum(str, Enum):
    """Supported device/wallet types."""

    LEDGER = "LEDGER"
    METAMASK = "METAMASK"
    WALLETCONNECT = "WALLETCONNECT"
    KEYVAULT = "KEYVAULT"
    UNKNOWN = "UNKNOWN"


class ChainTypeEnum(str, Enum):
    """Supported chain types."""

    BTC = "BTC"
    EVM = "EVM"


class SignerStatusEnum(str, Enum):
    """Signer verification status."""

    UNVERIFIED = "UNVERIFIED"
    VERIFIED = "VERIFIED"
    REVOKED = "REVOKED"


# ============== Challenge ==============


class ChallengeRequest(BaseModel):
    """Request to generate a verification challenge."""

    chain_type: ChainTypeEnum
    address: str | None = Field(
        default=None,
        description="Address (EVM format for EVM, bech32/legacy for BTC)",
        examples=["0x742d35Cc6634C0532925a3b844Bc9e7595f1E3C7", "bc1q..."],
    )
    public_key: str | None = Field(
        default=None,
        description="Public key hex (required for BTC chain)",
        examples=["02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc"],
    )

    @model_validator(mode="after")
    def validate_address_for_chain(self):
        """Validate address format based on chain type."""
        if self.address is not None:
            if self.chain_type == ChainTypeEnum.EVM:
                # EVM address validation
                if not self.address.startswith("0x") or len(self.address) != 42:
                    raise ValueError("Invalid EVM address format")
                self.address = self.address.lower()
            elif self.chain_type == ChainTypeEnum.BTC:
                # BTC address validation (supports bech32, legacy P2PKH, P2SH)
                btc_patterns = [
                    r"^bc1[a-z0-9]{25,90}$",  # Bech32 mainnet
                    r"^tb1[a-z0-9]{25,90}$",  # Bech32 testnet
                    r"^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$",  # Legacy mainnet
                    r"^[mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$",  # Legacy testnet
                ]
                if not any(re.match(p, self.address) for p in btc_patterns):
                    raise ValueError("Invalid BTC address format")
        return self

    @field_validator("public_key")
    @classmethod
    def validate_public_key(cls, v: str | None) -> str | None:
        if v is None:
            return v
        # Basic public key validation (compressed: 66 chars, uncompressed: 130 chars)
        if len(v) not in (66, 130):
            raise ValueError("Invalid public key length")
        try:
            bytes.fromhex(v)
        except ValueError:
            raise ValueError("Invalid public key hex format")
        return v.lower()


class ChallengeResponse(BaseModel):
    """Generated verification challenge."""

    challenge: str = Field(
        ...,
        description="Challenge message to be signed",
    )
    expires_at: datetime = Field(
        ...,
        description="Challenge expiration time",
    )


# ============== Create Signer ==============


class SignerCreate(BaseModel):
    """Request to create a new signer with verification."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Display name for the signer",
        examples=["My Ledger Nano X"],
    )
    device_type: DeviceTypeEnum = Field(
        ...,
        description="Type of device/wallet",
    )
    chain_type: ChainTypeEnum = Field(
        ...,
        description="Blockchain type",
    )

    # Identifier (at least one required)
    public_key: str | None = Field(
        default=None,
        description="Public key in hex format (required for BTC)",
    )
    address: str | None = Field(
        default=None,
        description="Wallet address (required for EVM)",
    )

    # Derivation info (optional)
    derivation_path: str | None = Field(
        default=None,
        description="BIP44/48 derivation path",
        examples=["m/48'/0'/0'/2'"],
    )
    master_fingerprint: str | None = Field(
        default=None,
        description="Master key fingerprint (4 bytes hex)",
        examples=["a1b2c3d4"],
    )
    xpub: str | None = Field(
        default=None,
        description="Extended public key",
    )

    # Script type hint (BTC only, for backend validation)
    script_type: str | None = Field(
        default=None,
        description="Expected script type: p2wsh or p2sh-p2wsh (BTC only)",
    )
    btc_network: str | None = Field(
        default=None,
        description="BTC network identifier (mainnet, testnet3, or testnet4)",
    )

    @field_validator("btc_network")
    @classmethod
    def validate_btc_network(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.lower()
        if normalized not in {"mainnet", "testnet3", "testnet4"}:
            raise ValueError("btc_network must be mainnet, testnet3, or testnet4")
        return normalized

    # Verification (required)
    challenge: str | None = Field(
        default=None,
        description="The challenge message that was signed",
    )
    signature: str | None = Field(
        default=None,
        description="Signature of the challenge in hex format",
    )

    @model_validator(mode="after")
    def validate_address_for_chain(self):
        """Validate address format based on chain type."""
        if self.address is not None:
            if self.chain_type == ChainTypeEnum.EVM:
                # EVM address validation
                if not self.address.startswith("0x") or len(self.address) != 42:
                    raise ValueError("Invalid EVM address format")
                self.address = self.address.lower()
            elif self.chain_type == ChainTypeEnum.BTC:
                # BTC address validation (supports bech32, legacy P2PKH, P2SH)
                btc_patterns = [
                    r"^bc1[a-z0-9]{25,90}$",  # Bech32 mainnet
                    r"^tb1[a-z0-9]{25,90}$",  # Bech32 testnet
                    r"^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$",  # Legacy mainnet
                    r"^[mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$",  # Legacy testnet
                ]
                if not any(re.match(p, self.address) for p in btc_patterns):
                    raise ValueError("Invalid BTC address format")
        return self

    @field_validator("public_key")
    @classmethod
    def validate_public_key(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if len(v) not in (66, 130):
            raise ValueError("Invalid public key length")
        try:
            bytes.fromhex(v)
        except ValueError:
            raise ValueError("Invalid public key hex format")
        return v.lower()

    @field_validator("master_fingerprint")
    @classmethod
    def validate_fingerprint(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if len(v) != 8:
            raise ValueError("Master fingerprint must be 8 hex characters (4 bytes)")
        try:
            bytes.fromhex(v)
        except ValueError:
            raise ValueError("Invalid master fingerprint hex format")
        return v.lower()

    @model_validator(mode="after")
    def validate_device_chain_compatibility(self):
        """Validate that device_type is compatible with chain_type."""
        _ALLOWED: dict[ChainTypeEnum, set[DeviceTypeEnum]] = {
            ChainTypeEnum.BTC: {DeviceTypeEnum.LEDGER, DeviceTypeEnum.KEYVAULT, DeviceTypeEnum.UNKNOWN},
            ChainTypeEnum.EVM: {
                DeviceTypeEnum.LEDGER,
                DeviceTypeEnum.METAMASK,
                DeviceTypeEnum.WALLETCONNECT,
                DeviceTypeEnum.KEYVAULT,
                DeviceTypeEnum.UNKNOWN,
            },
        }
        allowed = _ALLOWED.get(self.chain_type, set())
        if self.device_type not in allowed:
            raise ValueError(
                f"device_type {self.device_type.value} is not compatible "
                f"with chain_type {self.chain_type.value}"
            )

        # KeyVault only supports P2SH-P2WSH for BTC (not native P2WSH)
        if (
            self.chain_type == ChainTypeEnum.BTC
            and self.device_type == DeviceTypeEnum.KEYVAULT
        ):
            is_p2sh = (
                self.script_type == "p2sh-p2wsh"
                or (self.derivation_path and self.derivation_path.endswith("/1'"))
            )
            if not is_p2sh:
                raise ValueError(
                    "KeyVault only supports P2SH-P2WSH (BIP 48 /1') for BTC, "
                    "not native P2WSH (BIP 48 /2')"
                )

        return self


class SignerUpdate(BaseModel):
    """Request to update signer (name only)."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="New display name",
    )


class SignerVerify(BaseModel):
    """Request to verify an existing signer."""

    challenge: str = Field(
        ...,
        description="The challenge message that was signed",
    )
    signature: str = Field(
        ...,
        description="Signature of the challenge in hex format",
    )

    # Optional fields for imported signers (device metadata from verification)
    device_type: DeviceTypeEnum | None = Field(
        default=None,
        description="Actual device type (e.g., LEDGER; updates UNKNOWN signers)",
    )
    derivation_path: str | None = Field(
        default=None,
        max_length=50,
        description="BIP derivation path (BTC import verify)",
    )
    master_fingerprint: str | None = Field(
        default=None,
        max_length=8,
        description="Master key fingerprint hex (BTC import verify)",
    )
    xpub: str | None = Field(
        default=None,
        description="Extended public key (BTC import verify)",
    )


# ============== Response ==============


class SignerWalletBrief(BaseModel):
    """Brief wallet info associated with a signer (derived from eager-loaded relationship)."""

    wallet_id: str
    wallet_name: str
    network_id: str
    network_name: str
    is_testnet: bool


class SignerResponse(BaseModel):
    """Signer data in API response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    device_type: DeviceTypeEnum
    chain_type: ChainTypeEnum
    public_key: str | None
    address: str | None
    derivation_path: str | None
    extra: dict | None = None
    status: SignerStatusEnum
    verified_at: datetime | None
    created_at: datetime
    updated_at: datetime

    # Convenience fields extracted from extra
    master_fingerprint: str | None = None
    xpub: str | None = None
    btc_network: str | None = None

    # Wallet associations (populated when eager-loaded)
    wallets: list[SignerWalletBrief] = []

    @model_validator(mode="before")
    @classmethod
    def _extract_extra_fields(cls, data: object) -> object:
        """Extract convenience fields from extra JSON and wallet associations."""
        is_orm = hasattr(data, "__dict__") and not isinstance(data, dict)

        if is_orm:
            raw_extra = getattr(data, "extra", None)
        elif isinstance(data, dict):
            raw_extra = data.get("extra")
        else:
            return data

        extra = {}
        if raw_extra is not None:
            extra = raw_extra if isinstance(raw_extra, dict) else json.loads(raw_extra)

        if is_orm:
            d = {
                key: getattr(data, key)
                for key in (
                    "id", "name", "device_type", "chain_type",
                    "public_key", "address", "derivation_path",
                    "status", "verified_at", "created_at", "updated_at",
                )
            }
            d["extra"] = extra or None
            d["master_fingerprint"] = extra.get("master_fingerprint")
            d["xpub"] = extra.get("xpub")
            d["btc_network"] = extra.get("btc_network")

            # Extract wallet associations from eager-loaded relationship.
            # Access via __dict__ to avoid triggering async lazy-load.
            ws_list = data.__dict__.get("wallet_signers") or []
            wallets = []
            for ws in ws_list:
                w = getattr(ws, "wallet", None)
                if w is None or getattr(w, "deleted_at", None) is not None:
                    continue
                # Skip archived wallets — they are soft-deleted but
                # deleted_at is not set by archive_wallet().
                if getattr(w, "status", None) == "ARCHIVED":
                    continue
                net = getattr(w, "network", None)
                wallets.append({
                    "wallet_id": w.id,
                    "wallet_name": w.name,
                    "network_id": w.network_id,
                    "network_name": net.name if net else "",
                    "is_testnet": net.is_testnet if net else False,
                })
            d["wallets"] = wallets
            return d
        elif isinstance(data, dict):
            d: dict[str, object] = {**data}
            if isinstance(d.get("extra"), str):
                d["extra"] = extra or None
            if extra:
                d.setdefault("master_fingerprint", extra.get("master_fingerprint"))
                d.setdefault("xpub", extra.get("xpub"))
                d.setdefault("btc_network", extra.get("btc_network"))
            d.setdefault("wallets", [])
            return d


class SignerListResponse(BaseModel):
    """List of signers with filtering info."""

    signers: list[SignerResponse]
    total: int


# ============== KeyVault Protocol ==============


class KeyVaultProtocolRequest(BaseModel):
    """Request to generate KeyVault address import protocol data."""

    chain_type: ChainTypeEnum
    chain_net_type: str = Field(
        default="mainnet",
        description="Network type: mainnet / testnet",
    )
    evm_chain_id: int | None = Field(
        default=None,
        description="EVM chain ID (for EVM chains)",
    )
    chain_type_value: str | None = Field(
        default=None,
        description="KeyVault chain_type value from frontend (e.g. ETH, BTC, BTC_TESTNET)",
    )


class KeyVaultProtocolResponse(BaseModel):
    """KeyVault protocol data for QR code display."""

    payload_json: str = Field(
        description="Complete JSON payload for BR-UR encoding",
    )
    challenge: str = Field(
        description="Challenge message embedded in payload",
    )
    expires_at: datetime = Field(
        description="Protocol expiration time",
    )


# ============== Query Parameters ==============


class SignerQueryParams(BaseModel):
    """Query parameters for listing signers."""

    chain_type: ChainTypeEnum | None = None
    device_type: DeviceTypeEnum | None = None
    status: SignerStatusEnum | None = None
    script_type: str | None = None  # "p2wsh" or "p2sh-p2wsh"
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
