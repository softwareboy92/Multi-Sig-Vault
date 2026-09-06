import { useCallback, useRef, useState } from 'react';
import { useWallet } from '@multivault/wallet-connector/react';
import {
  LedgerProvider,
  MetaMaskProvider,
  WalletConnectProvider,
  KeyVaultProvider,
} from '@multivault/wallet-connector';
import type { WalletProvider, SignPayload, WalletPolicy, WalletConnectConfig } from '@multivault/wallet-connector';
import type { ChainType as SdkChainType } from '@multivault/wallet-connector';
import type { ChainType, DeviceType } from '@/types';
import { useTranslation } from './useTranslation';
import { getErrorMessage } from '../utils/errorUtils';
import { useNetworkStore } from '../stores/useNetworkStore';
import { buildAddChainParams } from '../utils/evm';
import { lookupChain } from '../services/chainRegistry';

export interface WalletConnectionResult {
  address: string;
  publicKey?: string;
  derivationPath?: string;
  masterFingerprint?: string;
  xpub?: string;
}

export interface ConnectParams {
  chainType: ChainType;
  deviceType: DeviceType;
  derivationPath?: string;
  btcNetwork?: 'mainnet' | 'testnet' | 'testnet3' | 'testnet4';
  evmChainId?: number;
  /** Pre-known address for offline signers (KeyVault) */
  address?: string;
  /** Whether to show address on device during connect (Ledger only, default: true) */
  showOnDevice?: boolean;
}

function toSdkChainType(chainType: ChainType): SdkChainType {
  return chainType === 'BTC' ? 'BITCOIN' : 'ETHEREUM';
}

const DEFAULT_PATHS: Record<ChainType, string> = {
  BTC: "m/48'/0'/0'/2'",
  EVM: "m/44'/60'/0'/0/0",
};

const BTC_TESTNET_PATH = "m/48'/1'/0'/2'";

function buildWcConfig(evmChainId?: number): WalletConnectConfig {
  const baseOptionalChains = [1, 11155111, 137, 42161];
  const targetChainId = evmChainId || 1;
  const optionalChainsSet = new Set(baseOptionalChains);
  optionalChainsSet.add(targetChainId);

  return {
    projectId:
      import.meta.env.VITE_WC_PROJECT_ID ||
      '96962ee2d7c33bc614e95d1b46d4558e',
    metadata: {
      name: 'MultiVault',
      description: 'Multi-signature wallet management',
      url: window.location.origin,
      icons: [`${window.location.origin}/vite.svg`],
    },
    // Empty chains → no requiredNamespaces, so wallets like imToken
    // won't reject the session for missing a specific network.
    // All chains go into optionalChains (optionalNamespaces).
    chains: [],
    optionalChains: [...optionalChainsSet],
    showQrModal: true,
  };
}

