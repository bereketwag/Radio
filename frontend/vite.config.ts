import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.VITE_BACKEND_ORIGIN || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/media': { target: backend, changeOrigin: true },
      // Mirror the nginx rule: strip the /live prefix so /live/radio
      // reaches Icecast as /radio (its actual mount). Icecast runs on 8001
      // locally because 8000 is the Django dev server.
      '/live': {
        target: process.env.VITE_ICECAST_ORIGIN || 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/live/, ''),
      },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
})
