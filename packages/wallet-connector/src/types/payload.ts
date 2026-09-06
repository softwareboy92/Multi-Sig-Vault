// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Sign Payload Types
// ═══════════════════════════════════════════════════════════════════════════

// ─── Sign Payload (Union Type) ────────────────────────────────────────────
export type SignPayload =
  | BtcSignPayload
  | EvmSignPayload
  | KeyVaultSignPayload;

// ─── BTC Sign Payload ─────────────────────────────────────────────────────
export interface BtcSignPayload {
  type: 'btc';

  /** PSBT hex string */
  psbt: string;

  /** Transaction type */
  txType: 'legacy' | 'nested-segwit' | 'native-segwit' | 'taproot';

  /** Whether this is a multisig transaction */
  isMultisig: boolean;

  /** Wallet policy (required for Ledger multisig) */
  walletPolicy?: WalletPolicy;

  /** Wallet HMAC from device registration (hex string) */
  walletHmac?: string;
}

export interface WalletPolicy {
  /** Policy name */
  name: string;

  /** Descriptor template */
  descriptorTemplate: string;

  /** Sorted key infos */
  keys: string[];

  /** HMAC from device registration */
  hmac?: string;
}

// ─── KeyVault Sign Payload ──────────────────────────────────────────────
export interface KeyVaultSignPayload {
  type: 'keyvault';
  payloadJson: string;
  signerId: string;
}

/** @deprecated Use {@link KeyVaultSignPayload} instead. */
export type KeyVaultEvmSignPayload = KeyVaultSignPayload;

// ─── EVM Sign Payload ─────────────────────────────────────────────────────
export interface EvmSignPayload {
  type: 'evm';

  /** EIP-712 TypedData (for Gnosis Safe) */
  typedData: EIP712TypedData;

  /** Safe transaction hash */
  safeTxHash: string;
}

export interface EIP712TypedData {
  domain: EIP712Domain;
  types: Record<string, EIP712Type[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export interface EIP712Type {
  name: string;
  type: string;
}
