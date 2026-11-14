import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Les tests de propriétés (fast-check) dépassent parfois 5 s sur un runner
    // chargé (run 43586947613 : monotonie de l'annulation, PA). Délai explicite
    // plutôt qu'une relance de la CI.
    testTimeout: 30_000,
  },
});
