import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: './playground',
  server: {
    port: 4000,
    open: true,
  },
  resolve: {
    alias: {
      '@multivault/wallet-connector': path.resolve(__dirname, './src/index.ts'),
    },
  },
  define: {
    // Polyfill for Node.js globals
    global: 'globalThis',
  },
  optimizeDeps: {
    include: [
      'buffer',
      '@ledgerhq/hw-transport-webhid',
      '@ledgerhq/hw-app-eth',
      'ledger-bitcoin',
      '@walletconnect/ethereum-provider',
      'ethers',
    ],
    esbuildOptions: {
      // Node.js global to browser globalThis
      define: {
        global: 'globalThis',
      },
    },
  },
});
