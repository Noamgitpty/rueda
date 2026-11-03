// API publique de @rueda/db (US-005).
export { BOOTSTRAP_LOCK_KEY, runBootstrap, setRolePasswords } from './bootstrap.ts';
export {
  checksumOf,
  listMigrations,
  MIGRATION_FILE_PATTERN,
  MIGRATION_LOCK_KEY,
  planMigrations,
  runMigrations,
} from './migrate.ts';
export type { AppliedMigration, MigrationFile, RunMigrationsOptions } from './migrate.ts';
export { BOOTSTRAP_DIR, MIGRATIONS_DIR, PACKAGE_ROOT, TEST_MIGRATIONS_DIR } from './paths.ts';
export {
  APP_ROLES,
  isAppRole,
  LOGIN_ROLES,
  MANAGED_ROLES,
  MIGRATOR_ROLE,
  OWNER_ROLES,
} from './roles.ts';
export type { AppRole, LoginRole, OwnerRole } from './roles.ts';
export { maskConnectionString, redactError, redactSecrets } from './secrets.ts';
export { randomPassword, scramSha256Verifier } from './scram.ts';
export { CONSTRAINT_CODES, DB_BUSINESS_CODES, SQLSTATE, translateDbError } from './errors.ts';
export type { DbBusinessCode, DbBusinessError } from './errors.ts';
export {
  ACTOR_KINDS,
  SESSION_SETTINGS,
  SET_SESSION_CONTEXT_SQL,
  SessionContextError,
  sessionSettings,
  setSessionContext,
} from './session-context.ts';
export type { ActorKind, Queryable, SessionContext, SessionSetting } from './session-context.ts';
