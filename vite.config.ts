import { defineConfig } from 'vitest/config';

// Base relative par défaut : fonctionne sous https://UTILISATEUR.github.io/NOM-DU-DEPOT/
// Le workflow GitHub Actions fixe BASE_PATH=/NOM-DU-DEPOT/ explicitement.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