export function useWalletConnection() {
  const wallet = useWallet();
  const { t } = useTranslation();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerRef = useRef<WalletProvider | null>(null);
  const wcProviderRef = useRef<WalletConnectProvider | null>(null);
  const disconnectingRef = useRef(false);

  const forceDisconnect = useCallback(async () => {
    if (disconnectingRef.current) return;
    disconnectingRef.current = true;
    try {
      if (wcProviderRef.current) {
        try {
          await wcProviderRef.current.destroy();
        } catch (err) {
          console.warn('[WalletConnection] WC destroy failed:', err);
        }
        wcProviderRef.current = null;
      }
      const provider = providerRef.current;
      if (provider) {
        try {
          await provider.disconnect();
        } catch (err) {
          console.warn('[WalletConnection] Provider disconnect failed:', err);
        }
        providerRef.current = null;
      }
      try {
        await wallet.disconnect();
      } catch (err) {
        console.warn('[WalletConnection] Wallet disconnect failed:', err);
      }
      setError(null);
    } finally {
      disconnectingRef.current = false;
    }
  }, [wallet]);

  const connect = useCallback(
    async (params: ConnectParams): Promise<WalletConnectionResult> => {
      const { chainType, deviceType, derivationPath: customPath } = params;

      if (deviceType === 'LEDGER' || deviceType === 'WALLETCONNECT') {
        await forceDisconnect();
      }

      setConnecting(true);
      setError(null);

      try {
        const sdkChain = toSdkChainType(chainType);
        let provider: WalletProvider;

        if (chainType === 'EVM') {
          if (deviceType === 'METAMASK') {
            provider = new MetaMaskProvider();
          } else if (deviceType === 'WALLETCONNECT') {
            if (wcProviderRef.current) {
              try {
                await wcProviderRef.current.destroy();
              } catch {
                // Ignore — old instance may already be dead
              }
              wcProviderRef.current = null;
            }
            const wcProvider = new WalletConnectProvider(buildWcConfig(params.evmChainId));
            wcProviderRef.current = wcProvider;
            provider = wcProvider;
          } else if (deviceType === 'LEDGER') {
            provider = new LedgerProvider();
          } else if (deviceType === 'KEYVAULT') {
            provider = new KeyVaultProvider();
          } else {
            throw new Error(`Unsupported EVM device: ${deviceType}`);
          }
        } else if (chainType === 'BTC') {
          if (deviceType === 'LEDGER') {
            provider = new LedgerProvider();
          } else if (deviceType === 'KEYVAULT') {
            provider = new KeyVaultProvider();
          } else {
            throw new Error(`BTC only supports Ledger and KeyVault, got: ${deviceType}`);
          }
        } else {
          throw new Error(`Unsupported chain type: ${chainType}`);
        }

        providerRef.current = provider;
        wallet.setProvider(provider);

        if (provider.state === 'UNINITIALIZED') {
          await provider.init();
        }

        if (deviceType === 'METAMASK') {
          const anyProvider = provider as any;
          const requestFn =
            typeof anyProvider.request === 'function'
              ? anyProvider.request.bind(anyProvider)
              : anyProvider.provider && typeof anyProvider.provider.request === 'function'
              ? anyProvider.provider.request.bind(anyProvider.provider)
              : null;
          if (requestFn) {
            try {
              await requestFn({
                method: 'wallet_requestPermissions',
                params: [{ eth_accounts: {} }],
              });
            } catch {
              // Ignore permission errors and fallback to request accounts
            }
            await requestFn({ method: 'eth_requestAccounts' });
          }
        }

        const isBtcLedger = chainType === 'BTC' && deviceType === 'LEDGER';
        const isTestnetPath = Boolean(customPath && (customPath.startsWith("m/48'/1'") || customPath.startsWith("m/84'/1'")));
        const useBtcTestnet =
          isBtcLedger &&
          (params.btcNetwork === 'testnet' ||
            params.btcNetwork === 'testnet3' ||
            params.btcNetwork === 'testnet4' ||
            isTestnetPath);
        const defaultPath = useBtcTestnet
          ? BTC_TESTNET_PATH
          : DEFAULT_PATHS[chainType];
        const finalPath = customPath || defaultPath;

        let connectOptions = {
          chain: sdkChain,
          derivationPath: finalPath,
          evmChainId: chainType === 'EVM' ? (params.evmChainId || 1) : undefined,
          ...(useBtcTestnet ? { network: 'testnet' as const } : {}),
          ...(params.address ? { address: params.address } : {}),
          ...(params.showOnDevice === false ? { showOnDevice: false } : {}),
        };

        // Auto-build addChainParams from network store for EIP-3085 support
        if (chainType === 'EVM' && params.evmChainId) {
          const storeState = useNetworkStore.getState();
          let evmList = storeState.networks['EVM'] ?? [];
          if (evmList.length === 0) {
            try {
              await storeState.fetchNetworks('EVM');
              evmList = useNetworkStore.getState().networks['EVM'] ?? [];
            } catch {
              evmList = [];
            }
          }
          const network = evmList.find((n) => n.chain_id === params.evmChainId);
          if (network) {
            const { nodes, fetchNodes } = useNetworkStore.getState();
            let networkNodes = nodes[network.id];
            if (!networkNodes) {
              try {
                await fetchNodes('EVM', network.id);
                networkNodes = useNetworkStore.getState().nodes[network.id] ?? [];
              } catch {
                networkNodes = [];
              }
            }
            let addChainParams = buildAddChainParams(network, networkNodes);
            // Fallback: if native_currency is missing in stored data, try chainid.network
            if (!addChainParams) {
              const rpcUrls = networkNodes
                .filter((n) => n.enabled && n.endpoint_url)
                .map((n) => n.endpoint_url);
              if (rpcUrls.length > 0) {
                try {
                  const chainInfo = await lookupChain(params.evmChainId);
                  if (chainInfo) {
                    addChainParams = {
                      chainName: network.name,
                      nativeCurrency: chainInfo.nativeCurrency,
                      rpcUrls,
                      blockExplorerUrls: network.explorer_url
                        ? [network.explorer_url]
                        : chainInfo.explorers?.[0]?.url
                          ? [chainInfo.explorers[0].url]
                          : undefined,
                    };
                  }
                } catch {
                  // chainid.network unavailable — proceed without addChainParams
                }
              }
            }
            if (addChainParams) {
              connectOptions = { ...connectOptions, addChainParams };
            }
          }
        }

        const account = await provider.connect(connectOptions);

        return {
          address: account.address,
          publicKey: account.publicKey,
          derivationPath: account.derivationPath,
          masterFingerprint: account.masterFingerprint,
          xpub: account.xpub,
        };
      } catch (err) {
        const message = getErrorMessage(err, t);
        setError(message);
        throw err;
      } finally {
        setConnecting(false);
      }
    },
    [wallet, forceDisconnect, t]
  );

  const signChallenge = useCallback(async (challenge: string): Promise<string> => {
    const provider = providerRef.current;
    if (!provider) throw new Error('Wallet not connected');
    if (!provider.account) throw new Error('No account connected');

    try {
      const result = await provider.signMessage(challenge, provider.account);
      return result.signature;
    } catch (err) {
      const message = getErrorMessage(err, t);
      setError(message);
      throw err;
    }
  }, [t]);

  const signTransaction = useCallback(
    async (payload: SignPayload): Promise<string> => {
      const provider = providerRef.current;
      if (!provider) throw new Error('Wallet not connected');
      if (!provider.account) throw new Error('No account connected');

      try {
        const result = await provider.signTransaction(payload, provider.account);
        return result.signature;
      } catch (err) {
        const message = getErrorMessage(err, t);
        setError(message);
        throw err;
      }
    },
    [t]
  );

  const registerBtcWalletPolicy = useCallback(
    async (policy: WalletPolicy): Promise<string> => {
      const provider = providerRef.current as any;
      if (!provider) throw new Error('Wallet not connected');
      if (typeof provider.registerWalletPolicy !== 'function') {
        throw new Error('Wallet policy registration not supported');
      }

      const result = await provider.registerWalletPolicy({
        name: policy.name,
        descriptorTemplate: policy.descriptorTemplate,
        keys: policy.keys,
      });

      const hmac = result?.hmac;
      if (!hmac) throw new Error('Missing wallet HMAC');

      if (typeof hmac === 'string') return hmac;
      if (hmac instanceof Uint8Array) {
        return Buffer.from(hmac).toString('hex');
      }

      try {
        return Buffer.from(hmac).toString('hex');
      } catch {
        throw new Error('Invalid wallet HMAC');
      }
    },
    []
  );

  const getDefaultPath = useCallback(
    (chainType: ChainType, useTestnet = false) => {
      if (chainType === 'BTC' && useTestnet) return BTC_TESTNET_PATH;
      return DEFAULT_PATHS[chainType];
    },
    []
  );

  const getAccount = useCallback(() => providerRef.current?.account ?? null, []);

  const verifyOnDevice = useCallback(async (): Promise<void> => {
    const provider = providerRef.current;
    if (!provider) throw new Error('Wallet not connected');
    if (typeof (provider as any).verifyAddressOnDevice !== 'function') {
      throw new Error('Device verification not supported for this wallet type');
    }
    try {
      await (provider as any).verifyAddressOnDevice();
    } catch (err) {
      const message = getErrorMessage(err, t);
      setError(message);
      throw err;
    }
  }, [t]);

  const getEip1193Provider = useCallback(() => {
    const provider = providerRef.current as any;
    if (!provider) return null;
    if (provider.request && typeof provider.request === 'function') {
      return provider;
    }
    if (provider.provider && typeof provider.provider.request === 'function') {
      return provider.provider;
    }
    if (typeof window !== 'undefined') {
      // @ts-expect-error window.ethereum
      if (window.ethereum) return window.ethereum;
    }
    return null;
  }, []);

  const cleanup = useCallback(async () => {
    try {
      await forceDisconnect();
    } catch {
      // Ensure cleanup never throws
    }
  }, [forceDisconnect]);

  return {
    connect,
    signChallenge,
    signTransaction,
    registerBtcWalletPolicy,
    getDefaultPath,
    getEip1193Provider,
    getAccount,
    verifyOnDevice,
    connecting,
    error,
    forceDisconnect,
    cleanup,
  };
}
