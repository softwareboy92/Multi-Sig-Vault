// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - WalletConnect Provider
// ═══════════════════════════════════════════════════════════════════════════

import { BaseProvider } from '../core/base.js';
import { WalletError, WalletErrorCode } from '../core/errors.js';
import type {
  Account,
  AddEthereumChainParams,
  ChainType,
  ConnectOptions,
  EvmAccount,
  SignResult,
  WalletType,
} from '../types/wallet.js';
import type { SignPayload, EvmSignPayload } from '../types/payload.js';
import { toChecksumAddress, toHex } from '../utils/encoding.js';

// ─── WalletConnect Config ─────────────────────────────────────────────────
export interface WalletConnectConfig {
  projectId: string;
  metadata: {
    name: string;
    description: string;
    url: string;
    icons: string[];
  };
  chains: number[];
  optionalChains?: number[];
  showQrModal?: boolean;
}

// ─── WalletConnect Provider Types ─────────────────────────────────────────
interface WCEthereumProvider {
  accounts: string[];
  chainId: number;
  session: WCSession | null;
  enable(): Promise<string[]>;
  disconnect(): Promise<void>;
  request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

interface WCSession {
  topic: string;
  expiry: number;
  peer: {
    metadata: {
      name: string;
      icons: string[];
    };
  };
}

// ─── Session Info ─────────────────────────────────────────────────────────
export interface SessionInfo {
  topic: string;
  peerName: string;
  peerIcon: string;
  expiry: Date;
}

// ─── Timeout Constants ────────────────────────────────────────────────────
const CONNECT_TIMEOUT = 120_000; // 120s for QR scan + confirmation
const SIGN_TIMEOUT = 120_000; // 120s for signing

/**
 * WalletConnect V2 wallet provider
 * Uses @walletconnect/ethereum-provider
 */
export class WalletConnectProvider extends BaseProvider {
  readonly walletType: WalletType = 'WALLETCONNECT';
  readonly supportedChains: ChainType[] = ['ETHEREUM'];

  private config: WalletConnectConfig;
  private provider: WCEthereumProvider | null = null;
  private boundHandlers: {
    accountsChanged?: (accounts: unknown) => void;
    chainChanged?: (chainId: unknown) => void;
    disconnect?: () => void;
    sessionDelete?: () => void;
  } = {};
  private _disconnecting = false;

  constructor(config: WalletConnectConfig) {
    super();
    this.config = config;
  }

  // ─── Initialization ──────────────────────────────────────

  async init(): Promise<void> {
    if (this._state !== 'UNINITIALIZED') {
      return;
    }

    try {
      // Dynamic import to avoid bundling issues
      const { EthereumProvider } = await import(
        '@walletconnect/ethereum-provider'
      );

      // WC V2 ChainsProps: when chains is empty, optionalChains must have ≥1 element
      const optionalChains =
        this.config.optionalChains && this.config.optionalChains.length > 0
          ? (this.config.optionalChains as [number, ...number[]])
          : ([1] as [number]);

      this.provider = (await EthereumProvider.init({
        projectId: this.config.projectId,
        metadata: this.config.metadata,
        showQrModal: this.config.showQrModal ?? true,
        chains: this.config.chains,
        optionalChains,
      })) as unknown as WCEthereumProvider;

      this.updateState('IDLE');
    } catch (err) {
      this.updateState('ERROR', 'Failed to initialize WalletConnect');
      throw this.wrapError(err, WalletErrorCode.CONNECTION_FAILED);
    }
  }

  // ─── Connection ──────────────────────────────────────────

  /**
   * Check if there's an existing cached session
   */
  hasExistingSession(): boolean {
    return this.provider?.session != null;
  }

  private clearLocalStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('wc@2:') || key.startsWith('walletconnect'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  }

