"""Transaction request/response schemas."""

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from multivault.models.signer import ChainType
from multivault.models.transaction import TransactionStatus, TransactionType


# =============================================================================
# Transaction Request Schemas
# =============================================================================


class UtxoSelection(BaseModel):
    """A specific UTXO to use as transaction input (BTC only)."""

    txid: str = Field(..., min_length=1, description="Transaction ID of the UTXO")
    vout: int = Field(..., ge=0, description="Output index")


class TransactionCreate(BaseModel):
    """Request to create a new transaction.

    For native transfers, set token_address to None.
    For token transfers, provide token_address.
    """

    to_address: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description="Recipient address",
    )
    amount: Decimal = Field(
        ...,
        ge=0,
        description="Amount to send (in base units). Use 0 with send_max=True.",
    )
    token_address: str | None = Field(
        None,
        description="Token contract address (null for native)",
    )
    description: str | None = Field(
        None,
        max_length=500,
        description="Optional transaction description",
    )
    fee_rate: int | None = Field(
        None,
        ge=1,
        description="Fee rate: sat/vB for BTC, gwei for EVM",
    )
    selected_utxos: list[UtxoSelection] | None = Field(
        None,
        description="Specific UTXOs to use as inputs (BTC only). If omitted, all available UTXOs form the candidate pool.",
    )
    use_all_inputs: bool = Field(
        False,
        description="When true, every candidate UTXO becomes a tx input (skip coin selection). When false, greedy largest-first coin selection runs within the candidate pool. BTC only.",
    )
    send_max: bool = Field(
        False,
        description="Send maximum amount (no change output). The backend computes the actual send amount as total_input - fee. BTC only.",
    )

    @model_validator(mode="after")
    def validate_amount_or_send_max(self) -> "TransactionCreate":
        """Require amount > 0 unless send_max is True."""
        if not self.send_max and self.amount <= 0:
            raise ValueError("amount must be greater than 0 when send_max is False")
        return self

    @field_validator("to_address")
    @classmethod
    def validate_address_format(cls, v: str) -> str:
        """Basic address format validation."""
        v = v.strip()
        if not v:
            raise ValueError("Address cannot be empty")
        return v


class PolicyChangeCreate(BaseModel):
    """Request to create a Safe policy change transaction."""

    action: str = Field(
        ...,
        pattern=r"^(add_owner|remove_owner|swap_owner|change_threshold)$",
        description="Policy change action type",
    )
    new_owner: str | None = Field(
        None,
        max_length=42,
        pattern=r"^0x[0-9a-fA-F]{40}$",
        description="New owner address (add_owner, swap_owner)",
    )
    removed_owner: str | None = Field(
        None,
        max_length=42,
        pattern=r"^0x[0-9a-fA-F]{40}$",
        description="Owner to remove (remove_owner, swap_owner)",
    )
    new_threshold: int | None = Field(
        None,
        ge=1,
        description="New threshold value",
    )
    description: str | None = Field(
        None,
        max_length=500,
        description="Optional description",
    )

    @model_validator(mode="after")
    def validate_params_for_action(self) -> "PolicyChangeCreate":
        """Validate required params per action type."""
        if self.action == "add_owner":
            if not self.new_owner:
                raise ValueError("new_owner is required for add_owner")
            if self.new_threshold is None:
                raise ValueError("new_threshold is required for add_owner")
        elif self.action == "remove_owner":
            if not self.removed_owner:
                raise ValueError("removed_owner is required for remove_owner")
            if self.new_threshold is None:
                raise ValueError("new_threshold is required for remove_owner")
        elif self.action == "swap_owner":
            if not self.removed_owner:
                raise ValueError("removed_owner is required for swap_owner")
            if not self.new_owner:
                raise ValueError("new_owner is required for swap_owner")
        elif self.action == "change_threshold":
            if self.new_threshold is None:
                raise ValueError(
                    "new_threshold is required for change_threshold"
                )
        return self


