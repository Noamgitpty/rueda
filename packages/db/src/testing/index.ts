// Harnais de tests PostgreSQL (US-005). Réservé aux tests : ne jamais importer en production.
export {
  assertProductionRole,
  benchInfo,
  connectAs,
  connectForNegativeRoleTest,
  ProductionRoleAssertionError,
  releaseClient,
  withRole,
  withTestTransaction,
} from './connections.ts';
export type { BenchDatabase, TestTransactionOptions } from './connections.ts';
export { provisionBench, TEST_DATABASE_PREFIX } from './bench.ts';
export type { Bench, BenchInfo } from './bench.ts';
export { parseAdminUrl, POSTGRES_IMAGE, readPasswordFile, resolveAdminSource } from './source.ts';
export type { AdminSource, ConnectionTarget } from './source.ts';
export { assertNotProduction, FakeKeyWrapper, InMemoryFileStore } from './fake-audit-adapters.ts';
