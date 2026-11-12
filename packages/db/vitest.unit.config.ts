import { defineConfig } from 'vitest/config';

// pnpm test:unit — sans base de données : schemas.test.ts (US-001), src/** et les aides pures de test/support (US-007).
export default defineConfig({
  test: {
    include: ['*.test.ts', 'src/**/*.test.ts', 'test/support/**/*.test.ts'],
    // Plusieurs tests lisent toutes les migrations du dépôt (lint expand / contract, préfixes,
    // numérotation, inventaire, schéma) : le délai par défaut de 5 s a été dépassé sur un
    // exécuteur de CI chargé (run 43188707160, PR #117). Assertions inchangées.
    testTimeout: 30_000,
    // les adaptateurs FAKE (US-020) refusent de se construire hors development / test (C19)
    env: { RUEDA_ENV: 'test' },
  },
});
