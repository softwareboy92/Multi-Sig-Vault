export function formatBalance(
  balance: string,
  decimals: number = 18,
  displayDecimals: number = 6,
): string {
  if (!balance || balance === '0') return '0';

  try {
    if (balance.includes('.')) {
      const num = parseFloat(balance);
      if (isNaN(num) || num < 0) return '0';
      if (num > 0 && num < Math.pow(10, -displayDecimals)) {
        return `< ${(0).toFixed(displayDecimals).slice(0, -1)}1`;
      }
      const formatted = num.toFixed(displayDecimals);
      return formatted.replace(/\.?0+$/, '') || '0';
    }

    const value = BigInt(balance);
    if (value <= 0n) return '0';

    const divisor = BigInt(10 ** decimals);
    const integerPart = value / divisor;
    const fractionalPart = value % divisor;

    if (fractionalPart === 0n) {
      return integerPart.toString();
    }

    const fractionalStr = fractionalPart
      .toString()
      .padStart(decimals, '0');
    const trimmed = fractionalStr
      .slice(0, displayDecimals)
      .replace(/0+$/, '');

    if (trimmed === '' && integerPart === 0n) {
      // Dust: positive balance but below display precision
      const threshold = `0.${"0".repeat(displayDecimals - 1)}1`;
      return `< ${threshold}`;
    }

    if (trimmed === '') {
      return integerPart.toString();
    }

    return `${integerPart}.${trimmed}`;
  } catch {
    const num = parseFloat(balance);
    if (isNaN(num) || num < 0) return '0';
    if (num > 0 && num < Math.pow(10, -displayDecimals)) {
      return `< ${(0).toFixed(displayDecimals).slice(0, -1)}1`;
    }
    return num.toFixed(displayDecimals).replace(/\.?0+$/, '') || '0';
  }
}

/**
 * Well-known EVM chain_id → native token symbol map.
 * Used as fallback when token_symbol is not provided by the backend.
 */
export const EVM_NATIVE_SYMBOLS: Record<number, string> = {
  1: 'ETH', 5: 'ETH', 11155111: 'ETH',
  56: 'BNB', 97: 'tBNB',
  137: 'POL', 80001: 'POL',
  42161: 'ETH', 421614: 'ETH',
  8453: 'ETH', 84532: 'ETH',
  10: 'ETH', 11155420: 'ETH',
  43114: 'AVAX', 43113: 'AVAX',
  250: 'FTM', 4002: 'FTM',
  61: 'ETC',
};

export function getDisplaySymbol(
  tokenSymbol: string | null | undefined,
  chainType: string,
  evmChainId?: number | null,
): string {
  if (tokenSymbol) return tokenSymbol;
  switch (chainType) {
    case 'EVM':
      if (evmChainId != null && EVM_NATIVE_SYMBOLS[evmChainId]) {
        return EVM_NATIVE_SYMBOLS[evmChainId];
      }
      return 'ETH';
    case 'BTC':
      return 'BTC';
    default:
      return chainType;
  }
}

export function formatAddress(
  address: string,
  prefixLen = 6,
  suffixLen = 4
): string {
  if (!address) return '';
  if (address.length <= prefixLen + suffixLen + 3) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

/**
 * Sum an array of BigInt-compatible balance strings.
 * Falls back gracefully for non-integer strings.
 */
export function sumBigIntBalances(balances: string[]): string {
  return balances.reduce((acc, b) => {
    try {
      return (BigInt(acc) + BigInt(b || "0")).toString();
    } catch {
      return acc;
    }
  }, "0");
}
