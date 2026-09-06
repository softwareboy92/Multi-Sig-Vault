// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

import { vi } from 'vitest';

// Mock window.ethereum for MetaMask tests
Object.defineProperty(globalThis, 'window', {
  value: {
    ethereum: undefined,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  },
  writable: true,
});

// Mock navigator.hid for Ledger tests
Object.defineProperty(globalThis, 'navigator', {
  value: {
    hid: {
      requestDevice: vi.fn(),
      getDevices: vi.fn(),
    },
  },
  writable: true,
});
