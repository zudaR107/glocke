import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5177,
    proxy: {
      '/backend': {
        target: 'http://localhost:3004',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/backend/, ''),
      },
      '^/auth/(?!callback(?:/|$))': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})
