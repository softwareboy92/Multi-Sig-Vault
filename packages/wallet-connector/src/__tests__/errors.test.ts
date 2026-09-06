// ═══════════════════════════════════════════════════════════════════════════
// Error Tests
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { WalletError, WalletErrorCode } from '../core/errors.js';

describe('WalletError', () => {
  describe('constructor', () => {
    it('should create error with code and message', () => {
      const error = new WalletError(
        WalletErrorCode.USER_REJECTED,
        'User rejected the request'
      );

      expect(error.code).toBe(WalletErrorCode.USER_REJECTED);
      expect(error.message).toBe('User rejected the request');
      expect(error.name).toBe('WalletError');
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should create error with details', () => {
      const details = { txHash: '0x123', chain: 'ethereum' };
      const error = new WalletError(
        WalletErrorCode.SIGNING_FAILED,
        'Signing failed',
        details
      );

      expect(error.details).toEqual(details);
    });

    it('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new WalletError(
        WalletErrorCode.INTERNAL_ERROR,
        'Internal error occurred',
        undefined,
        cause
      );

      expect(error.cause).toBe(cause);
    });
  });

  describe('isRetryable', () => {
    it('should return true for timeout errors', () => {
      const error = new WalletError(
        WalletErrorCode.CONNECTION_TIMEOUT,
        'Connection timed out'
      );
      expect(error.isRetryable).toBe(true);
    });

    it('should return true for device busy errors', () => {
      const error = new WalletError(
        WalletErrorCode.DEVICE_BUSY,
        'Device is busy'
      );
      expect(error.isRetryable).toBe(true);
    });

    it('should return true for network errors', () => {
      const error = new WalletError(
        WalletErrorCode.NETWORK_ERROR,
        'Network error'
      );
      expect(error.isRetryable).toBe(true);
    });

    it('should return false for user rejection', () => {
      const error = new WalletError(
        WalletErrorCode.USER_REJECTED,
        'User rejected'
      );
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('requiresUserAction', () => {
    it('should return true for wallet not found', () => {
      const error = new WalletError(
        WalletErrorCode.WALLET_NOT_FOUND,
        'Wallet not found'
      );
      expect(error.requiresUserAction).toBe(true);
    });

    it('should return true for wrong app', () => {
      const error = new WalletError(
        WalletErrorCode.WRONG_APP,
        'Wrong app open'
      );
      expect(error.requiresUserAction).toBe(true);
    });

    it('should return true for device locked', () => {
      const error = new WalletError(
        WalletErrorCode.DEVICE_LOCKED,
        'Device is locked'
      );
      expect(error.requiresUserAction).toBe(true);
    });

    it('should return false for internal errors', () => {
      const error = new WalletError(
        WalletErrorCode.INTERNAL_ERROR,
        'Internal error'
      );
      expect(error.requiresUserAction).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize error to JSON', () => {
      const error = new WalletError(
        WalletErrorCode.SIGNING_FAILED,
        'Signing failed',
        { reason: 'timeout' }
      );

      const json = error.toJSON();

      expect(json.code).toBe(WalletErrorCode.SIGNING_FAILED);
      expect(json.message).toBe('Signing failed');
      expect(json.details).toEqual({ reason: 'timeout' });
      expect(json.timestamp).toBeDefined();
    });
  });
});

describe('WalletErrorCode', () => {
  it('should have connection errors in 1000 range', () => {
    expect(WalletErrorCode.WALLET_NOT_FOUND).toBeGreaterThanOrEqual(1000);
    expect(WalletErrorCode.WALLET_NOT_FOUND).toBeLessThan(2000);
  });

  it('should have signing errors in 2000 range', () => {
    expect(WalletErrorCode.USER_REJECTED).toBeGreaterThanOrEqual(2000);
    expect(WalletErrorCode.USER_REJECTED).toBeLessThan(3000);
  });

  it('should have chain errors in 3000 range', () => {
    expect(WalletErrorCode.CHAIN_NOT_SUPPORTED).toBeGreaterThanOrEqual(3000);
    expect(WalletErrorCode.CHAIN_NOT_SUPPORTED).toBeLessThan(4000);
  });

  it('should have state errors in 4000 range', () => {
    expect(WalletErrorCode.NOT_INITIALIZED).toBeGreaterThanOrEqual(4000);
    expect(WalletErrorCode.NOT_INITIALIZED).toBeLessThan(5000);
  });

  it('should have internal errors in 5000 range', () => {
    expect(WalletErrorCode.INTERNAL_ERROR).toBeGreaterThanOrEqual(5000);
    expect(WalletErrorCode.INTERNAL_ERROR).toBeLessThan(6000);
  });
});
