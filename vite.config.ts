import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({ registerType: 'autoUpdate', includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'], manifest: { name: 'Owli-AI Assist', short_name: 'Owli Assist', description: 'Barrierefreie KI-Szenenbeschreibung und Audio-Postcards im Browser.', lang: 'de', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait-primary', background_color: '#08111f', theme_color: '#08111f', categories: ['accessibility', 'utilities'], icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }, workbox: { cleanupOutdatedCaches: true, navigateFallbackDenylist: [/^\/api\//], runtimeCaching: [] }, devOptions: { enabled: false } })],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: { target: 'es2022', sourcemap: true },
});