  /**
   * Clear cached session data to force a new connection
   * This removes the session from localStorage and disconnects
   */
  async clearSession(): Promise<void> {
    this.removeEventListeners();

    if (this.provider?.session) {
      try {
        await this.provider.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }

    this.clearLocalStorage();

    this.updateAccount(null);
    this.updateState('UNINITIALIZED');
    this.provider = null;
    await this.init();
  }

  async connect(options: ConnectOptions & { forceNew?: boolean }): Promise<Account> {
    this.ensureInitialized();
    this.validateChain(options.chain);

    if (!this.provider) {
      throw new WalletError(
        WalletErrorCode.NOT_INITIALIZED,
        'Provider not initialized'
      );
    }

    // If forceNew is true, clear existing session first
    if (options.forceNew && this.provider.session) {
      await this.clearSession();
    }

    this.updateState('CONNECTING');

    try {
      // Enable shows QR code and waits for connection
      await this.withTimeout(
        this.provider.enable(),
        options.timeout ?? CONNECT_TIMEOUT,
        WalletErrorCode.CONNECTION_TIMEOUT
      );

      const accounts = this.provider.accounts;
      let chainId = this.provider.chainId;

      if (!accounts || accounts.length === 0) {
        throw new WalletError(
          WalletErrorCode.USER_REJECTED,
          'User rejected connection'
        );
      }

      // Switch chain if needed — fatal, aligned with MetaMask
      if (options.evmChainId && chainId !== options.evmChainId) {
        await this.switchChain(options.evmChainId, options.addChainParams);
        chainId = options.evmChainId;
      }

      const account: EvmAccount = {
        address: toChecksumAddress(accounts[0]),
        chain: 'ETHEREUM',
        walletType: 'WALLETCONNECT',
      };

      this.updateAccount(account);
      this.setupEventListeners();
      this.updateState('CONNECTED');

      return account;
    } catch (err) {
      this.updateState('ERROR');
      throw this.wrapError(err, WalletErrorCode.CONNECTION_FAILED);
    }
  }

  async disconnect(): Promise<void> {
    this.removeEventListeners();

    if (this.provider) {
      try {
        await this.provider.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }

    this.updateAccount(null);
    this.updateState('IDLE');
  }

  async destroy(): Promise<void> {
    this.removeEventListeners();
    if (this.provider?.session) {
      try {
        await this.provider.disconnect();
      } catch {
        // Ignore — relay may be unreachable
      }
    }
    this.clearLocalStorage();
    this._account = null;
    this._state = 'UNINITIALIZED';
    this.provider = null;
  }

  async tryRestore(): Promise<Account | null> {
    if (this._state === 'UNINITIALIZED') {
      await this.init();
    }
    if (!this.provider?.session) return null;

    const session = this.provider.session;
    if (session.expiry * 1000 < Date.now()) {
      await this.clearSession();
      return null;
    }

    const accounts = this.provider.accounts;
    if (!accounts?.length) {
      await this.clearSession();
      return null;
    }

    const account: EvmAccount = {
      address: toChecksumAddress(accounts[0]),
      chain: 'ETHEREUM',
      walletType: 'WALLETCONNECT',
    };

    this.updateAccount(account);
    this.setupEventListeners();
    this.updateState('CONNECTED');
    return account;
  }

  // ─── Chain Switching ─────────────────────────────────────

  async switchChain(chainId: number, addChainParams?: AddEthereumChainParams): Promise<void> {
    this.ensureInitialized();

    if (!this.provider) {
      throw new WalletError(
        WalletErrorCode.NOT_INITIALIZED,
        'Provider not initialized'
      );
    }

    const chainIdHex = toHex(chainId);

    try {
      await this.provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });
    } catch (err: unknown) {
      const error = err as { code?: number };
      // Chain not added (4902) — attempt EIP-3085 wallet_addEthereumChain
      if (error.code === 4902) {
        if (!addChainParams) {
          throw new WalletError(
            WalletErrorCode.CHAIN_NOT_CONFIGURED,
            `Chain ${chainId} not configured in wallet and no addChainParams provided`,
            { chainId }
          );
        }

        await this.provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chainIdHex,
            chainName: addChainParams.chainName,
            nativeCurrency: addChainParams.nativeCurrency,
            rpcUrls: addChainParams.rpcUrls,
            blockExplorerUrls: addChainParams.blockExplorerUrls ?? [],
          }],
        });

