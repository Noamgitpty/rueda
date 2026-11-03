import { defineConfig } from 'vitest/config';
import type { ViteUserConfig } from 'vitest/config';

/** Options communes des suites sur PostgreSQL réel (`test:int`, `test:l0`). */
export const databaseTestOptions = {
  globalSetup: ['./src/testing/global-setup.ts'],
  setupFiles: ['./src/testing/setup-l0-05.ts'],
  // Premier démarrage d'un conteneur (CI) ou connexion lente sous Windows.
  testTimeout: 30_000,
  hookTimeout: 120_000,
  teardownTimeout: 60_000,
  // les adaptateurs FAKE (US-020) refusent de se construire hors development / test (C19)
  env: { RUEDA_ENV: 'test' },
};

/** Configuration des suites sur PostgreSQL réel (`test:int`, `test:l0`). */
export function databaseSuite(include: string[]): ViteUserConfig {
  return defineConfig({ test: { include, ...databaseTestOptions } });
}
