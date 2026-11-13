import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@nuvo/design': path.resolve(__dirname, '../packages/design'),
      // The mark is drawn once, in the app (D-191). The site renders that same
      // component rather than a copy — never draw it by hand.
      '@nuvo/mark': path.resolve(__dirname, '../src/components/kit/Mark.tsx'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5175,
    strictPort: true,
    fs: { allow: [path.resolve(__dirname), path.resolve(__dirname, '../src/components/kit')] },
  },
})
