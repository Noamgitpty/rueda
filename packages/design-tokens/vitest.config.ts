import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Le lint des styles parcourt tous les fichiers du dépôt : 0,4 s en local, mais 5,9 s
    // (au-delà du délai par défaut de 5 s) sur un exécuteur de CI chargé (PR #124). Même
    // correctif que US-046 pour packages/db (PR #119). Assertions inchangées.
    testTimeout: 30_000,
  },
});
