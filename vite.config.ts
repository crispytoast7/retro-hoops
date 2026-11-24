import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base so the same build works at a domain root or under a sub-path
// (GitHub Pages serves this at /<repo>/).
export default defineConfig({
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Retro Hoops',
        short_name: 'Retro Hoops',
        description: 'Retro pixel-art basketball: run the franchise, play the big possessions.',
        theme_color: '#14121f',
        background_color: '#14121f',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    }),
  ],
  // generous: this machine is often busy with other work, and a slow run is not a failed one
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
