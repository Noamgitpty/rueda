import { defineConfig } from 'vitest/config';

// pnpm --filter @rueda/db test:drill — EXERCICE DE RESTAURATION chronométré (US-051, ADR-082).
// Lancé par scripts/ops/restore-drill.sh, qui crée l'instance source (journaux archivés) et ses
// volumes ; jamais par test:int ni test:l0. Le globalSetup prépare une PRÉPRODUCTION (job de base,
// déclaration « preproduction ») au lieu du banc jetable ; l'assertion L0-05 reste exigée.
export default defineConfig({
  test: {
    include: ['test/drill/**/*.test.ts'],
    globalSetup: ['./test/drill/global-setup.ts'],
    setupFiles: ['./src/testing/setup-l0-05.ts'],
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 300_000,
    teardownTimeout: 60_000,
    env: { RUEDA_ENV: 'test' },
  },
});