class SignatureSubmit(BaseModel):
    """Request to submit a signature for a transaction.

    For BTC: Partial PSBT signature (base64)
    For EVM: Safe signature (hex-encoded r+s+v)
    """

    signature_data: str = Field(
        ...,
        min_length=1,
        description="Signature data (format depends on chain)",
    )
    signature_type: int | None = Field(
        None,
        ge=0,
        le=3,
        description="EVM signature type (0=contract, 1=approved, 2=eth_sign, 3=ecdsa)",
    )


class TransactionQuery(BaseModel):
    """Query parameters for listing transactions."""

    status: TransactionStatus | None = Field(
        None,
        description="Filter by status",
    )
    page: int = Field(1, ge=1, description="Page number")
    page_size: int = Field(20, ge=1, le=100, description="Items per page")


class BTCHistoryImportRequest(BaseModel):
    """Request to import BTC transaction history for a wallet address."""

    limit: int = Field(
        200,
        ge=1,
        le=1000,
        description="Max number of history entries to process",
    )
    confirmed_only: bool = Field(
        False,
        description="Whether to import only confirmed transactions",
    )


class BTCHistoryImportError(BaseModel):
    """Single transaction import error."""

    txid: str
    reason: str


class BTCHistoryImportResponse(BaseModel):
    """Response for BTC history import."""

    processed: int
    inserted: int
    updated: int = 0
    skipped: int
    errors: list[BTCHistoryImportError] = Field(default_factory=list)


class EVMHistoryImportRequest(BaseModel):
    """Request to import EVM Safe transaction history."""

    limit: int = Field(
        200,
        ge=1,
        le=1000,
        description="Max number of transactions to import per category",
    )
    include_incoming: bool = Field(
        True,
        description="Whether to also import incoming ETH/ERC20 transfers",
    )


class EVMHistoryImportError(BaseModel):
    """Single transaction import error."""

    tx_ref: str = Field(description="safeTxHash or transactionHash that failed")
    reason: str


class EVMHistoryImportResponse(BaseModel):
    """Response for EVM Safe history import."""

    imported: int = Field(description="Total transactions imported")
    skipped: int = Field(description="Duplicates skipped")
    failed: int = Field(description="Transactions that failed to import")
    multisig_imported: int = Field(description="Multisig transactions imported")
    incoming_imported: int = Field(description="Incoming transfers imported")
    errors: list[EVMHistoryImportError] = Field(default_factory=list)


# =============================================================================
# Transaction Response Schemas
# =============================================================================


