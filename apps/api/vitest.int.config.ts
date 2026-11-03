import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// pnpm test:int — module BUS sur PostgreSQL réel, sous les rôles de production (US-008).
// Banc et garde-fou L0-05 de @rueda/db (US-005) : mêmes règles que packages/db.
export default defineConfig({
  test: {
    include: ['test/int/**/*.test.ts'],
    globalSetup: [fileURLToPath(import.meta.resolve('@rueda/db/testing/global-setup'))],
    setupFiles: [fileURLToPath(import.meta.resolve('@rueda/db/testing/setup-l0-05'))],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
  },
});
