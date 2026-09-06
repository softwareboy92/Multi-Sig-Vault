// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Ledger Provider Types
// ═══════════════════════════════════════════════════════════════════════════

import type { ChainType, WalletType } from '../../types/wallet.js';

// ─── Transport Type ───────────────────────────────────────────────────────
export type TransportType = 'webhid' | 'webusb' | 'ble';

// ─── Base Transport Interface ─────────────────────────────────────────────
export interface LedgerTransport {
  close(): Promise<void>;
  send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Buffer
  ): Promise<Buffer>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

// ─── App Info ─────────────────────────────────────────────────────────────
export interface LedgerAppInfo {
  name: string;
  version: string;
}

// ─── Derivation Path ──────────────────────────────────────────────────────
export interface DerivationPath {
  purpose: number;
  coinType: number;
  account: number;
  change?: number;
  index?: number;
}

// ─── Ledger Account ───────────────────────────────────────────────────────
export interface LedgerAccount {
  address: string;
  chain: ChainType;
  walletType: WalletType;
  derivationPath: string;
  /** Compressed public key (33 bytes, hex) */
  publicKey?: string;
  /** Extended public key (for multisig key derivation) */
  xpub?: string;
  /** Master fingerprint (BTC only) */
  masterFingerprint?: string;
}

// ─── Chain Adapter Interface ──────────────────────────────────────────────
export interface LedgerChainAdapter<TPayload, TResult> {
  readonly chainType: ChainType;
  readonly requiredApp: string;

  /**
   * Get address from device
   */
  getAddress(
    transport: LedgerTransport,
    derivationPath: string,
    display: boolean
  ): Promise<{
    address: string;
    publicKey?: string;
    masterFingerprint?: string;
  }>;

  /**
   * Sign a transaction
   */
  signTransaction(
    transport: LedgerTransport,
    derivationPath: string,
    payload: TPayload
  ): Promise<TResult>;

  /**
   * Sign a message
   */
  signMessage(
    transport: LedgerTransport,
    derivationPath: string,
    message: string
  ): Promise<string>;
}

// ─── BTC Specific Types ───────────────────────────────────────────────────
export interface WalletPolicy {
  name: string;
  descriptorTemplate: string;
  keys: string[];
}

export interface PsbtInput {
  hash: string;
  index: number;
  witnessUtxo?: {
    script: Buffer;
    value: bigint;
  };
  nonWitnessUtxo?: Buffer;
}

export interface PsbtOutput {
  script: Buffer;
  value: bigint;
}

export interface BtcSignResult {
  // Array of [inputIndex, PartialSignature] - using array instead of Map
  // because multisig can have multiple signatures for the same input
  signatures: Array<[number, { pubkey: Buffer; signature: Buffer }]>;
}

// ─── ETH Specific Types ───────────────────────────────────────────────────
export interface EthSignResult {
  v: number;
  r: string;
  s: string;
  signature: string;
}

export interface EIP712Domain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
  salt?: string;
}

export interface EIP712TypedData {
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  domain: EIP712Domain;
  message: Record<string, unknown>;
}