class SignatureInfo(BaseModel):
    """Signature information in transaction response."""

    id: str
    signer_id: str
    signer_name: str | None = None
    signature_type: int | None = None
    verified: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TransactionResponse(BaseModel):
    """Full transaction detail response."""

    id: str
    wallet_id: str
    tx_type: TransactionType
    description: str | None = None

    # Transfer details
    to_address: str
    amount: Decimal

    # Convenience fields (sourced from extra JSON for backward compatibility)
    token_address: str | None = None
    token_symbol: str | None = None
    token_decimals: int | None = None
    fee_rate: int | None = None

    # Fee info
    fee_amount: Decimal | None = None

    # EVM Safe nonce
    safe_nonce: int | None = Field(None, description="Safe contract nonce (EVM only)")

    # Payload for signing
    payload: str | None = None
    payload_hash: str | None = None

    # Signature status
    threshold: int
    signature_count: int
    signatures: list[SignatureInfo] = Field(default_factory=list)

    # Lifecycle
    status: TransactionStatus
    created_at: datetime
    updated_at: datetime
    confirmed_at: datetime | None = None

    # On-chain data
    tx_hash: str | None = None
    block_number: int | None = None

    # Error
    error_message: str | None = None

    # Chain-specific metadata
    extra: dict[str, Any] | None = Field(None, description="Chain/token-specific metadata")

    # Broadcast readiness (for EVM Safe transactions)
    can_broadcast: bool | None = Field(None, description="Whether transaction can be broadcast (nonce order check)")
    blocking_reason: str | None = Field(None, description="Reason why transaction cannot be broadcast")

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_with_signers(
        cls,
        tx,
        can_broadcast: bool | None = None,
        blocking_reason: str | None = None,
    ) -> "TransactionResponse":
        """Build response with signer names resolved.
        
        Args:
            tx: Transaction model
            can_broadcast: Whether transaction can be broadcast (for Safe transactions)
            blocking_reason: Reason why transaction cannot be broadcast
        """
        from multivault.utils.extra import get_extra

        signatures = []
        for sig in tx.signatures:
            sig_info = SignatureInfo(
                id=sig.id,
                signer_id=sig.signer_id,
                signer_name=sig.signer.name if sig.signer else None,
                signature_type=sig.signature_type,
                verified=sig.verified,
                created_at=sig.created_at,
            )
            signatures.append(sig_info)

        tx_extra = get_extra(tx)

        return cls(
            id=tx.id,
            wallet_id=tx.wallet_id,
            tx_type=tx.tx_type,
            description=tx.description,
            to_address=tx.to_address,
            amount=tx.amount,
            token_address=tx_extra.get("token_address"),
            token_symbol=tx_extra.get("token_symbol"),
            token_decimals=tx_extra.get("token_decimals"),
            fee_amount=tx.fee_amount,
            fee_rate=tx_extra.get("fee_rate"),
            payload=tx.payload,
            payload_hash=tx.payload_hash,
            threshold=tx.threshold,
            signature_count=tx.signature_count,
            signatures=signatures,
            status=tx.status,
            created_at=tx.created_at,
            updated_at=tx.updated_at,
            confirmed_at=tx.confirmed_at,
            tx_hash=tx.tx_hash,
            block_number=tx.block_number,
            error_message=tx.error_message,
            safe_nonce=tx.safe_nonce,
            extra=tx_extra or None,
            can_broadcast=can_broadcast,
            blocking_reason=blocking_reason,
        )


class TransactionListItem(BaseModel):
    """Transaction item in list response (minimal info)."""

    id: str
    wallet_id: str
    tx_type: TransactionType
    to_address: str
    from_address: str | None = None
    amount: Decimal
    token_symbol: str | None = None
    status: TransactionStatus
    threshold: int
    signature_count: int
    created_at: datetime
    confirmed_at: datetime | None = None
    tx_hash: str | None = None

    model_config = {"from_attributes": True}


class TransactionBroadcastResult(BaseModel):
    """Result of broadcasting a transaction."""

    success: bool
    tx_hash: str | None = None
    error: str | None = None


# =============================================================================
# PSBT / Safe Transaction Details
# =============================================================================


class PSBTInfo(BaseModel):
    """PSBT information for BTC transactions."""

    psbt_base64: str
    inputs_count: int
    outputs_count: int
    fee_sats: int
    estimated_vsize: int


class SafeTransactionInfo(BaseModel):
    """Safe transaction information for EVM transactions."""

    safe_tx_hash: str
    to: str
    value: str  # Hex string
    data: str  # Hex string
    operation: int
    safe_nonce: int
    signatures_encoded: str | None = None  # Combined signatures for broadcast


class SafeExecutionData(BaseModel):
    """Data needed to execute a Safe transaction.
    
    The frontend should use this to call execTransaction on the Safe contract.
    """

    safe_address: str = Field(..., description="Safe contract address")
    exec_transaction_data: str = Field(..., description="Encoded execTransaction call data (hex)")
    signatures_count: int = Field(..., description="Number of signatures included")
    estimated_gas: int | None = Field(None, description="Estimated gas for execution")


class BTCBroadcastRequest(BaseModel):
    """Request body for BTC transaction broadcast."""

    # No body needed - backend will broadcast using stored PSBT + signatures


