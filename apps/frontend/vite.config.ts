import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(process.env.ANALYZE
      ? [visualizer({ open: true, filename: 'dist/stats.html' })]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: 'buffer',
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      external: [/@ledgerhq\/cryptoassets\/data\/.*/],
    },
  },
  define: {
    'import.meta.env.VITE_WC_PROJECT_ID': JSON.stringify(
      '96962ee2d7c33bc614e95d1b46d4558e'
    ),
    global: 'globalThis',
    // buffer / @ngraveio/bc-ur etc. may reference process; use actual build mode
    'process.env.NODE_ENV': JSON.stringify(mode),
    'process.env': '{}',
    process: '{}',
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime', 'buffer'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
}));
