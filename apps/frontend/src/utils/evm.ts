// ═══════════════════════════════════════════════════════════════════════════
// EVM utility functions
// ═══════════════════════════════════════════════════════════════════════════

import type { AddEthereumChainParams } from '@multivault/wallet-connector';
import type { NetworkConfig, NodeConfig } from '../types/network';

interface NativeCurrencyExtra {
  native_currency?: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

/**
 * Build EIP-3085 addChainParams from platform network config and nodes.
 * Returns undefined if required data (native currency or RPC URLs) is missing,
 * which causes the caller to fall back to the original CHAIN_NOT_CONFIGURED error.
 */
export function buildAddChainParams(
  network: NetworkConfig,
  nodes: NodeConfig[],
): AddEthereumChainParams | undefined {
  const extra = network.extra as NativeCurrencyExtra | null;
  const nativeCurrency = extra?.native_currency;
  const rpcUrls = nodes
    .filter((n) => n.enabled && n.endpoint_url)
    .map((n) => n.endpoint_url);

  if (!nativeCurrency || rpcUrls.length === 0) {
    return undefined;
  }

  return {
    chainName: network.name,
    nativeCurrency,
    rpcUrls,
    blockExplorerUrls: network.explorer_url ? [network.explorer_url] : undefined,
  };
}
