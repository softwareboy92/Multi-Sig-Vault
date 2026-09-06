// ═══════════════════════════════════════════════════════════════════════════
// Base Provider Tests
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseProvider } from '../core/base.js';
import { WalletError, WalletErrorCode } from '../core/errors.js';
import type {
  Account,
  ChainType,
  ConnectOptions,
  SignResult,
  WalletType,
} from '../types/wallet.js';
import type { SignPayload } from '../types/payload.js';

// Concrete implementation for testing
class TestProvider extends BaseProvider {
  readonly walletType: WalletType = 'METAMASK';
  readonly supportedChains: ChainType[] = ['ETHEREUM'];

  async init(): Promise<void> {
    this.updateState('IDLE');
  }

  async connect(options: ConnectOptions): Promise<Account> {
    this.ensureInitialized();
    this.validateChain(options.chain);
    this.updateState('CONNECTING');

    const account: Account = {
      address: '0x1234567890abcdef',
      chain: options.chain,
      walletType: this.walletType,
    };

    this.updateAccount(account);
    this.updateState('CONNECTED');

    return account;
  }

  async disconnect(): Promise<void> {
    this.updateAccount(null);
    this.updateState('IDLE');
  }

  async signMessage(message: string, account: Account): Promise<SignResult> {
    this.ensureConnected();

    return {
      signature: '0xsignature',
      signerAddress: account.address,
      signedAt: new Date(),
    };
  }

  async signTransaction(
    payload: SignPayload,
    account: Account
  ): Promise<SignResult> {
    this.ensureConnected();

    return {
      signature: '0xtxsignature',
      signerAddress: account.address,
      signedAt: new Date(),
    };
  }

  // Expose protected methods for testing
  public testUpdateState(
    state: 'UNINITIALIZED' | 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'SIGNING' | 'ERROR',
    errorMessage?: string
  ) {
    this.updateState(state, errorMessage);
  }

  public testUpdateAccount(account: Account | null) {
    this.updateAccount(account);
  }

  public testWrapError(err: unknown, defaultCode: WalletErrorCode) {
    return this.wrapError(err, defaultCode);
  }

  public testWithTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    errorCode: WalletErrorCode
  ): Promise<T> {
    return this.withTimeout(promise, timeout, errorCode);
  }
}

