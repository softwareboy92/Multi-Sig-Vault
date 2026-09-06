// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Wallet Provider Interface
// ═══════════════════════════════════════════════════════════════════════════

import type {
  Account,
  ChainType,
  ConnectOptions,
  SignResult,
  WalletState,
  WalletType,
} from '../types/wallet.js';
import type { SignPayload } from '../types/payload.js';
import type { WalletEvent, WalletEventHandler } from '../types/events.js';

/**
 * Abstract wallet provider interface
 * All wallet types must implement this interface
 */
export interface WalletProvider {
  /** Provider type identifier */
  readonly walletType: WalletType;

  /** List of supported chains */
  readonly supportedChains: ChainType[];

  /** Current state */
  readonly state: WalletState;

  /** Currently connected account */
  readonly account: Account | null;

  // ─── Lifecycle ───────────────────────────────────────────

  /**
   * Initialize the provider
   * - Ledger: No-op
   * - MetaMask: Detect window.ethereum
   * - WalletConnect: Initialize EthereumProvider
   */
  init(): Promise<void>;

  /**
   * Connect wallet and get account
   * @throws WalletError on connection failure
   */
  connect(options: ConnectOptions): Promise<Account>;

  /**
   * Disconnect and release resources
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected
   */
  isConnected(): boolean;

  // ─── Account ─────────────────────────────────────────────

  /**
   * Get current account
   * @throws WalletError if not connected
   */
  getAccount(): Promise<Account>;

  /**
   * Switch chain (EVM wallets only)
   * @throws WalletError if chain not supported or user rejected
   */
  switchChain?(chainId: number): Promise<void>;

  // ─── Signing ─────────────────────────────────────────────

  /**
   * Sign a message (for challenge verification)
   *
   * @param message - Message to sign (UTF-8 string)
   * @param account - Account to sign with
   * @returns Sign result
   */
  signMessage(message: string, account: Account): Promise<SignResult>;

  /**
   * Sign a transaction
   *
   * @param payload - Chain-specific sign payload
   * @param account - Account to sign with
   * @returns Sign result
   */
  signTransaction(payload: SignPayload, account: Account): Promise<SignResult>;

  // ─── Events ──────────────────────────────────────────────

  /**
   * Subscribe to events
   */
  on<E extends WalletEvent>(event: E, handler: WalletEventHandler<E>): void;

  /**
   * Unsubscribe from events
   */
  off<E extends WalletEvent>(event: E, handler: WalletEventHandler<E>): void;
}
