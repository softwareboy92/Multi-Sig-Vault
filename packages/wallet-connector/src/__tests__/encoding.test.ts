// ═══════════════════════════════════════════════════════════════════════════
// Encoding Utilities Tests
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  toHex,
  hexToUtf8,
  toChecksumAddress,
  isHex,
  padHex,
  concatHex,
  bufferToHex,
  hexToBuffer,
} from '../utils/encoding.js';

describe('toHex', () => {
  it('should convert string to hex', () => {
    expect(toHex('hello')).toBe('0x68656c6c6f');
  });

  it('should convert number to hex', () => {
    expect(toHex(255)).toBe('0xff');
    expect(toHex(16)).toBe('0x10');
    expect(toHex(0)).toBe('0x0');
  });

  it('should handle bigint', () => {
    expect(toHex(BigInt(1000))).toBe('0x3e8');
  });

  it('should pass through hex strings unchanged', () => {
    expect(toHex('0x1234')).toBe('0x1234');
  });

  it('should handle empty string', () => {
    expect(toHex('')).toBe('0x');
  });
});

describe('hexToUtf8', () => {
  it('should convert hex to string', () => {
    expect(hexToUtf8('0x68656c6c6f')).toBe('hello');
  });

  it('should handle hex without prefix', () => {
    expect(hexToUtf8('68656c6c6f')).toBe('hello');
  });

  it('should handle empty hex', () => {
    expect(hexToUtf8('0x')).toBe('');
  });
});

describe('toChecksumAddress', () => {
  it('should pass through valid address', () => {
    // Note: This is a simplified implementation
    // Real EIP-55 checksumming should use keccak256
    const address = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
    expect(toChecksumAddress(address)).toBe(address);
  });

  it('should pass through uppercase address', () => {
    const address = '0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED';
    expect(toChecksumAddress(address)).toBe(address);
  });

  it('should handle already checksummed address', () => {
    const address = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
    expect(toChecksumAddress(address)).toBe(address);
  });

  it('should throw for address without 0x prefix', () => {
    const address = '5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
    expect(() => toChecksumAddress(address)).toThrow('Invalid Ethereum address');
  });
});

describe('isHex', () => {
  it('should return true for valid hex with prefix', () => {
    expect(isHex('0x1234abcd')).toBe(true);
    expect(isHex('0xABCDEF')).toBe(true);
  });

  it('should return true for hex with only prefix', () => {
    expect(isHex('0x')).toBe(true);
  });

  it('should return false for invalid hex', () => {
    expect(isHex('0xGHIJ')).toBe(false);
    expect(isHex('hello')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isHex('')).toBe(false);
  });
});

describe('padHex', () => {
  it('should pad hex to specified byte length', () => {
    expect(padHex('0x1', 4)).toBe('0x00000001');
    expect(padHex('0xff', 4)).toBe('0x000000ff');
  });

  it('should not truncate if already at byte length', () => {
    expect(padHex('0x1234', 4)).toBe('0x00001234');
  });

  it('should not truncate if longer than byte length', () => {
    expect(padHex('0x123456', 4)).toBe('0x00123456');
  });

  it('should handle hex without prefix', () => {
    expect(padHex('1', 4)).toBe('0x00000001');
  });
});

describe('concatHex', () => {
  it('should concatenate hex strings', () => {
    expect(concatHex(['0x12', '0x34', '0x56'])).toBe('0x123456');
  });

  it('should handle single hex', () => {
    expect(concatHex(['0x1234'])).toBe('0x1234');
  });

  it('should handle empty array', () => {
    expect(concatHex([])).toBe('0x');
  });

  it('should handle hex without prefix', () => {
    expect(concatHex(['12', '34'])).toBe('0x1234');
  });
});

describe('bufferToHex', () => {
  it('should convert buffer to hex', () => {
    const buffer = new Uint8Array([0x12, 0x34, 0xab, 0xcd]);
    expect(bufferToHex(buffer)).toBe('0x1234abcd');
  });

  it('should handle empty buffer', () => {
    const buffer = new Uint8Array([]);
    expect(bufferToHex(buffer)).toBe('0x');
  });

  it('should handle single byte', () => {
    const buffer = new Uint8Array([0xff]);
    expect(bufferToHex(buffer)).toBe('0xff');
  });

  it('should pad single digit bytes', () => {
    const buffer = new Uint8Array([0x01, 0x02, 0x0a]);
    expect(bufferToHex(buffer)).toBe('0x01020a');
  });
});

describe('hexToBuffer', () => {
  it('should convert hex to buffer', () => {
    const buffer = hexToBuffer('0x1234abcd');
    expect(buffer).toEqual(new Uint8Array([0x12, 0x34, 0xab, 0xcd]));
  });

  it('should handle hex without prefix', () => {
    const buffer = hexToBuffer('1234');
    expect(buffer).toEqual(new Uint8Array([0x12, 0x34]));
  });

  it('should handle empty hex', () => {
    const buffer = hexToBuffer('0x');
    expect(buffer).toEqual(new Uint8Array([]));
  });

  it('should handle odd length hex by splitting pairs', () => {
    // 0x123 splits as '12' '3' -> [0x12, 0x03]
    const buffer = hexToBuffer('0x123');
    expect(buffer).toEqual(new Uint8Array([0x12, 0x03]));
  });
});

describe('roundtrip conversion', () => {
  it('should roundtrip buffer -> hex -> buffer', () => {
    const original = new Uint8Array([0x12, 0x34, 0xab, 0xcd, 0xef]);
    const hex = bufferToHex(original);
    const result = hexToBuffer(hex);
    expect(result).toEqual(original);
  });

  it('should roundtrip string -> hex -> string', () => {
    const original = 'Hello, World!';
    const hex = toHex(original);
    const result = hexToUtf8(hex);
    expect(result).toBe(original);
  });
});
