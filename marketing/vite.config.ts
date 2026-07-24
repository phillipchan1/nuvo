import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@nuvo/design': path.resolve(__dirname, '../packages/design'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
})
