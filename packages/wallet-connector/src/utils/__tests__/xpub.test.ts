// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - XPub Utilities Tests
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  parseXpub,
  buildXpub,
  extractPublicKeyFromXpub,
  buildXpubFromComponents,
  compressPublicKey,
  parseDerivationPath,
  buildFullDerivationPath,
  base58CheckEncode,
  base58CheckDecode,
} from '../xpub.js';

// Known test vectors from BIP32
// This is a real xpub from BIP32 test vector 1
const TEST_XPUB =
  'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';

// Test vector for compressed public key
// Uncompressed: 04 + x(32) + y(32) = 65 bytes
const UNCOMPRESSED_PUBKEY =
  '0479BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8';
const COMPRESSED_PUBKEY =
  '0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798';

describe('xpub utilities', () => {
  describe('base58Check', () => {
    it('should encode and decode correctly', async () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const encoded = await base58CheckEncode(original);
      const decoded = await base58CheckDecode(encoded);

      expect(decoded).toEqual(original);
    });

    it('should throw on invalid checksum', async () => {
      const encoded = await base58CheckEncode(new Uint8Array([1, 2, 3]));
      // Corrupt the last character
      const corrupted = encoded.slice(0, -1) + '1';

      await expect(base58CheckDecode(corrupted)).rejects.toThrow('Invalid checksum');
    });
  });

  describe('parseXpub', () => {
    it('should parse a valid xpub', async () => {
      const parsed = await parseXpub(TEST_XPUB);

      // Check structure
      expect(parsed.version).toBe(0x0488b21e); // mainnet xpub
      expect(parsed.depth).toBe(0);
      expect(parsed.fingerprint.length).toBe(4);
      expect(parsed.childNumber).toBe(0);
      expect(parsed.chainCode.length).toBe(32);
      expect(parsed.publicKey.length).toBe(33);
    });

    it('should throw on invalid xpub length', async () => {
      await expect(parseXpub('xpub123')).rejects.toThrow();
    });
  });

  describe('buildXpub', () => {
    it('should rebuild the same xpub from parsed components', async () => {
      const parsed = await parseXpub(TEST_XPUB);
      const rebuilt = await buildXpub(parsed);

      expect(rebuilt).toBe(TEST_XPUB);
    });
  });

  describe('extractPublicKeyFromXpub', () => {
    it('should extract 33-byte compressed public key', async () => {
      const pubkey = await extractPublicKeyFromXpub(TEST_XPUB);

      // Should be 33 bytes hex = 66 characters
      expect(pubkey.length).toBe(66);
      // Should start with 02 or 03 (compressed prefix)
      expect(['02', '03']).toContain(pubkey.slice(0, 2));
    });
  });

  describe('buildXpubFromComponents', () => {
    it('should build a valid xpub from components', async () => {
      const parsed = await parseXpub(TEST_XPUB);

      // Convert to hex
      const pubkeyHex = Array.from(parsed.publicKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const chainCodeHex = Array.from(parsed.chainCode)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const fingerprintHex = Array.from(parsed.fingerprint)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const xpub = await buildXpubFromComponents(
        pubkeyHex,
        chainCodeHex,
        fingerprintHex,
        parsed.depth,
        parsed.childNumber,
        false // mainnet
      );

      expect(xpub).toBe(TEST_XPUB);
    });

    it('should validate public key length', async () => {
      await expect(
        buildXpubFromComponents('0279BE', '00'.repeat(32), '00000000', 0, 0)
      ).rejects.toThrow('Invalid public key length');
    });

    it('should validate chain code length', async () => {
      await expect(
        buildXpubFromComponents('02' + '79BE667E'.repeat(8), '00'.repeat(16), '00000000', 0, 0)
      ).rejects.toThrow('Invalid chain code length');
    });
  });

  describe('compressPublicKey', () => {
    it('should compress a 65-byte uncompressed public key', () => {
      const compressed = compressPublicKey(UNCOMPRESSED_PUBKEY);

      expect(compressed.length).toBe(66); // 33 bytes = 66 hex chars
      expect(compressed.toLowerCase()).toBe(COMPRESSED_PUBKEY.toLowerCase());
    });

    it('should handle 64-byte key without 04 prefix', () => {
      // Remove 04 prefix
      const without04 = UNCOMPRESSED_PUBKEY.slice(2);
      const compressed = compressPublicKey(without04);

      expect(compressed.length).toBe(66);
      expect(compressed.toLowerCase()).toBe(COMPRESSED_PUBKEY.toLowerCase());
    });

    it('should handle 0x prefix', () => {
      const compressed = compressPublicKey('0x' + UNCOMPRESSED_PUBKEY);

      expect(compressed.length).toBe(66);
    });

    it('should throw on invalid length', () => {
      expect(() => compressPublicKey('0279BE')).toThrow('Invalid uncompressed public key length');
    });

    it('should throw on invalid prefix', () => {
      // Replace 04 with 05
      const invalid = '05' + UNCOMPRESSED_PUBKEY.slice(2);
      expect(() => compressPublicKey(invalid)).toThrow('Invalid uncompressed public key prefix');
    });

    it('should determine prefix based on y parity', () => {
      // Even y -> 02 prefix
      const evenY =
        '04' +
        '79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798' +
        '483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8'; // ends in B8 (even)

      const compressedEven = compressPublicKey(evenY);
      expect(compressedEven.startsWith('02')).toBe(true);

      // Odd y
      const oddY =
        '04' +
        '79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798' +
        '483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B9'; // ends in B9 (odd)

      const compressedOdd = compressPublicKey(oddY);
      expect(compressedOdd.startsWith('03')).toBe(true);
    });
  });

  describe('parseDerivationPath', () => {
    it('should parse a full BTC path', () => {
      const parsed = parseDerivationPath("m/84'/0'/0'/0/5");

      expect(parsed.purpose).toBe(84);
      expect(parsed.coinType).toBe(0);
      expect(parsed.account).toBe(0);
      expect(parsed.change).toBe(0);
      expect(parsed.index).toBe(5);
    });

    it('should parse an ETH path', () => {
      const parsed = parseDerivationPath("m/44'/60'/0'/0/0");

      expect(parsed.purpose).toBe(44);
      expect(parsed.coinType).toBe(60);
      expect(parsed.account).toBe(0);
      expect(parsed.change).toBe(0);
      expect(parsed.index).toBe(0);
    });

    it('should parse path without m/ prefix', () => {
      const parsed = parseDerivationPath("44'/60'/0'/0");

      expect(parsed.purpose).toBe(44);
      expect(parsed.coinType).toBe(60);
      expect(parsed.account).toBe(0);
      expect(parsed.change).toBe(0);
    });

    it('should parse account-level path', () => {
      const parsed = parseDerivationPath("m/84'/0'/0'");

      expect(parsed.purpose).toBe(84);
      expect(parsed.coinType).toBe(0);
      expect(parsed.account).toBe(0);
      expect(parsed.change).toBeUndefined();
      expect(parsed.index).toBeUndefined();
    });
  });

  describe('buildFullDerivationPath', () => {
    it('should build full path from BTC account path', () => {
      const full = buildFullDerivationPath("m/84'/0'/0'", 0, 5);
      expect(full).toBe("m/84'/0'/0'/0/5");
    });

    it('should build full path with change = 1', () => {
      const full = buildFullDerivationPath("m/84'/0'/0'", 1, 3);
      expect(full).toBe("m/84'/0'/0'/1/3");
    });

    it('should build full path from ETH base path', () => {
      const full = buildFullDerivationPath("m/44'/60'/0'/0", 0, 10);
      expect(full).toBe("m/44'/60'/0'/0/10");
    });

    it('should build full path from BIP 48 account path', () => {
      const full = buildFullDerivationPath("m/48'/1'/0'/2'", 0, 0);
      expect(full).toBe("m/48'/1'/0'/2'/0/0");
    });

    it('should build BIP 48 path with change = 1', () => {
      const full = buildFullDerivationPath("m/48'/0'/0'/2'", 1, 3);
      expect(full).toBe("m/48'/0'/0'/2'/1/3");
    });

    it('should handle path without m/ prefix', () => {
      const full = buildFullDerivationPath("84'/0'/0'", 0, 0);
      expect(full).toBe("m/84'/0'/0'/0/0");
    });

    it('should throw on unexpected path format', () => {
      expect(() => buildFullDerivationPath("m/84'", 0, 0)).toThrow('Unexpected path format');
    });
  });
});
