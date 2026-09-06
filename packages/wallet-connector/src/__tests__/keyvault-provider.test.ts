import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyVaultProvider } from '../providers/keyvault/index.js';

// Mock the modal module so the top-level side-effect import is a no-op in tests
vi.mock('../providers/keyvault/modal/modal.js', () => ({}));

// Register a minimal mock custom element for <keyvault-modal>
class MockModal extends HTMLElement {
  onResult: ((json: string) => void) | null = null;
  onCancel: (() => void) | null = null;
  open(_params: unknown): void { /* no-op in tests */ }
  close(): void { /* no-op in tests */ }
}
if (!customElements.get('keyvault-modal')) {
  customElements.define('keyvault-modal', MockModal);
}

describe('KeyVaultProvider', () => {
  let provider: KeyVaultProvider;

  beforeEach(() => {
    provider = new KeyVaultProvider();
  });

  it('has walletType KEYVAULT', () => {
    expect(provider.walletType).toBe('KEYVAULT');
  });

  it('supports ETHEREUM and BITCOIN chains', () => {
    expect(provider.supportedChains).toContain('ETHEREUM');
    expect(provider.supportedChains).toContain('BITCOIN');
  });

  it('init() transitions state to IDLE', async () => {
    await provider.init();
    expect(provider.state).toBe('IDLE');
  });

  it('connect() with address sets account', async () => {
    await provider.init();
    const account = await provider.connect({
      chain: 'ETHEREUM',
      address: '0x1234',
    } as any);
    expect(account.address).toBe('0x1234');
    expect(account.walletType).toBe('KEYVAULT');
  });

  it('disconnect() resets state', async () => {
    await provider.init();
    await provider.connect({ chain: 'ETHEREUM', address: '0x1234' } as any);
    await provider.disconnect();
    expect(provider.state).toBe('IDLE');
    expect(provider.account).toBeNull();
  });

  it('signTransaction rejects with timeout when no modal interaction', async () => {
    const shortTimeout = new KeyVaultProvider({ qrTimeoutMs: 100 });
    await shortTimeout.init();
    await shortTimeout.connect({ chain: 'ETHEREUM', address: '0x1234' } as any);

    await expect(
      shortTimeout.signTransaction(
        { type: 'keyvault', payloadJson: '{}', signerId: 's1' },
        { address: '0x1234', chain: 'ETHEREUM', walletType: 'KEYVAULT' }
      )
    ).rejects.toThrow(/timed out/i);
  });
});
