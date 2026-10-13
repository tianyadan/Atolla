import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Dev server proxies API to relay on 3080 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3080',
        changeOrigin: true,
      },
    },
  },
})
