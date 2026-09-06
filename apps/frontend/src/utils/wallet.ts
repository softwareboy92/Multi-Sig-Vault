import type { Wallet } from "../types";
import { EVM_NATIVE_SYMBOLS } from "./format";

/**
 * Derive a human-readable chain label for a wallet based on its chain_type
 * and network_id.  Shared between WalletPage, WalletDetailPage, etc.
 */
export function getWalletChainLabel(
  wallet: Pick<Wallet, "chain_type" | "network_id">,
  evmNetworkMap: Map<string, { name: string }>,
  btcNetworkMap: Map<string, { network?: string; btc_network?: string }>
): string {
  if (wallet.chain_type === "BTC") {
    const entry = wallet.network_id
      ? btcNetworkMap.get(wallet.network_id)
      : undefined;
    const networkName = entry?.btc_network ?? entry?.network;
    const network = (networkName || "mainnet").toLowerCase();
    if (network === "testnet4") return "BTC Testnet4";
    if (network === "testnet3" || network === "testnet") return "BTC Testnet3";
    return "BTC Mainnet";
  }
  if (wallet.network_id && evmNetworkMap.has(wallet.network_id)) {
    return evmNetworkMap.get(wallet.network_id)?.name || "EVM";
  }
  return "EVM";
}

/** Resolve a wallet's environment from the full network metadata collection. */
export function isWalletTestnet(
  wallet: Pick<Wallet, "chain_type" | "network_id">,
  evmNetworkMap: ReadonlyMap<string, { is_testnet: boolean }>,
  btcNetworkMap: ReadonlyMap<string, { is_testnet: boolean; network?: string | null; btc_network?: string | null }>,
): boolean {
  if (wallet.chain_type === "EVM") {
    return evmNetworkMap.get(wallet.network_id)?.is_testnet ?? false;
  }

  const network = btcNetworkMap.get(wallet.network_id);
  if (network) return network.is_testnet;
  return false;
}

/**
 * Get the native token symbol for a chain type.
 * For EVM, optionally pass chain_id to resolve non-ETH native tokens.
 */
export function getNativeSymbol(chainType: string, evmChainId?: number | null): string {
  switch (chainType) {
    case "BTC":
      return "BTC";
    case "EVM":
      if (evmChainId != null && EVM_NATIVE_SYMBOLS[evmChainId]) {
        return EVM_NATIVE_SYMBOLS[evmChainId];
      }
      return "ETH";
    default:
      return chainType;
  }
}
