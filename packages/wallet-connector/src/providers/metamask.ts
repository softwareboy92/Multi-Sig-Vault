// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - MetaMask Provider
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

// ─── EIP-1193 Provider Types ──────────────────────────────────────────────
interface EIP1193Provider {
  request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  providers?: EIP1193Provider[];
}

// ─── EIP-6963 Types ───────────────────────────────────────────────────────
interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

// ─── Timeout Constants ────────────────────────────────────────────────────
const CONNECT_TIMEOUT = 60_000; // 60s for user authorization
const SIGN_TIMEOUT = 120_000; // 120s for signing

/**
 * MetaMask wallet provider
 * Supports EIP-6963 multi-wallet discovery and EIP-1193 provider
 */
export class MetaMaskProvider extends BaseProvider {
  readonly walletType: WalletType = 'METAMASK';
  readonly supportedChains: ChainType[] = ['ETHEREUM'];

  private provider: EIP1193Provider | null = null;
  private discoveredProviders: Map<string, EIP6963ProviderDetail> = new Map();
  private boundHandlers: {
    accountsChanged?: (accounts: unknown) => void;
    chainChanged?: (chainId: unknown) => void;
    disconnect?: () => void;
  } = {};

  // ─── Initialization ──────────────────────────────────────

  async init(): Promise<void> {
    if (this._state !== 'UNINITIALIZED') {
      return;
    }

    // Try EIP-6963 discovery first
    this.setupEIP6963Discovery();

    // Wait for providers to announce themselves
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to find MetaMask provider
    this.provider = this.findMetaMaskProvider();

    if (!this.provider) {
      this.updateState('ERROR', 'MetaMask not found');
      throw new WalletError(
        WalletErrorCode.WALLET_NOT_FOUND,
        'MetaMask not installed. Please install MetaMask extension.',
        { walletName: 'MetaMask' }
      );
    }

    this.updateState('IDLE');
  }

  private setupEIP6963Discovery(): void {
    if (typeof window === 'undefined') return;

    const handleAnnouncement = (event: Event) => {
      const customEvent = event as CustomEvent<EIP6963ProviderDetail>;
      const { info, provider } = customEvent.detail;
      this.discoveredProviders.set(info.uuid, { info, provider });
    };

    window.addEventListener(
      'eip6963:announceProvider',
      handleAnnouncement as EventListener
    );

    // Request providers to announce themselves
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  }

  private findMetaMaskProvider(): EIP1193Provider | null {
    // Priority 1: EIP-6963 discovered MetaMask
    for (const { info, provider } of this.discoveredProviders.values()) {
      if (
        info.rdns === 'io.metamask' ||
        info.name.toLowerCase().includes('metamask')
      ) {
        return provider;
      }
    }

    // Priority 2: window.ethereum
    if (typeof window !== 'undefined') {
      const ethereum = (window as WindowWithEthereum).ethereum;
      if (ethereum) {
        // Check if MetaMask
        if (ethereum.isMetaMask) {
          // Handle multi-wallet case
          if (ethereum.providers) {
            const metamask = ethereum.providers.find((p) => p.isMetaMask);
            if (metamask) return metamask;
          }
          return ethereum;
        }
      }
    }

    return null;
  }

  // ─── Connection ──────────────────────────────────────────

  async connect(options: ConnectOptions): Promise<Account> {
    this.ensureInitialized();
    this.validateChain(options.chain);

    if (!this.provider) {
      throw new WalletError(
        WalletErrorCode.NOT_INITIALIZED,
        'Provider not initialized'
      );
    }

    this.updateState('CONNECTING');

    try {
      // Request accounts
      const accounts = await this.withTimeout(
        this.provider.request<string[]>({
          method: 'eth_requestAccounts',
        }),
        options.timeout ?? CONNECT_TIMEOUT,
        WalletErrorCode.CONNECTION_TIMEOUT
      );

      if (!accounts || accounts.length === 0) {
        throw new WalletError(
          WalletErrorCode.USER_REJECTED,
          'User rejected connection'
        );
      }

      // Switch chain if specified
      if (options.evmChainId) {
        await this.switchChain(options.evmChainId, options.addChainParams);
      }

      const account: EvmAccount = {
        address: toChecksumAddress(accounts[0]),
        chain: 'ETHEREUM',
        walletType: 'METAMASK',
      };

      this.updateAccount(account);
      this.setupEventListeners();
      this.updateState('CONNECTED');

      return account;
    } catch (err: unknown) {
      this.updateState('ERROR');
      throw this.handleProviderError(err);
    }
  }

