// ═══════════════════════════════════════════════════════════════════════════
// WalletConnect Provider Tests
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletConnectProvider } from '../providers/walletconnect.js';
import { WalletError, WalletErrorCode } from '../core/errors.js';

// ─── Mock WC Provider ─────────────────────────────────────────────────────
const createMockWCProvider = () => ({
  accounts: [] as string[],
  chainId: 1,
  session: null as { topic: string; expiry: number; peer: { metadata: { name: string; icons: string[] } } } | null,
  enable: vi.fn(),
  disconnect: vi.fn(),
  request: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
});

type MockWCProvider = ReturnType<typeof createMockWCProvider>;
let mockWCProvider: MockWCProvider;

// Mock the dynamic import of @walletconnect/ethereum-provider
vi.mock('@walletconnect/ethereum-provider', () => ({
  EthereumProvider: {
    init: vi.fn(() => Promise.resolve(mockWCProvider)),
  },
}));

const defaultConfig = {
  projectId: 'test-project-id',
  metadata: {
    name: 'Test App',
    description: 'Test',
    url: 'https://test.com',
    icons: ['https://test.com/icon.png'],
  },
  chains: [1],
};

describe('WalletConnectProvider', () => {
  let provider: WalletConnectProvider;

  beforeEach(() => {
    mockWCProvider = createMockWCProvider();
    provider = new WalletConnectProvider(defaultConfig);
  });

  describe('init', () => {
    it('should initialize and transition to IDLE', async () => {
      await provider.init();
      expect(provider.state).toBe('IDLE');
    });

    it('should not reinitialize if already initialized', async () => {
      await provider.init();
      await provider.init();
      expect(provider.state).toBe('IDLE');
    });
  });

  describe('switchChain', () => {
    const addChainParams = {
      chainName: 'BSC Testnet',
      nativeCurrency: { name: 'BNB', symbol: 'tBNB', decimals: 18 },
      rpcUrls: ['https://data-seed-prebsc-1-s1.binance.org:8545'],
      blockExplorerUrls: ['https://testnet.bscscan.com'],
    };

    beforeEach(async () => {
      await provider.init();
    });

    it('should call wallet_switchEthereumChain with hex chainId', async () => {
      mockWCProvider.request.mockResolvedValue(null);

      await provider.switchChain(137);

      expect(mockWCProvider.request).toHaveBeenCalledWith({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x89' }],
      });
    });

    it('should call wallet_addEthereumChain then re-switch on 4902', async () => {
      let switchCallCount = 0;
      mockWCProvider.request.mockImplementation((args: { method: string }) => {
        if (args.method === 'wallet_switchEthereumChain') {
          switchCallCount++;
          if (switchCallCount === 1) {
            throw { code: 4902 };
          }
          return Promise.resolve(null);
        }
        if (args.method === 'wallet_addEthereumChain') {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });

      await provider.switchChain(97, addChainParams);

      expect(mockWCProvider.request).toHaveBeenCalledWith({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x61',
          chainName: 'BSC Testnet',
          nativeCurrency: { name: 'BNB', symbol: 'tBNB', decimals: 18 },
          rpcUrls: ['https://data-seed-prebsc-1-s1.binance.org:8545'],
          blockExplorerUrls: ['https://testnet.bscscan.com'],
        }],
      });
      expect(switchCallCount).toBe(2);
    });

    it('should throw CHAIN_NOT_CONFIGURED on 4902 without addChainParams', async () => {
      mockWCProvider.request.mockRejectedValue({ code: 4902 });

      await expect(provider.switchChain(97)).rejects.toThrow(WalletError);
      await expect(provider.switchChain(97)).rejects.toMatchObject({
        code: WalletErrorCode.CHAIN_NOT_CONFIGURED,
      });
    });

    it('should not call addChain when switch succeeds', async () => {
      mockWCProvider.request.mockResolvedValue(null);

      await provider.switchChain(1, addChainParams);

      expect(mockWCProvider.request).toHaveBeenCalledTimes(1);
      expect(mockWCProvider.request).toHaveBeenCalledWith({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x1' }],
      });
    });

    it('should rethrow non-4902 errors', async () => {
      mockWCProvider.request.mockRejectedValue({ code: -32603, message: 'Internal error' });

      await expect(provider.switchChain(42161)).rejects.toThrow(WalletError);
    });
  });

  describe('connect', () => {
    beforeEach(async () => {
      await provider.init();
    });

    it('should connect and return account', async () => {
      mockWCProvider.enable.mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
      mockWCProvider.accounts = ['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2'];
      mockWCProvider.chainId = 1;

      const account = await provider.connect({ chain: 'ETHEREUM' });

      expect(account.address).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2');
      expect(account.chain).toBe('ETHEREUM');
      expect(account.walletType).toBe('WALLETCONNECT');
      expect(provider.state).toBe('CONNECTED');
    });

    it('should switch chain and pass addChainParams on connect', async () => {
      mockWCProvider.enable.mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
      mockWCProvider.accounts = ['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2'];
      mockWCProvider.chainId = 1; // Connected on chain 1, want chain 97
      mockWCProvider.request.mockResolvedValue(null);

      const addChainParams = {
        chainName: 'BSC Testnet',
        nativeCurrency: { name: 'BNB', symbol: 'tBNB', decimals: 18 },
        rpcUrls: ['https://data-seed-prebsc-1-s1.binance.org:8545'],
      };

      const account = await provider.connect({
        chain: 'ETHEREUM',
        evmChainId: 97,
        addChainParams,
      });

      expect(account.address).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2');
      expect(mockWCProvider.request).toHaveBeenCalledWith({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x61' }],
      });
    });

    it('should fail connection when chain switch fails (fatal)', async () => {
      mockWCProvider.enable.mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
      mockWCProvider.accounts = ['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2'];
      mockWCProvider.chainId = 1; // Connected on chain 1, want chain 42161
      mockWCProvider.request.mockRejectedValue({ code: -32603, message: 'Unsupported chain' });

      await expect(
        provider.connect({ chain: 'ETHEREUM', evmChainId: 42161 })
      ).rejects.toThrow(WalletError);
      expect(provider.state).toBe('ERROR');
    });

    it('should not switch chain when already on target chain', async () => {
      mockWCProvider.enable.mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
      mockWCProvider.accounts = ['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2'];
      mockWCProvider.chainId = 137; // Already on target chain

      await provider.connect({ chain: 'ETHEREUM', evmChainId: 137 });

      expect(mockWCProvider.request).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: 'wallet_switchEthereumChain' })
      );
    });
  });

  describe('clearSession', () => {
    it('should emit stateChange events through updateState', async () => {
      await provider.init();
      mockWCProvider.enable.mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
      mockWCProvider.accounts = ['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2'];
      mockWCProvider.chainId = 1;
      await provider.connect({ chain: 'ETHEREUM' });

      const stateChanges: string[] = [];
      provider.on('stateChange', ({ currentState }) => {
        stateChanges.push(currentState);
      });

      await provider.clearSession();

      expect(stateChanges).toContain('UNINITIALIZED');
      expect(stateChanges).toContain('IDLE');
    });
  });

  describe('event handling', () => {
    it('should handle simultaneous disconnect and session_delete without duplicate events', async () => {
      await provider.init();
      mockWCProvider.enable.mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
      mockWCProvider.accounts = ['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2'];
      mockWCProvider.chainId = 1;
      await provider.connect({ chain: 'ETHEREUM' });

      const disconnectReasons: string[] = [];
      provider.on('disconnect', ({ reason }) => {
        disconnectReasons.push(reason);
      });

      const onCalls = mockWCProvider.on.mock.calls;
      const disconnectHandler = onCalls.find(
        (call: [string, Function]) => call[0] === 'disconnect'
      )?.[1] as (() => void) | undefined;
      const sessionDeleteHandler = onCalls.find(
        (call: [string, Function]) => call[0] === 'session_delete'
      )?.[1] as (() => void) | undefined;

      disconnectHandler?.();
      sessionDeleteHandler?.();

      expect(disconnectReasons.length).toBe(1);
      expect(provider.state).toBe('IDLE');
    });

    it('should ignore duplicate disconnect events after returning to IDLE', async () => {
      await provider.init();
      const disconnectHandler = vi.fn();
      provider.on('disconnect', disconnectHandler);

      mockWCProvider.enable.mockResolvedValue(['0xAbC0000000000000000000000000000000000001']);
      mockWCProvider.accounts = ['0xAbC0000000000000000000000000000000000001'];
      await provider.connect({ chain: 'ETHEREUM' });

      const onCallsAfterConnect = mockWCProvider.on.mock.calls;
      const handler = onCallsAfterConnect.find(
        (call: [string, Function]) => call[0] === 'disconnect'
      )?.[1] as (() => void) | undefined;

      handler?.();
      expect(provider.state).toBe('IDLE');
      disconnectHandler.mockClear();

      handler?.();
      expect(disconnectHandler).not.toHaveBeenCalled();
    });
  });

  describe('signing failure recovery', () => {
    beforeEach(async () => {
      await provider.init();
      mockWCProvider.enable.mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
      mockWCProvider.accounts = ['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2'];
      mockWCProvider.chainId = 1;
      await provider.connect({ chain: 'ETHEREUM' });
    });

    it('should recover to CONNECTED when session is still alive after signMessage failure', async () => {
      mockWCProvider.session = { topic: 'test', expiry: 9999999999, peer: { metadata: { name: 'Test', icons: [] } } };
      mockWCProvider.request.mockRejectedValue(new Error('User rejected'));

      const account = provider.account!;
      await expect(provider.signMessage('hello', account)).rejects.toThrow();
      expect(provider.state).toBe('CONNECTED');
    });

    it('should recover to IDLE when session is dead after signMessage failure', async () => {
      mockWCProvider.session = null;
      mockWCProvider.request.mockRejectedValue(new Error('Session expired'));

      const account = provider.account!;
      await expect(provider.signMessage('hello', account)).rejects.toThrow();
      expect(provider.state).toBe('IDLE');
      expect(provider.account).toBeNull();
    });

    it('should recover to IDLE when session is dead after signTransaction failure', async () => {
      mockWCProvider.session = null;
      mockWCProvider.request.mockRejectedValue(new Error('Session expired'));

      const account = provider.account!;
      const payload = {
        type: 'evm' as const,
        typedData: {
          types: { EIP712Domain: [] },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
      };
      await expect(provider.signTransaction(payload, account)).rejects.toThrow();
      expect(provider.state).toBe('IDLE');
      expect(provider.account).toBeNull();
    });
  });

  describe('destroy', () => {
    it('should clean up everything when connected', async () => {
      await provider.init();
      mockWCProvider.enable.mockResolvedValue(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
      mockWCProvider.accounts = ['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2'];
      mockWCProvider.session = { topic: 'test', expiry: 9999999999, peer: { metadata: { name: 'Test', icons: [] } } };
      mockWCProvider.chainId = 1;
      await provider.connect({ chain: 'ETHEREUM' });

      await provider.destroy();

      expect(provider.state).toBe('UNINITIALIZED');
      expect(provider.account).toBeNull();
      expect(mockWCProvider.disconnect).toHaveBeenCalled();
      expect(mockWCProvider.removeListener).toHaveBeenCalled();
    });

    it('should be safe to call on uninitialized provider', async () => {
      await expect(provider.destroy()).resolves.not.toThrow();
      expect(provider.state).toBe('UNINITIALIZED');
    });

    it('should be safe to call when already IDLE (no session)', async () => {
      await provider.init();
      await provider.destroy();
      expect(provider.state).toBe('UNINITIALIZED');
    });

    it('should not throw when disconnect rejects (relay unreachable)', async () => {
      await provider.init();
      mockWCProvider.session = { topic: 'test', expiry: 9999999999, peer: { metadata: { name: 'Test', icons: [] } } };
      mockWCProvider.disconnect.mockRejectedValue(new Error('Relay unreachable'));
      await expect(provider.destroy()).resolves.not.toThrow();
      expect(provider.state).toBe('UNINITIALIZED');
    });
  });

  describe('tryRestore', () => {
    it('should restore connection when valid session exists', async () => {
      await provider.init();
      mockWCProvider.session = {
        topic: 'test-topic',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        peer: { metadata: { name: 'TestWallet', icons: ['https://icon.png'] } },
      };
      mockWCProvider.accounts = ['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2'];

      const account = await provider.tryRestore();

      expect(account).not.toBeNull();
      expect(account!.address).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2');
      expect(account!.walletType).toBe('WALLETCONNECT');
      expect(provider.state).toBe('CONNECTED');
    });

    it('should return null and clear when session is expired', async () => {
      await provider.init();
      mockWCProvider.session = {
        topic: 'old-topic',
        expiry: Math.floor(Date.now() / 1000) - 100,
        peer: { metadata: { name: 'TestWallet', icons: [] } },
      };

      const account = await provider.tryRestore();
      expect(account).toBeNull();
      expect(provider.state).toBe('IDLE');
    });

    it('should return null when no session exists', async () => {
      await provider.init();
      mockWCProvider.session = null;
      const account = await provider.tryRestore();
      expect(account).toBeNull();
      expect(provider.state).toBe('IDLE');
    });

    it('should return null when session exists but no accounts', async () => {
      await provider.init();
      mockWCProvider.session = {
        topic: 'test-topic',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        peer: { metadata: { name: 'TestWallet', icons: [] } },
      };
      mockWCProvider.accounts = [];
      const account = await provider.tryRestore();
      expect(account).toBeNull();
    });

    it('should auto-initialize if called on UNINITIALIZED provider', async () => {
      mockWCProvider.session = null;
      const account = await provider.tryRestore();
      expect(account).toBeNull();
      expect(provider.state).toBe('IDLE');
    });
  });

  describe('connect edge cases', () => {
    it('should reject with USER_REJECTED when no accounts returned', async () => {
      await provider.init();
      mockWCProvider.enable.mockResolvedValue([]);
      mockWCProvider.accounts = [];
      await expect(
        provider.connect({ chain: 'ETHEREUM' })
      ).rejects.toMatchObject({
        code: WalletErrorCode.USER_REJECTED,
      });
    });

    it('should reject when connecting with unsupported chain', async () => {
      await provider.init();
      await expect(
        provider.connect({ chain: 'BITCOIN' })
      ).rejects.toThrow(WalletError);
    });
  });
});
