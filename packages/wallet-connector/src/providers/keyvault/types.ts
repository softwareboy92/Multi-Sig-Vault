// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - KeyVault (NXV) Protocol Types
// ═══════════════════════════════════════════════════════════════════════════
//
// Internal types for the QR-based communication protocol between the SDK
// and the KeyVault iOS hardware wallet. NOT part of the public SDK API.
//
// The KeyVault app may send field names in either camelCase or snake_case,
// so response types include both variants where applicable.
// ═══════════════════════════════════════════════════════════════════════════

// ─── NXV Actions ──────────────────────────────────────────────────────────

/** Actions in the NXV QR protocol */
export type NxvAction =
  | 'multi_sign'
  | 'import_signer'
  | 'sign_result'
  | 'import_signer_result';

// ─── Sign Result Types ────────────────────────────────────────────────────

/** Individual per-transaction signature from a batch signing operation */
export interface NxvSignResultItem {
  transfer_id: string;
  signature: string;
}

/**
 * Response from KeyVault after a signing operation.
 *
 * The signature may appear at `b_data.signature` (single tx) or
 * `b_data.signResult[]` (batch). Consumers should check both locations.
 *
 * @see KeyVaultSignModal.tsx:44-62 for original extraction logic
 */
export interface NxvSignResult {
  nxv_action: 'sign_result';
  b_data: {
    chainType?: string;
    /** Top-level signature (single transaction) */
    signature?: string;
    /** Per-transaction signatures (batch signing) */
    signResult?: NxvSignResultItem[];
  };
}

// ─── Import Signer Result Types ───────────────────────────────────────────

/**
 * Account info returned by KeyVault during signer import.
 *
 * Field names appear in both camelCase and snake_case because the KeyVault
 * iOS app may send either format. The existing frontend handles this with
 * `||` chains (e.g. `account.publicKey || account.public_key`).
 *
 * @see ImportSignatureAddressForm.tsx:309-349 for original extraction logic
 */
export interface NxvAccountInfo {
  address?: string;

  /** Public key (camelCase variant) */
  publicKey?: string;
  /** Public key (snake_case variant) */
  public_key?: string;

  /** HD derivation path — multiple key names observed */
  path?: string;
  derivationPath?: string;
  derivation_path?: string;

  /** Master fingerprint — multiple key names observed */
  fpr?: string;
  masterFingerprint?: string;
  master_fingerprint?: string;

  /** Extended public key (for multisig key derivation) */
  xpub?: string;

  /** Human-readable account name */
  name?: string;
}

/**
 * Response from KeyVault after a signer import operation.
 *
 * @see ImportSignatureAddressForm.tsx:309-349
 */
export interface NxvImportSignerResult {
  nxv_action: 'import_signer_result';
  b_data: {
    chainType?: string;
    /** Challenge signature proving device ownership */
    signature?: string;
    /** Imported account details */
    account?: NxvAccountInfo;
  };
}

// ─── Discriminated Union ──────────────────────────────────────────────────

/** Any valid response from the KeyVault device, discriminated by `nxv_action` */
export type NxvResponse = NxvSignResult | NxvImportSignerResult;

// ─── Modal Parameters ─────────────────────────────────────────────────────

/** Parameters passed to the KeyVault QR modal web component */
export interface KeyVaultModalParams {
  /** Animated QR frames (each frame is a string to be encoded as a QR code) */
  frames: string[];
  /** The operation type that determines how the scanned response is processed */
  action: 'sign' | 'import';
}
