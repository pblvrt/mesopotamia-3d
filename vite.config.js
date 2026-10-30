import { defineConfig } from 'vite';

// Data in src/data/*.json and *.geojson is bundled at build time via import.meta.glob
// (see src/data.js). Terrain in public/terrain/ is copied verbatim and fetched at runtime.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  server: { host: true },
  preview: { host: true },
});
