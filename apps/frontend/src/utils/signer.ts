import type { Signer } from "../types";

/**
 * Shared source icon/label mapping for signer device types.
 * Re-used across SignatureAddressPage, SignatureAddressDetailPage,
 * ImportSignatureAddressForm, etc.
 */
export const SOURCE_ICON_MAP: Record<
  string,
  { label: string; icon: string }
> = {
  LEDGER: {
    label: "Ledger",
    icon: `${import.meta.env.BASE_URL}brand/icon_Ledger.png`,
  },
  METAMASK: {
    label: "MetaMask",
    icon: `${import.meta.env.BASE_URL}brand/icon_MetaMask.png`,
  },
  WALLETCONNECT: {
    label: "WalletConnect",
    icon: `${import.meta.env.BASE_URL}brand/icon_WalletConnect.png`,
  },
  KEYVAULT: {
    label: "KeyVault",
    icon: `${import.meta.env.BASE_URL}brand/icon_KeyVault.png`,
  },
};

/**
 * Determine if a BTC signer is on testnet.
 *
 * Priority:
 *   1. Wallet associations (authoritative — derived from network config)
 *   2. btc_network field in extra (from import metadata)
 *   3. Derivation path coin-type fallback
 *
 * When a signer is associated with wallets on BOTH mainnet and testnet,
 * returns `null` to signal ambiguity (caller must resolve).
 */
export function isBtcTestnet(
  signer: Pick<Signer, "chain_type" | "derivation_path" | "btc_network" | "wallets">
): boolean | null {
  if (signer.chain_type !== "BTC") return false;

  // 1. Derive from wallet associations (strongest signal)
  const wallets = signer.wallets ?? [];
  if (wallets.length > 0) {
    const hasTestnet = wallets.some((w) => w.is_testnet);
    const hasMainnet = wallets.some((w) => !w.is_testnet);
    if (hasTestnet && hasMainnet) return null; // mixed — caller decides
    return hasTestnet;
  }

  // 2. Explicit btc_network from import metadata
  if (signer.btc_network) {
    return signer.btc_network.toLowerCase().includes("test");
  }

  // 3. Fallback: infer from derivation path coin-type
  return (signer.derivation_path || "").startsWith("m/48'/1'") ||
    (signer.derivation_path || "").startsWith("m/84'/1'");
}

/**
 * Whether a signer belongs exclusively to testnet wallets.
 *
 * EVM addresses are reusable across networks, so an unassociated EVM signer
 * cannot be classified as testnet-only. For BTC signers without wallet
 * associations, fall back to their recorded network or derivation path.
 */
export function isSignerTestnetOnly(
  signer: Pick<Signer, "chain_type" | "derivation_path" | "btc_network" | "wallets">
): boolean {
  if (signer.chain_type !== "BTC") return false;

  const wallets = signer.wallets ?? [];
  if (wallets.length > 0) {
    return wallets.every((wallet) => wallet.is_testnet);
  }

  return isBtcTestnet(signer) === true;
}

/**
 * Get display chain label for a signer (e.g. "BTC_TESTNET", "BTC", "EVM").
 */
export function getSignerChainLabel(
  signer: Pick<Signer, "chain_type" | "derivation_path" | "btc_network" | "wallets">
): string {
  const testnet = isBtcTestnet(signer);
  if (testnet === true) return "BTC_TESTNET";
  if (testnet === null) return "BTC_MIXED"; // rare but possible
  return signer.chain_type;
}
