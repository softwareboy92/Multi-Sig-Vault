// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Base Provider Implementation
// ═══════════════════════════════════════════════════════════════════════════

import type { WalletProvider } from './provider.js';
import type {
  Account,
  ChainType,
  ConnectOptions,
  SignResult,
  WalletState,
  WalletType,
} from '../types/wallet.js';
import type { SignPayload } from '../types/payload.js';
import { WalletEventEmitter } from './events.js';
import { WalletError, WalletErrorCode } from './errors.js';

/**
 * Abstract base class for wallet providers
 * Provides common functionality for all wallet implementations
 */
export abstract class BaseProvider extends WalletEventEmitter implements WalletProvider {
  abstract readonly walletType: WalletType;
  abstract readonly supportedChains: ChainType[];

  protected _state: WalletState = 'UNINITIALIZED';
  protected _account: Account | null = null;

  // ─── State ───────────────────────────────────────────────

  get state(): WalletState {
    return this._state;
  }

  get account(): Account | null {
    return this._account;
  }

  /**
   * Update state and emit event
   */
  protected updateState(newState: WalletState, reason?: string): void {
    const previousState = this._state;
    this._state = newState;
    this.emit('stateChange', {
      previousState,
      currentState: newState,
      reason,
    });
  }

  /**
   * Update account and emit event
   */
  protected updateAccount(newAccount: Account | null): void {
    const previousAccount = this._account;
    this._account = newAccount;
    this.emit('accountChange', {
      previousAccount,
      currentAccount: newAccount,
    });
  }

  // ─── Validation ──────────────────────────────────────────

  /**
   * Ensure provider is initialized
   */
  protected ensureInitialized(): void {
    if (this._state === 'UNINITIALIZED') {
      throw new WalletError(
        WalletErrorCode.NOT_INITIALIZED,
        'Provider not initialized. Call init() first.'
      );
    }
  }

  /**
   * Ensure provider is connected
   */
  protected ensureConnected(): void {
    this.ensureInitialized();
    if (this._state !== 'CONNECTED' && this._state !== 'SIGNING') {
      throw new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'Not connected to wallet'
      );
    }
    if (!this._account) {
      throw new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'No account available'
      );
    }
  }

  /**
   * Check if chain is supported
   */
  protected validateChain(chain: ChainType): void {
    if (!this.supportedChains.includes(chain)) {
      throw new WalletError(
        WalletErrorCode.CHAIN_NOT_SUPPORTED,
        `Chain ${chain} is not supported by ${this.walletType}`,
        { chain, supportedChains: this.supportedChains }
      );
    }
  }

  // ─── Utility ─────────────────────────────────────────────

  /**
   * Wrap an error with WalletError
   */
  protected wrapError(
    error: unknown,
    defaultCode: WalletErrorCode = WalletErrorCode.UNKNOWN_ERROR
  ): WalletError {
    return WalletError.from(error, defaultCode);
  }

  /**
   * Execute with timeout
   */
  protected async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorCode: WalletErrorCode = WalletErrorCode.OPERATION_TIMEOUT
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new WalletError(errorCode, `Operation timed out after ${timeoutMs}ms`)
        );
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (err) {
      clearTimeout(timeoutId!);
      throw err;
    }
  }

  // ─── Abstract Methods ────────────────────────────────────

  abstract init(): Promise<void>;
  abstract connect(options: ConnectOptions): Promise<Account>;
  abstract disconnect(): Promise<void>;
  abstract signMessage(message: string, account: Account): Promise<SignResult>;
  abstract signTransaction(payload: SignPayload, account: Account): Promise<SignResult>;

  // ─── Default Implementations ─────────────────────────────

  isConnected(): boolean {
    return this._state === 'CONNECTED' && this._account !== null;
  }

  async getAccount(): Promise<Account> {
    this.ensureConnected();
    return this._account!;
  }
}
