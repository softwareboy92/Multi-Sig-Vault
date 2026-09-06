// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - XPub Utilities
// ═══════════════════════════════════════════════════════════════════════════

// Base58 alphabet
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) {
  ALPHABET_MAP[ALPHABET[i]] = i;
}

// XPub version bytes
const XPUB_VERSION = {
  mainnet: {
    public: 0x0488b21e, // xpub
    private: 0x0488ade4, // xprv
  },
  testnet: {
    public: 0x043587cf, // tpub
    private: 0x04358394, // tprv
  },
};

/**
 * SHA256 hash using Web Crypto API
 */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
  return new Uint8Array(hash);
}

/**
 * Double SHA256 hash
 */
async function hash256(data: Uint8Array): Promise<Uint8Array> {
  return sha256(await sha256(data));
}

/**
 * Base58 encode
 */
function base58Encode(buffer: Uint8Array): string {
  const digits = [0];

  for (let i = 0; i < buffer.length; i++) {
    let carry = buffer[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let result = '';
  // Leading zeros
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    result += ALPHABET[0];
  }
  // Digits in reverse order
  for (let i = digits.length - 1; i >= 0; i--) {
    result += ALPHABET[digits[i]];
  }

  return result;
}

/**
 * Base58 decode
 */
function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [];

  for (let i = 0; i < str.length; i++) {
    const value = ALPHABET_MAP[str[i]];
    if (value === undefined) {
      throw new Error(`Invalid base58 character: ${str[i]}`);
    }

    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Leading zeros
  for (let i = 0; i < str.length && str[i] === ALPHABET[0]; i++) {
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

/**
 * Base58Check encode
 */
export async function base58CheckEncode(payload: Uint8Array): Promise<string> {
  const checksum = await hash256(payload);
  const buffer = new Uint8Array(payload.length + 4);
  buffer.set(payload);
  buffer.set(checksum.slice(0, 4), payload.length);
  return base58Encode(buffer);
}

/**
 * Base58Check decode
 */
export async function base58CheckDecode(str: string): Promise<Uint8Array> {
  const buffer = base58Decode(str);
  if (buffer.length < 4) {
    throw new Error('Invalid base58check string');
  }

  const payload = buffer.slice(0, -4);
  const checksum = buffer.slice(-4);
  const expectedChecksum = (await hash256(payload)).slice(0, 4);

  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expectedChecksum[i]) {
      throw new Error('Invalid checksum');
    }
  }

  return payload;
}

/**
 * XPub data structure
 */
export interface XPubData {
  version: number;
  depth: number;
  fingerprint: Uint8Array; // 4 bytes
  childNumber: number;
  chainCode: Uint8Array; // 32 bytes
  publicKey: Uint8Array; // 33 bytes (compressed)
}

/**
 * Parse xpub string into components
 */
export async function parseXpub(xpub: string): Promise<XPubData> {
  const data = await base58CheckDecode(xpub);

  if (data.length !== 78) {
    throw new Error(`Invalid xpub length: ${data.length}, expected 78`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  return {
    version: view.getUint32(0),
    depth: data[4],
    fingerprint: data.slice(5, 9),
    childNumber: view.getUint32(9),
    chainCode: data.slice(13, 45),
    publicKey: data.slice(45, 78),
  };
}

/**
 * Build xpub string from components
 */
export async function buildXpub(data: XPubData): Promise<string> {
  const buffer = new Uint8Array(78);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, data.version);
  buffer[4] = data.depth;
  buffer.set(data.fingerprint, 5);
  view.setUint32(9, data.childNumber);
  buffer.set(data.chainCode, 13);
  buffer.set(data.publicKey, 45);

  return base58CheckEncode(buffer);
}

/**
 * Extract compressed public key from xpub
 */
export async function extractPublicKeyFromXpub(xpub: string): Promise<string> {
  const data = await parseXpub(xpub);
  return bufferToHex(data.publicKey);
}

/**
 * Build xpub from public key and chain code
 *
 * @param publicKey - 33-byte compressed public key (hex)
 * @param chainCode - 32-byte chain code (hex)
 * @param fingerprint - 4-byte parent fingerprint (hex)
 * @param depth - Derivation depth
 * @param childNumber - Child number
 * @param testnet - Whether to use testnet version
 */
export async function buildXpubFromComponents(
  publicKey: string,
  chainCode: string,
  fingerprint: string,
  depth: number,
  childNumber: number,
  testnet: boolean = false
): Promise<string> {
  const pubKeyBytes = hexToBuffer(publicKey);
  const chainCodeBytes = hexToBuffer(chainCode);
  const fingerprintBytes = hexToBuffer(fingerprint);

  if (pubKeyBytes.length !== 33) {
    throw new Error(`Invalid public key length: ${pubKeyBytes.length}, expected 33`);
  }
  if (chainCodeBytes.length !== 32) {
    throw new Error(`Invalid chain code length: ${chainCodeBytes.length}, expected 32`);
  }
  if (fingerprintBytes.length !== 4) {
    throw new Error(`Invalid fingerprint length: ${fingerprintBytes.length}, expected 4`);
  }

  return buildXpub({
    version: testnet ? XPUB_VERSION.testnet.public : XPUB_VERSION.mainnet.public,
    depth,
    fingerprint: fingerprintBytes,
    childNumber,
    chainCode: chainCodeBytes,
    publicKey: pubKeyBytes,
  });
}

/**
 * Compress uncompressed public key (65 bytes -> 33 bytes)
 *
 * @param uncompressedHex - 65-byte or 64-byte (without 04 prefix) uncompressed public key hex
 * @returns 33-byte compressed public key hex
 */
export function compressPublicKey(uncompressedHex: string): string {
  let hex = uncompressedHex.startsWith('0x')
    ? uncompressedHex.slice(2)
    : uncompressedHex;

  // Add 04 prefix if missing
  if (hex.length === 128) {
    hex = '04' + hex;
  }

  if (hex.length !== 130) {
    throw new Error(`Invalid uncompressed public key length: ${hex.length}, expected 130`);
  }

  // Check prefix
  if (!hex.startsWith('04')) {
    throw new Error('Invalid uncompressed public key prefix');
  }

  const x = hex.slice(2, 66);
  const y = hex.slice(66, 130);

  // Determine prefix based on y parity
  const yLastByte = parseInt(y.slice(-2), 16);
  const prefix = yLastByte % 2 === 0 ? '02' : '03';

  return prefix + x;
}

/**
 * Parse derivation path into components
 * e.g., "m/44'/60'/0'/0" -> { purpose: 44, coinType: 60, account: 0, change: 0 }
 */
export function parseDerivationPath(path: string): {
  purpose: number;
  coinType: number;
  account: number;
  change?: number;
  index?: number;
} {
  const parts = path.replace(/^m\//, '').split('/');
  const parseComponent = (s: string): number => parseInt(s.replace("'", ''), 10);

  const result: ReturnType<typeof parseDerivationPath> = {
    purpose: parseComponent(parts[0] || '44'),
    coinType: parseComponent(parts[1] || '0'),
    account: parseComponent(parts[2] || '0'),
  };

  if (parts.length > 3) {
    result.change = parseComponent(parts[3]);
  }
  if (parts.length > 4) {
    result.index = parseComponent(parts[4]);
  }

  return result;
}

/**
 * Build full derivation path with address index
 *
 * @param basePath - Base path like "m/84'/0'/0'" or "m/44'/60'/0'/0"
 * @param change - Change value (0 or 1), only for BTC
 * @param index - Address index
 * @returns Full derivation path
 */
export function buildFullDerivationPath(
  basePath: string,
  change: number,
  index: number
): string {
  // Normalize path
  const normalized = basePath.startsWith('m/') ? basePath : `m/${basePath}`;

  // Count existing components
  const parts = normalized.split('/');

  // For BTC paths like m/84'/0'/0', add /change/index
  // For ETH paths like m/44'/60'/0'/0, add /index
  // For BIP 48 paths like m/48'/0'/0'/2', add /change/index
  if (parts.length === 4) {
    // BTC BIP 84 style: m/purpose'/coin'/account'
    return `${normalized}/${change}/${index}`;
  } else if (parts.length === 5) {
    // Check if all non-root parts are hardened (BIP 48: m/48'/coin'/account'/script')
    const allHardened = parts.slice(1).every(p => p.endsWith("'"));
    if (allHardened) {
      // BIP 48 style: m/48'/coin'/account'/script' → append /change/index
      return `${normalized}/${change}/${index}`;
    }
    // ETH style: m/purpose'/coin'/account'/change → append /index only
    return `${normalized}/${index}`;
  } else if (parts.length === 6) {
    // Already full path
    return normalized;
  }

  throw new Error(`Unexpected path format: ${basePath}`);
}

// ─── Helper Functions ─────────────────────────────────────────────────────

function hexToBuffer(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const buffer = new Uint8Array(h.length / 2);
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return buffer;
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