        // Re-switch after adding
        await this.provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        });

        return;
      }
      throw this.wrapError(err, WalletErrorCode.CHAIN_NOT_SUPPORTED);
    }
  }

  // ─── Signing ─────────────────────────────────────────────

  async signMessage(message: string, account: Account): Promise<SignResult> {
    this.ensureConnected();

    if (!this.provider) {
      throw new WalletError(
        WalletErrorCode.NOT_INITIALIZED,
        'Provider not initialized'
      );
    }

    this.updateState('SIGNING');

    try {
      const signature = await this.withTimeout(
        this.provider.request<string>({
          method: 'personal_sign',
          params: [toHex(message), account.address],
        }),
        SIGN_TIMEOUT,
        WalletErrorCode.OPERATION_TIMEOUT
      );

      this.updateState('CONNECTED');

      return {
        signature,
        signerAddress: account.address,
        signedAt: new Date(),
      };
    } catch (err) {
      if (this.provider?.session) {
        this.updateState('CONNECTED');
      } else {
        this.updateAccount(null);
        this.updateState('IDLE');
      }
      throw this.wrapError(err, WalletErrorCode.SIGNING_FAILED);
    }
  }

  async signTransaction(
    payload: SignPayload,
    account: Account
  ): Promise<SignResult> {
    if (payload.type !== 'evm') {
      throw new WalletError(
        WalletErrorCode.CHAIN_NOT_SUPPORTED,
        'Only EVM chain is supported by WalletConnect'
      );
    }

    this.ensureConnected();

    if (!this.provider) {
      throw new WalletError(
        WalletErrorCode.NOT_INITIALIZED,
        'Provider not initialized'
      );
    }

    this.updateState('SIGNING');

    try {
      const evmPayload = payload as EvmSignPayload;

      const signature = await this.withTimeout(
        this.provider.request<string>({
          method: 'eth_signTypedData_v4',
          params: [account.address, JSON.stringify(evmPayload.typedData)],
        }),
        SIGN_TIMEOUT,
        WalletErrorCode.OPERATION_TIMEOUT
      );

      this.updateState('CONNECTED');

      return {
        signature,
        signerAddress: account.address,
        signedAt: new Date(),
      };
    } catch (err) {
      if (this.provider?.session) {
        this.updateState('CONNECTED');
      } else {
        this.updateAccount(null);
        this.updateState('IDLE');
      }
      throw this.wrapError(err, WalletErrorCode.SIGNING_FAILED);
    }
  }

  // ─── Session Info ────────────────────────────────────────

  getSession(): SessionInfo | null {
    if (!this.provider?.session) {
      return null;
    }

    const session = this.provider.session;
    return {
      topic: session.topic,
      peerName: session.peer.metadata.name,
      peerIcon: session.peer.metadata.icons?.[0] ?? '',
      expiry: new Date(session.expiry * 1000),
    };
  }

  // ─── Event Handling ──────────────────────────────────────

  private handleDisconnectEvent(reason: 'device' | 'timeout'): void {
    if (this._state === 'IDLE' || this._state === 'UNINITIALIZED' || this._disconnecting) return;
    this._disconnecting = true;
    try {
      this.removeEventListeners();
      this.updateAccount(null);
      this.updateState('IDLE');
      this.emit('disconnect', { reason });
    } finally {
      this._disconnecting = false;
    }
  }

  private setupEventListeners(): void {
    if (!this.provider) return;

    this.boundHandlers.accountsChanged = (accounts: unknown) => {
      const accountList = accounts as string[];

      if (accountList.length === 0) {
        this.updateAccount(null);
        this.updateState('IDLE');
        this.emit('disconnect', { reason: 'user' });
      } else {
        const newAccount: EvmAccount = {
          address: toChecksumAddress(accountList[0]),
          chain: 'ETHEREUM',
          walletType: 'WALLETCONNECT',
        };
        this.updateAccount(newAccount);
      }
    };

    this.boundHandlers.chainChanged = (chainId: unknown) => {
      this.emit('chainChange', {
        previousChainId: null,
        currentChainId: chainId as number,
      });
    };

    this.boundHandlers.disconnect = () => this.handleDisconnectEvent('device');

    this.boundHandlers.sessionDelete = () => this.handleDisconnectEvent('timeout');

    this.provider.on('accountsChanged', this.boundHandlers.accountsChanged);
    this.provider.on('chainChanged', this.boundHandlers.chainChanged);
    this.provider.on('disconnect', this.boundHandlers.disconnect);
    this.provider.on('session_delete', this.boundHandlers.sessionDelete);
  }

  private removeEventListeners(): void {
    if (!this.provider) return;

    if (this.boundHandlers.accountsChanged) {
      this.provider.removeListener(
        'accountsChanged',
        this.boundHandlers.accountsChanged
      );
    }
    if (this.boundHandlers.chainChanged) {
      this.provider.removeListener(
        'chainChanged',
        this.boundHandlers.chainChanged
      );
    }
    if (this.boundHandlers.disconnect) {
      this.provider.removeListener(
        'disconnect',
        this.boundHandlers.disconnect
      );
    }
    if (this.boundHandlers.sessionDelete) {
      this.provider.removeListener(
        'session_delete',
        this.boundHandlers.sessionDelete
      );
    }

    this.boundHandlers = {};
  }
}