class BTCBroadcastResponse(BaseModel):
    """Response from BTC transaction broadcast."""

    transaction_id: str = Field(..., description="Backend transaction UUID")
    tx_hash: str | None = Field(None, description="Bitcoin transaction ID (txid)")
    raw_tx: str = Field(..., description="Raw transaction hex")
    success: bool = Field(..., description="Whether broadcast succeeded")
    error: str | None = Field(None, description="Error message if failed")


class KeyVaultSigningPayloadResponse(BaseModel):
    """KeyVault transaction signing payload for QR display."""

    payload_json: str = Field(..., description="JSON payload for BR-UR encoding")
    signer_id: str = Field(..., description="Signer UUID")


class BTCExecutionData(BaseModel):
    """Data for BTC transaction execution.

    Contains the finalized PSBT (or raw tx) ready for broadcast.
    """

    transaction_id: str = Field(..., description="Backend transaction UUID")
    finalized_psbt: str = Field(..., description="Finalized PSBT (base64)")
    raw_tx: str = Field(..., description="Raw transaction hex")
    txid: str = Field(..., description="Transaction ID (computed)")
    signatures_count: int = Field(..., description="Number of signatures")
    can_broadcast: bool = Field(..., description="Whether ready for broadcast")


class BtcTxInput(BaseModel):
    """Decoded BTC transaction input."""

    txid: str = Field(..., description="Previous transaction hash")
    vout: int = Field(..., description="Output index in previous tx")
    value: int | None = Field(None, description="Value in satoshis (from witness_utxo)")
    address: str | None = Field(None, description="Source address")


class BtcTxOutput(BaseModel):
    """Decoded BTC transaction output."""

    index: int = Field(..., description="Output index")
    value: int = Field(..., description="Value in satoshis")
    address: str | None = Field(None, description="Destination address")
    is_change: bool | None = Field(None, description="Whether this is the change output")


class BtcDecodedTx(BaseModel):
    """Decoded BTC transaction with human-readable inputs/outputs."""

    transaction_id: str = Field(..., description="Backend transaction UUID")
    txid: str | None = Field(None, description="Bitcoin txid (null if not yet broadcast)")
    version: int = Field(..., description="Transaction version")
    size: int | None = Field(None, description="Transaction size in bytes")
    vsize: int | None = Field(None, description="Virtual size in vbytes")
    fee: int | None = Field(None, description="Fee in satoshis")
    inputs: list[BtcTxInput] = Field(default_factory=list)
    outputs: list[BtcTxOutput] = Field(default_factory=list)
    status: str = Field(..., description="Transaction status")
    confirmations: int | None = Field(None, description="Number of confirmations")


class BTCSignerPolicyInfo(BaseModel):
    """Signer info for BTC wallet policy."""

    signer_id: str = Field(..., description="Signer UUID")
    signer_name: str = Field(..., description="Signer name")
    derivation_path: str | None = Field(None, description="BIP32 derivation path")
    master_fingerprint: str | None = Field(None, description="Master key fingerprint (hex)")
    xpub: str | None = Field(None, description="Extended public key")
    ledger_policy_hmac: str | None = Field(None, description="Ledger policy HMAC if registered")
    order_index: int = Field(..., description="Signer order in wallet (for sortedmulti)")


class BTCSigningInfo(BaseModel):
    """Information needed for BTC multisig signing.

    Includes wallet policy details and signer-specific HMACs for Ledger devices.
    """

    transaction_id: str = Field(..., description="Transaction UUID")
    wallet_id: str = Field(..., description="Wallet UUID")
    psbt_base64: str = Field(..., description="PSBT to sign (base64)")
    threshold: int = Field(..., description="Required signatures")
    signer_count: int = Field(..., description="Total signers")
    wallet_policy_type: str = Field(
        default="wsh(sortedmulti(...))",
        description="Wallet policy descriptor pattern",
    )
    script_type: str = Field(
        default="p2wsh",
        description="Script type: p2wsh or p2sh-p2wsh",
    )
    signers: list[BTCSignerPolicyInfo] = Field(
        default_factory=list,
        description="Signer policy info in order",
    )
