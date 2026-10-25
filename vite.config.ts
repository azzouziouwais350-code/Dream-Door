import { defineConfig } from 'vitest/config';

// Base relative par défaut : fonctionne sous https://UTILISATEUR.github.io/NOM-DU-DEPOT/
// Le workflow GitHub Actions fixe BASE_PATH=/NOM-DU-DEPOT/ explicitement.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  build: {
    outDir: 'dist',
    // Phaser (~1,2 Mo) dans un chunk séparé : mieux mis en cache entre deux versions du jeu.
    chunkSizeWarningLimit: 1600,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes('node_modules/phaser') ? 'phaser' : undefined;
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
