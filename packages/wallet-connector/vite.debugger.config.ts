import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: './debugger',
  server: {
    port: 5000,
    open: true,
    // Proxy API requests to backend during development
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@multivault/wallet-connector': path.resolve(__dirname, './src/index.ts'),
    },
  },
  define: {
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
      define: {
        global: 'globalThis',
      },
    },
  },
});
