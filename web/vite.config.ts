import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  // Explicitly set app type to SPA
  appType: 'spa',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split heavy, rarely-used libraries into their own chunks so the
    // first paint on a phone (slow LTE) only pays for what it needs.
    rollupOptions: {
      output: {
        manualChunks: {
          // Excel export is only used on the Donations page
          xlsx: ['xlsx'],
          // MUI core ships a lot of code; isolating it lets it cache
          // across deploys when only app code changes.
          'mui-core': ['@mui/material', '@mui/system'],
          'mui-icons': ['@mui/icons-material'],
          clerk: ['@clerk/react'],
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
})
