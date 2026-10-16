import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Ask before reloading so an update never cuts off a streaming reply.
      registerType: 'prompt',
      // index.html sets light/dark theme-color itself.
      pwaAssets: { config: true, injectThemeColor: false },
      manifest: {
        name: 'aimvp',
        short_name: 'aimvp',
        description: 'Chat with any AI model using your own OpenRouter key.',
        theme_color: '#18181b',
        background_color: '#18181b',
        display: 'standalone',
        start_url: '/',
        scope: '/',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // ~190 kB gzipped, precached by the service worker; markdown is split out separately.
  build: { chunkSizeWarningLimit: 650 },
  // OpenRouter only accepts localhost OAuth callbacks on port 3000.
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
})
