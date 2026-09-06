// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Main Entry Point
// ═══════════════════════════════════════════════════════════════════════════

// ─── Types ────────────────────────────────────────────────────────────────
export type {
  AddEthereumChainParams,
  ChainType,
  WalletType,
  WalletState,
  Account,
  BtcAccount,
  EvmAccount,
  ConnectOptions,
  SignResult,
} from './types/wallet.js';

export type {
  SignPayload,
  BtcSignPayload,
  EvmSignPayload,
  KeyVaultSignPayload,
  KeyVaultEvmSignPayload,
  WalletPolicy,
  EIP712TypedData,
  EIP712Domain,
  EIP712Type,
} from './types/payload.js';

export type {
  WalletEvent,
  WalletEventPayloads,
  WalletEventHandler,
  StateChangePayload,
  AccountChangePayload,
  ChainChangePayload,
  DisconnectPayload,
  ErrorPayload,
} from './types/events.js';

// ─── Core ─────────────────────────────────────────────────────────────────
export { WalletError, WalletErrorCode } from './core/errors.js';
export { WalletEventEmitter } from './core/events.js';
export { BaseProvider } from './core/base.js';
export type { WalletProvider } from './core/provider.js';

// ─── Providers ────────────────────────────────────────────────────────────
export {
  MetaMaskProvider,
  WalletConnectProvider,
  LedgerProvider,
  LedgerBtcAdapter,
  LedgerEthAdapter,
  KeyVaultProvider,
} from './providers/index.js';

export type {
  WalletConnectConfig,
  SessionInfo,
  LedgerConfig,
  LedgerAccount,
  LedgerTransport,
  TransportType,
  LedgerBtcPayload,
  KeyVaultConfig,
  KeyVaultConnectOptions,
} from './providers/index.js';

// ─── Utilities ────────────────────────────────────────────────────────────
export {
  toHex,
  hexToUtf8,
  toChecksumAddress,
  isHex,
  padHex,
  concatHex,
  bufferToHex,
  hexToBuffer,
} from './utils/encoding.js';
