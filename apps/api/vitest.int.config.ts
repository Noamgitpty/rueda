import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

// pnpm test:int — PostgreSQL réel (banc de @rueda/db : base jetable, rôles de production,
// assertion L0-05 obligatoire dans chaque test). La CI fait foi (ADR-043). Module BUS : test/int (US-008).
const require = createRequire(import.meta.url);

export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts', 'test/int/**/*.test.ts'],
    globalSetup: [require.resolve('@rueda/db/testing/global-setup')],
    setupFiles: [require.resolve('@rueda/db/testing/setup-l0-05')],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
    // les adaptateurs FAKE (US-019) refusent de se construire hors development / test (C19)
    env: { RUEDA_ENV: 'test' },
  },
});
