// ═══════════════════════════════════════════════════════════════════════════
// MetaMask Provider Tests
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaMaskProvider } from '../providers/metamask.js';
import { WalletError, WalletErrorCode } from '../core/errors.js';

// Mock ethereum provider
const createMockEthereum = () => ({
  isMetaMask: true,
  request: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
});

describe('MetaMaskProvider', () => {
  let provider: MetaMaskProvider;
  let mockEthereum: ReturnType<typeof createMockEthereum>;

  beforeEach(() => {
    mockEthereum = createMockEthereum();
    (globalThis.window as any).ethereum = mockEthereum;
    provider = new MetaMaskProvider();
  });

  afterEach(() => {
    (globalThis.window as any).ethereum = undefined;
  });

  describe('init', () => {
    it('should initialize when MetaMask is available', async () => {
      await provider.init();
      expect(provider.state).toBe('IDLE');
    });

    it('should throw when MetaMask is not available', async () => {
      (globalThis.window as any).ethereum = undefined;

      await expect(provider.init()).rejects.toThrow(WalletError);
      expect(provider.state).toBe('ERROR');
    });

    it('should not reinitialize if already initialized', async () => {
      await provider.init();
      await provider.init(); // Second call should be no-op
      expect(provider.state).toBe('IDLE');
    });
  });

  describe('connect', () => {
    beforeEach(async () => {
      await provider.init();
    });

    it('should connect and return account', async () => {
      mockEthereum.request.mockImplementation((args: { method: string }) => {
        if (args.method === 'eth_requestAccounts') {
          return Promise.resolve(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
        }
        if (args.method === 'eth_chainId') {
          return Promise.resolve('0x1');
        }
        return Promise.resolve(null);
      });

      const account = await provider.connect({ chain: 'ETHEREUM' });

      expect(account.address).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2');
      expect(account.chain).toBe('ETHEREUM');
      expect(account.walletType).toBe('METAMASK');
      expect(provider.state).toBe('CONNECTED');
    });

    it('should throw on user rejection', async () => {
      mockEthereum.request.mockRejectedValue({ code: 4001 });

      await expect(provider.connect({ chain: 'ETHEREUM' })).rejects.toThrow(
        WalletError
      );
      expect(provider.state).toBe('ERROR');
    });

    it('should switch chain if evmChainId is specified', async () => {
      mockEthereum.request.mockImplementation((args: { method: string }) => {
        if (args.method === 'eth_requestAccounts') {
          return Promise.resolve(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
        }
        if (args.method === 'eth_chainId') {
          return Promise.resolve('0x1');
        }
        if (args.method === 'wallet_switchEthereumChain') {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });

      await provider.connect({ chain: 'ETHEREUM', evmChainId: 137 });

      expect(mockEthereum.request).toHaveBeenCalledWith({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x89' }],
      });
    });
  });

  describe('disconnect', () => {
    it('should disconnect and reset state', async () => {
      await provider.init();
      mockEthereum.request.mockResolvedValue([
        '0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2',
      ]);
      await provider.connect({ chain: 'ETHEREUM' });

      await provider.disconnect();

      expect(provider.state).toBe('IDLE');
      expect(provider.account).toBeNull();
    });
  });

  describe('signMessage', () => {
    beforeEach(async () => {
      await provider.init();
      mockEthereum.request.mockImplementation((args: { method: string }) => {
        if (args.method === 'eth_requestAccounts') {
          return Promise.resolve(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
        }
        if (args.method === 'eth_chainId') {
          return Promise.resolve('0x1');
        }
        return Promise.resolve(null);
      });
      await provider.connect({ chain: 'ETHEREUM' });
    });

    it('should sign message and return signature', async () => {
      const signature = '0x1234567890abcdef';
      mockEthereum.request.mockResolvedValue(signature);

      const result = await provider.signMessage('Hello, World!', {
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2',
        chain: 'ETHEREUM',
        walletType: 'METAMASK',
      });

      expect(result.signature).toBe(signature);
      expect(result.signerAddress).toBe(
        '0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2'
      );
      expect(result.signedAt).toBeInstanceOf(Date);
    });

    it('should throw on user rejection', async () => {
      mockEthereum.request.mockRejectedValue({ code: 4001 });

      await expect(
        provider.signMessage('Hello', {
          address: '0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2',
          chain: 'ETHEREUM',
          walletType: 'METAMASK',
        })
      ).rejects.toThrow(WalletError);
    });
  });

  describe('signTransaction', () => {
    beforeEach(async () => {
      await provider.init();
      mockEthereum.request.mockImplementation((args: { method: string }) => {
        if (args.method === 'eth_requestAccounts') {
          return Promise.resolve(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
        }
        if (args.method === 'eth_chainId') {
          return Promise.resolve('0x1');
        }
        return Promise.resolve(null);
      });
      await provider.connect({ chain: 'ETHEREUM' });
    });

    it('should sign EIP-712 typed data', async () => {
      const signature = '0xsignature';
      mockEthereum.request.mockResolvedValue(signature);

      const payload = {
        type: 'evm' as const,
        safeTxHash: '0xhash',
        typedData: {
          domain: {
            name: 'Safe',
            version: '1.0.0',
            chainId: 1,
            verifyingContract: '0x1234',
          },
          types: {
            SafeTx: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
            ],
          },
          primaryType: 'SafeTx',
          message: {
            to: '0x5678',
            value: '1000000000000000000',
          },
        },
      };

      const result = await provider.signTransaction(payload, {
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2',
        chain: 'ETHEREUM',
        walletType: 'METAMASK',
      });

      expect(result.signature).toBe(signature);
      expect(mockEthereum.request).toHaveBeenCalledWith({
        method: 'eth_signTypedData_v4',
        params: [
          '0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2',
          JSON.stringify(payload.typedData),
        ],
      });
    });

    it('should throw for unsupported chain', async () => {
      const payload = {
        type: 'btc' as const,
        psbt: '0x1234',
        txType: 'native-segwit' as const,
        isMultisig: false,
      };

      await expect(
        provider.signTransaction(payload, {
          address: 'bc1q...',
          chain: 'BITCOIN',
          walletType: 'METAMASK',
        })
      ).rejects.toThrow(WalletError);
    });
  });

  describe('events', () => {
    it('should emit stateChange event', async () => {
      const handler = vi.fn();
      provider.on('stateChange', handler);

      await provider.init();

      expect(handler).toHaveBeenCalled();
    });

    it('should emit disconnect event on provider disconnect', async () => {
      await provider.init();
      const handler = vi.fn();
      provider.on('disconnect', handler);

      // Simulate MetaMask emitting disconnect
      const disconnectHandler = mockEthereum.on.mock.calls.find(
        (call: [string, Function]) => call[0] === 'disconnect'
      )?.[1];

      if (disconnectHandler) {
        disconnectHandler();
        expect(handler).toHaveBeenCalled();
      }
    });
  });

  describe('chain validation', () => {
    it('should validate supported chains', () => {
      expect(provider.supportedChains).toContain('ETHEREUM');
    });

    it('should throw for unsupported chain on connect', async () => {
      await provider.init();

      await expect(
        provider.connect({ chain: 'BITCOIN' as any })
      ).rejects.toThrow(WalletError);
    });
  });

  describe('switchChain with addChainParams', () => {
    const addChainParams = {
      chainName: 'Test Chain',
      nativeCurrency: { name: 'Test', symbol: 'TST', decimals: 18 },
      rpcUrls: ['https://rpc.test.com'],
      blockExplorerUrls: ['https://explorer.test.com'],
    };

    beforeEach(async () => {
      await provider.init();
      mockEthereum.request.mockImplementation((args: { method: string }) => {
        if (args.method === 'eth_requestAccounts') {
          return Promise.resolve(['0x742d35Cc6634C0532925a3b844Bc9e7595f1B1B2']);
        }
        return Promise.resolve(null);
      });
      await provider.connect({ chain: 'ETHEREUM' });
      mockEthereum.request.mockReset();
    });

    it('should call wallet_addEthereumChain then re-switch on 4902', async () => {
      let switchCallCount = 0;
      mockEthereum.request.mockImplementation((args: { method: string; params?: unknown[] }) => {
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

      expect(mockEthereum.request).toHaveBeenCalledWith({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x61',
          chainName: 'Test Chain',
          nativeCurrency: { name: 'Test', symbol: 'TST', decimals: 18 },
          rpcUrls: ['https://rpc.test.com'],
          blockExplorerUrls: ['https://explorer.test.com'],
        }],
      });
      expect(switchCallCount).toBe(2);
    });

    it('should throw CHAIN_NOT_CONFIGURED on 4902 without addChainParams', async () => {
      mockEthereum.request.mockRejectedValue({ code: 4902 });

      await expect(provider.switchChain(97)).rejects.toThrow(WalletError);
      await expect(provider.switchChain(97)).rejects.toMatchObject({
        code: WalletErrorCode.CHAIN_NOT_CONFIGURED,
      });
    });

    it('should not call addChain when switch succeeds', async () => {
      mockEthereum.request.mockResolvedValue(null);

      await provider.switchChain(1, addChainParams);

      expect(mockEthereum.request).toHaveBeenCalledTimes(1);
      expect(mockEthereum.request).toHaveBeenCalledWith({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x1' }],
      });
    });
  });
});
