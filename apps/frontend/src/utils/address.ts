export type AddressChainType = 'EVM' | 'BTC';

type BtcNetworkCategory = 'mainnet' | 'testnet' | 'any';

const normalizeBtcNetwork = (network?: string | null): BtcNetworkCategory => {
  if (!network) return 'any';
  return network.toLowerCase().includes('test') ? 'testnet' : 'mainnet';
};

export const isValidEvmAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
};

const isBtcPrefixValid = (address: string, category: BtcNetworkCategory): boolean => {
  const value = address.trim().toLowerCase();
  if (category === 'any') {
    return (
      value.startsWith('tb1') ||
      value.startsWith('m') ||
      value.startsWith('n') ||
      value.startsWith('2') ||
      value.startsWith('bcrt1') ||
      value.startsWith('bc1') ||
      value.startsWith('1') ||
      value.startsWith('3')
    );
  }
  if (category === 'testnet') {
    return (
      value.startsWith('tb1') ||
      value.startsWith('m') ||
      value.startsWith('n') ||
      value.startsWith('2') ||
      value.startsWith('bcrt1')
    );
  }
  return value.startsWith('bc1') || value.startsWith('1') || value.startsWith('3');
};

export const isValidBtcAddress = (address: string, network?: string | null): boolean => {
  if (!address.trim()) return false;
  const category = normalizeBtcNetwork(network);
  return isBtcPrefixValid(address, category);
};

export const validateAddress = (
  chainType: AddressChainType,
  address: string,
  btcNetwork?: string | null
): { valid: boolean; errorKey?: string } => {
  if (chainType === 'EVM') {
    const valid = isValidEvmAddress(address);
    return { valid, errorKey: valid ? undefined : 'address.invalidEvmAddress' };
  }
  const valid = isValidBtcAddress(address, btcNetwork);
  return { valid, errorKey: valid ? undefined : 'address.invalidBtcAddress' };
};

/** True if address is the EVM zero address (0x000...0). */
export function isZeroAddress(address: string): boolean {
  return address.trim().toLowerCase() === "0x0000000000000000000000000000000000000000";
}

/**
 * Truncate a blockchain address for display.
 */
export function truncateAddress(address: string, head = 8, tail = 6): string {
  if (!address) return "";
  if (address.length <= head + tail + 3) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}
