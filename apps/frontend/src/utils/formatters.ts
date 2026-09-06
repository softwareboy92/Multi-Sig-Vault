/**
 * Shared formatting utilities (explorer URLs and clipboard).
 *
 * NOTE: For address truncation use utils/address.ts.
 *       For time formatting use utils/time.ts.
 *       For balance formatting use utils/format.ts.
 */

/**
 * Get block explorer URL for transaction.
 *
 * @param txHash        - Transaction hash
 * @param chainType     - Chain type ("EVM", "BTC", etc.)
 * @param btcNetwork    - BTC network type ("mainnet", "testnet4", "testnet3")
 * @param explorerBaseUrl - Network-configured explorer base URL (e.g. "https://sepolia.etherscan.io").
 *                          When provided, takes priority over the hardcoded mapping.
 */
export const getExplorerUrl = (
  txHash: string,
  chainType: string,
  btcNetwork?: string | null,
  explorerBaseUrl?: string | null,
): string => {
  // If an explicit explorer base URL is provided, use it directly
  if (explorerBaseUrl) {
    const base = explorerBaseUrl.replace(/\/+$/, "");
    return `${base}/tx/${txHash}`;
  }

  const explorers: Record<string, string> = {
    BTC: "https://blockchain.com/btc/tx/",
    BTC_TESTNET: "https://blockstream.info/testnet/tx/",
    BTC_TESTNET4: "https://mempool.space/testnet4/tx/",
  };

  if (chainType.toUpperCase() === "BTC") {
    const network = (btcNetwork || "mainnet").toLowerCase();
    if (network === "testnet4") {
      return `${explorers.BTC_TESTNET4}${txHash}`;
    }
    if (network === "testnet3" || network === "testnet") {
      return `${explorers.BTC_TESTNET}${txHash}`;
    }
    return `${explorers.BTC}${txHash}`;
  }

  return "";
};

/**
 * EVM chain-id → block explorer base URL mapping.
 * Used to build `/address/{addr}` links for the deploy flow etc.
 */
const EVM_EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  10: "https://optimistic.etherscan.io",
  42161: "https://arbiscan.io",
  137: "https://polygonscan.com",
  8453: "https://basescan.org",
  56: "https://bscscan.com",
  100: "https://gnosisscan.io",
};

/**
 * Get block explorer URL for an address.
 *
 * @param address         - The address to link to
 * @param chainId         - EVM chain id (used for fallback lookup)
 * @param explorerBaseUrl - Network-configured explorer base URL. Takes priority over chain-id lookup.
 */
export const getAddressExplorerUrl = (
  address: string,
  chainId: number,
  explorerBaseUrl?: string | null,
): string => {
  const base = explorerBaseUrl
    ? explorerBaseUrl.replace(/\/+$/, "")
    : EVM_EXPLORERS[chainId];
  return base ? `${base}/address/${address}` : "";
};

/**
 * Copy text to clipboard
 * @param text - Text to copy
 * @returns Promise<boolean> - Success status
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  }
};
