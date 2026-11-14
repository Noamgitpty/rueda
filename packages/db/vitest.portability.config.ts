import { defineConfig } from 'vitest/config';

// pnpm --filter @rueda/db test:portability — EXERCICE DE PORTABILITÉ (US-036, ADR-120).
// Lancé par scripts/ops/portability-drill.sh (fin du job CI « reprise »), qui crée l'instance
// source et l'instance cible ; jamais par test:int ni test:l0. Même globalSetup que l'exercice de
// restauration (préproduction déclarée, peuplée sous les rôles de production) ; l'assertion L0-05
// reste exigée.
export default defineConfig({
  test: {
    include: ['test/portability/**/*.test.ts'],
    globalSetup: ['./test/drill/global-setup.ts'],
    setupFiles: ['./src/testing/setup-l0-05.ts'],
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 300_000,
    teardownTimeout: 60_000,
    env: { RUEDA_ENV: 'test' },
  },
});
