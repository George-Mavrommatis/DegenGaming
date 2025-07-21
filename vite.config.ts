// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // This plugin will automatically polyfill Node.js globals like 'Buffer' and 'global'.
    // It's the modern and correct way to handle this in Vite.
    nodePolyfills({
      // To exclude specific polyfills, add them to this list.
      // For example, if you don't want to polyfill 'fs', you can add 'fs' to this list.
      // For now, an empty 'exclude' is fine.
      exclude: [],
      // Whether to polyfill `global`.
      globals: {
        Buffer: true, // can also be 'build', 'dev', or false
        global: true,
        process: true,
      },
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
    }),
  ],

  exclude: ['socket.io-client'],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    proxy: {
      '/verify-wallet': 'http://localhost:4000',
      '/api': 'http://localhost:4000',
    },
  },
})