  async disconnect(): Promise<void> {
    this.removeEventListeners();
    this.updateAccount(null);
    this.updateState('IDLE');
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
      // Chain not added (4902)
      if (error.code === 4902) {
        if (!addChainParams) {
          throw new WalletError(
            WalletErrorCode.CHAIN_NOT_CONFIGURED,
            `Chain ${chainId} not configured in MetaMask and no addChainParams provided`,
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

        await this.provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        });

        return;
      }
      throw this.handleProviderError(err);
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
      // personal_sign (EIP-191)
      const messageHex = toHex(message);

      const signature = await this.withTimeout(
        this.provider.request<string>({
          method: 'personal_sign',
          params: [messageHex, account.address],
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
    } catch (err: unknown) {
      this.updateState('CONNECTED');
      throw this.handleProviderError(err);
    }
  }

  async signTransaction(
    payload: SignPayload,
    account: Account
  ): Promise<SignResult> {
    if (payload.type !== 'evm') {
      throw new WalletError(
        WalletErrorCode.CHAIN_NOT_SUPPORTED,
        'Only EVM chain is supported by MetaMask'
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

      // EIP-712 TypedData signing
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
    } catch (err: unknown) {
      this.updateState('CONNECTED');
      throw this.handleProviderError(err);
    }
  }

  // ─── Event Handling ──────────────────────────────────────

  private setupEventListeners(): void {
    if (!this.provider) return;

    this.boundHandlers.accountsChanged = (accounts: unknown) => {
      const accountList = accounts as string[];
      const previousAccount = this._account;

      if (accountList.length === 0) {
        this.updateAccount(null);
        this.updateState('IDLE');
        this.emit('disconnect', { reason: 'user' });
      } else {
        const newAccount: EvmAccount = {
          address: toChecksumAddress(accountList[0]),
          chain: 'ETHEREUM',
          walletType: 'METAMASK',
        };
        this.updateAccount(newAccount);
      }

      this.emit('accountChange', {
        previousAccount,
        currentAccount: this._account,
      });
    };

    this.boundHandlers.chainChanged = (chainId: unknown) => {
      const chainIdStr = chainId as string;
      this.emit('chainChange', {
        previousChainId: null,
        currentChainId: parseInt(chainIdStr, 16),
      });
    };

    this.boundHandlers.disconnect = () => {
      this.updateAccount(null);
      this.updateState('IDLE');
      this.emit('disconnect', { reason: 'device' });
    };

    this.provider.on('accountsChanged', this.boundHandlers.accountsChanged);
    this.provider.on('chainChanged', this.boundHandlers.chainChanged);
    this.provider.on('disconnect', this.boundHandlers.disconnect);
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
      this.provider.removeListener('disconnect', this.boundHandlers.disconnect);
    }

    this.boundHandlers = {};
  }

  // ─── Error Handling ──────────────────────────────────────

  private handleProviderError(err: unknown): WalletError {
    const error = err as { code?: number; message?: string };

    // MetaMask error codes
    switch (error.code) {
      case 4001:
        return new WalletError(
          WalletErrorCode.USER_REJECTED,
          'User rejected the request'
        );
      case 4100:
        return new WalletError(
          WalletErrorCode.NOT_CONNECTED,
          'The requested method is not authorized'
        );
      case 4200:
        return new WalletError(
          WalletErrorCode.CHAIN_NOT_SUPPORTED,
          'The requested method is not supported'
        );
      case 4900:
        return new WalletError(
          WalletErrorCode.NOT_CONNECTED,
          'Provider is disconnected'
        );
      case 4901:
        return new WalletError(
          WalletErrorCode.CHAIN_NOT_CONFIGURED,
          'Chain is not connected'
        );
      case -32002:
        return new WalletError(
          WalletErrorCode.DEVICE_BUSY,
          'Request already pending. Please check MetaMask.'
        );
      default:
        return this.wrapError(err, WalletErrorCode.CONNECTION_FAILED);
    }
  }
}

// ─── Window Type Extension ────────────────────────────────────────────────
interface WindowWithEthereum extends Window {
  ethereum?: EIP1193Provider;
}