describe('BaseProvider', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
  });

  describe('initial state', () => {
    it('should start in UNINITIALIZED state', () => {
      expect(provider.state).toBe('UNINITIALIZED');
    });

    it('should have null account initially', () => {
      expect(provider.account).toBeNull();
    });
  });

  describe('updateState', () => {
    it('should emit stateChange event', () => {
      const handler = vi.fn();
      provider.on('stateChange', handler);

      provider.testUpdateState('IDLE');

      expect(handler).toHaveBeenCalledWith({
        previousState: 'UNINITIALIZED',
        currentState: 'IDLE',
      });
    });

    it('should include reason in event', () => {
      const handler = vi.fn();
      provider.on('stateChange', handler);

      provider.testUpdateState('ERROR', 'Test error');

      expect(handler).toHaveBeenCalledWith({
        previousState: 'UNINITIALIZED',
        currentState: 'ERROR',
        reason: 'Test error',
      });
    });
  });

  describe('updateAccount', () => {
    it('should emit accountChange event', () => {
      const handler = vi.fn();
      provider.on('accountChange', handler);

      const account: Account = {
        address: '0x1234',
        chain: 'ETHEREUM',
        walletType: 'METAMASK',
      };

      provider.testUpdateAccount(account);

      expect(handler).toHaveBeenCalledWith({
        previousAccount: null,
        currentAccount: account,
      });
    });
  });

  describe('ensureInitialized', () => {
    it('should throw when not initialized', async () => {
      await expect(provider.connect({ chain: 'ETHEREUM' })).rejects.toThrow(
        WalletError
      );
    });

    it('should not throw when initialized', async () => {
      await provider.init();
      await expect(provider.connect({ chain: 'ETHEREUM' })).resolves.toBeDefined();
    });
  });

  describe('ensureConnected', () => {
    it('should throw when not connected', async () => {
      await provider.init();

      await expect(
        provider.signMessage('test', {
          address: '0x1234',
          chain: 'ETHEREUM',
          walletType: 'METAMASK',
        })
      ).rejects.toThrow(WalletError);
    });

    it('should not throw when connected', async () => {
      await provider.init();
      await provider.connect({ chain: 'ETHEREUM' });

      await expect(
        provider.signMessage('test', {
          address: '0x1234',
          chain: 'ETHEREUM',
          walletType: 'METAMASK',
        })
      ).resolves.toBeDefined();
    });
  });

  describe('validateChain', () => {
    it('should throw for unsupported chain', async () => {
      await provider.init();

      await expect(
        provider.connect({ chain: 'BITCOIN' as ChainType })
      ).rejects.toThrow(WalletError);
    });

    it('should not throw for supported chain', async () => {
      await provider.init();

      await expect(provider.connect({ chain: 'ETHEREUM' })).resolves.toBeDefined();
    });
  });

  describe('wrapError', () => {
    it('should pass through WalletError unchanged', () => {
      const original = new WalletError(WalletErrorCode.USER_REJECTED, 'Rejected');
      const wrapped = provider.testWrapError(original, WalletErrorCode.INTERNAL_ERROR);

      expect(wrapped).toBe(original);
    });

    it('should wrap standard Error with message', () => {
      const original = new Error('Something went wrong');
      const wrapped = provider.testWrapError(original, WalletErrorCode.INTERNAL_ERROR);

      expect(wrapped).toBeInstanceOf(WalletError);
      expect(wrapped.code).toBe(WalletErrorCode.INTERNAL_ERROR);
      expect(wrapped.message).toBe('Something went wrong');
    });

    it('should wrap unknown errors', () => {
      const wrapped = provider.testWrapError('string error', WalletErrorCode.UNKNOWN_ERROR);

      expect(wrapped).toBeInstanceOf(WalletError);
      expect(wrapped.message).toBe('string error');
    });
  });

  describe('withTimeout', () => {
    it('should resolve if promise resolves in time', async () => {
      const promise = Promise.resolve('success');

      const result = await provider.testWithTimeout(
        promise,
        1000,
        WalletErrorCode.OPERATION_TIMEOUT
      );

      expect(result).toBe('success');
    });

    it('should reject with timeout error if promise takes too long', async () => {
      const promise = new Promise((resolve) => setTimeout(resolve, 2000));

      await expect(
        provider.testWithTimeout(promise, 100, WalletErrorCode.OPERATION_TIMEOUT)
      ).rejects.toThrow(WalletError);
    });

    it('should reject with original error if promise rejects', async () => {
      const promise = Promise.reject(new Error('Original error'));

      await expect(
        provider.testWithTimeout(promise, 1000, WalletErrorCode.OPERATION_TIMEOUT)
      ).rejects.toThrow('Original error');
    });
  });

  describe('connect flow', () => {
    it('should go through correct state transitions', async () => {
      const stateChanges: string[] = [];
      provider.on('stateChange', ({ currentState }) => {
        stateChanges.push(currentState);
      });

      await provider.init();
      await provider.connect({ chain: 'ETHEREUM' });

      expect(stateChanges).toEqual(['IDLE', 'CONNECTING', 'CONNECTED']);
    });
  });

  describe('disconnect flow', () => {
    it('should reset account and state', async () => {
      await provider.init();
      await provider.connect({ chain: 'ETHEREUM' });

      expect(provider.account).not.toBeNull();
      expect(provider.state).toBe('CONNECTED');

      await provider.disconnect();

      expect(provider.account).toBeNull();
      expect(provider.state).toBe('IDLE');
    });
  });
});
