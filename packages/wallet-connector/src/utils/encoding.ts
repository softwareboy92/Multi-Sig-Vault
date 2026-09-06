// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Encoding Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a number, bigint, or string to hex string with 0x prefix
 */
export function toHex(value: number | bigint | string): string {
  if (typeof value === 'string') {
    // If already hex, return as-is
    if (value.startsWith('0x')) {
      return value;
    }
    // Convert string to hex
    return (
      '0x' +
      Array.from(new TextEncoder().encode(value))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );
  }
  return `0x${value.toString(16)}`;
}

/**
 * Convert hex string to UTF-8 string
 */
export function hexToUtf8(hex: string): string {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(
    cleanHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? []
  );
  return new TextDecoder().decode(bytes);
}

/**
 * Convert address to checksum format (EIP-55)
 * Simplified implementation - in production use ethers.js
 */
export function toChecksumAddress(address: string): string {
  // For now, just lowercase then capitalize
  // In production, use proper keccak256 based checksumming
  const lower = address.toLowerCase();
  if (!lower.startsWith('0x') || lower.length !== 42) {
    throw new Error('Invalid Ethereum address');
  }
  // Simple checksum (should use keccak256 in production)
  return address;
}

/**
 * Check if value is hex string
 */
export function isHex(value: string): boolean {
  return /^0x[0-9a-fA-F]*$/.test(value);
}

/**
 * Pad hex string to specified byte length
 */
export function padHex(hex: string, byteLength: number): string {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  return '0x' + cleanHex.padStart(byteLength * 2, '0');
}

/**
 * Concatenate hex strings
 */
export function concatHex(hexStrings: string[]): string {
  return (
    '0x' +
    hexStrings.map((h) => (h.startsWith('0x') ? h.slice(2) : h)).join('')
  );
}

/**
 * Convert Buffer/Uint8Array to hex string
 */
export function bufferToHex(buffer: Uint8Array): string {
  return (
    '0x' +
    Array.from(buffer)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBuffer(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = cleanHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [];
  return new Uint8Array(bytes);
}
