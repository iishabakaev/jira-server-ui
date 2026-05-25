import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import path from 'node:path'

// Vite-конфиг фронтенда. Tailwind v4 через нативный плагин, без PostCSS.
// TanStack Router в file-based режиме — генерирует routeTree.gen.ts.
export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: 'src/routes',
      generatedRouteTree: 'src/routeTree.gen.ts',
    }),
    react(),
    tailwind(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@eden': path.resolve(__dirname, '../../packages/eden/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // VITE_API_PROXY переопределяется в docker-dev: там api живёт по http://api:3000.
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
