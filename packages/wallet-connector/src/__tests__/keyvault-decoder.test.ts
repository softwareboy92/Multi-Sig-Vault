import { describe, it, expect } from 'vitest';
import { decodeNxvResponse, extractSignatures, extractSignerAccount } from '../providers/keyvault/decoder.js';

describe('decoder', () => {
  it('decodes sign_result with signResult array', () => {
    const json = JSON.stringify({
      nxv_action: 'sign_result',
      b_data: {
        chainType: 'ETH',
        signature: 'top-level-sig',
        signResult: [
          { transfer_id: 'tx1', signature: '0xabc' },
          { transfer_id: 'tx2', signature: '0xdef' },
        ],
      },
    });
    const result = decodeNxvResponse(json);
    expect(result.nxv_action).toBe('sign_result');

    const sigs = extractSignatures(result as any);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toEqual({ transferId: 'tx1', signature: '0xabc' });
  });

  it('decodes sign_result with top-level signature only', () => {
    const json = JSON.stringify({
      nxv_action: 'sign_result',
      b_data: { chainType: 'ETH', signature: '0xonly' },
    });
    const result = decodeNxvResponse(json);
    const sigs = extractSignatures(result as any);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].signature).toBe('0xonly');
  });

  it('decodes import_signer_result', () => {
    const json = JSON.stringify({
      nxv_action: 'import_signer_result',
      b_data: {
        chainType: 'ETH',
        signature: 'challenge-sig',
        account: {
          path: "m/44'/60'/0'/0/0",
          address: '0x1234',
          name: 'KeyVault-1',
          publicKey: '0xpub',
          fpr: 'AABBCCDD',
          xpub: 'xpub...',
        },
      },
    });
    const result = decodeNxvResponse(json);
    const account = extractSignerAccount(result as any);
    expect(account.address).toBe('0x1234');
    expect(account.publicKey).toBe('0xpub');
    expect(account.masterFingerprint).toBe('AABBCCDD');
    expect(account.derivationPath).toBe("m/44'/60'/0'/0/0");
  });

  it('throws on invalid JSON', () => {
    expect(() => decodeNxvResponse('not-json')).toThrow();
  });

  it('throws on wrong nxv_action', () => {
    const json = JSON.stringify({ nxv_action: 'unknown_action', b_data: {} });
    expect(() => decodeNxvResponse(json)).toThrow();
  });

  it('uses ?? not || for signature extraction (empty string edge case)', () => {
    const json = JSON.stringify({
      nxv_action: 'sign_result',
      b_data: { chainType: 'ETH', signature: '' },
    });
    const result = decodeNxvResponse(json);
    const sigs = extractSignatures(result as any);
    // Empty string IS a value (not missing), should not fall through
    expect(sigs[0].signature).toBe('');
  });
});
