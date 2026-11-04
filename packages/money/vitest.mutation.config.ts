import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * US-042 : suite rejouée par Stryker pour chaque mutant (`stryker.config.mjs`) — tests unitaires
 * et comparaison aux oracles Python en mode réduit. Les attendus de l'oracle ne dépendent pas du
 * code muté : ils sont calculés une fois, puis lus dans le cache (`RUEDA_MONEY_ORACLE_CACHE`).
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/oracle/**/*.oracle.ts'],
    testTimeout: 600_000,
    env: {
      RUEDA_MONEY_ORACLE_RUNS: process.env['RUEDA_MONEY_ORACLE_RUNS'] ?? '2000',
      RUEDA_MONEY_ORACLE_PRIMITIVE_RUNS: process.env['RUEDA_MONEY_ORACLE_PRIMITIVE_RUNS'] ?? '1000',
      RUEDA_MONEY_ORACLE_CACHE:
        process.env['RUEDA_MONEY_ORACLE_CACHE'] ?? join(tmpdir(), 'rueda-money-oracle-cache'),
    },
  },
});
