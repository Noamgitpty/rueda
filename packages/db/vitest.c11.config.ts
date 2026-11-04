import { defineConfig } from 'vitest/config';
import { databaseTestOptions } from './vitest.shared.ts';

// pnpm --filter @rueda/db test:c11 — fuzz d'entrelacements C11 (L0-09) et oracle de production C12
// (US-025, ADR-068), sous les rôles de production, sur la base `fuzz` du banc. Job de CI dédié
// (`fuzz-c11` de ci.yml : mode court, 1 000 exécutions) et nuit (`nightly.yml` : 10 lots de 1 000).
export default defineConfig({
  test: {
    ...databaseTestOptions,
    include: ['test/l0/l0-c11-fuzz.test.ts'],
    fileParallelism: false,
  },
});
