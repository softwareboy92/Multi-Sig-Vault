/**
 * EVM chain_id → KeyVault chain_type_value mapping (no backend lookup).
 */

export const EVM_CHAIN_SYMBOL_MAP: Record<number, string> = {
  1: "ETH",
  11155111: "SEPOLIA",
  56: "BSC",
  137: "POL",
  42161: "ARBITRUM",
  8453: "BASE",
  10: "OP",
  43114: "AVAX",
  250: "FTM",
  61: "ETC",
};

export function getChainSymbolForKeyVault(
  evmChainId?: number,
): string {
  if (evmChainId != null && EVM_CHAIN_SYMBOL_MAP[evmChainId]) {
    return EVM_CHAIN_SYMBOL_MAP[evmChainId];
  }
  return "ETH";
}
