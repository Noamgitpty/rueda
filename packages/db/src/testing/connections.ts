/**
 * Connexions de test sous les rôles de production (CLAUDE.md point 6 ; 17 §2.3, §11 L0-05).
 *
 * - Connexions **directes, sans pooler** (`pg.Client`, une connexion physique par appel) :
 *   `SET LOCAL` et `RESET ALL` ont donc l'effet attendu (17 §1.3 point 2 bis).
 * - Chaque connexion commence par l'**assertion L0-05** : `current_user ∈ {app_api, app_worker,
 *   app_anon}` et `NOT rolsuper AND NOT rolbypassrls`. Un compteur vérifie (setup L0-05) que
 *   chaque test l'a exécutée au moins une fois.
 * - `withTestTransaction` pose l'horloge virtuelle par `SET LOCAL app.virtual_now` (jamais au
 *   niveau session), vérifie que `platform.now()` est dans la fenêtre attendue, puis termine la
 *   transaction et fait `RESET ALL`.
 */
import { inject } from 'vitest';
import pg from 'pg';
import { APP_ROLES, isAppRole } from '../roles.ts';
import type { AppRole, LoginRole } from '../roles.ts';
import { redactError } from '../secrets.ts';
import type { BenchInfo } from './bench.ts';

/**
 * `injection` : réservée au cas « sans verrou » de L0-02 (ADR-056) ; `fuzz` : réservée au fuzz C11
 * et à l'oracle C12 (US-025, ADR-068).
 */
export type BenchDatabase = 'main' | 'production' | 'injection' | 'fuzz';

let roleAssertions = 0;

/** Nombre d'assertions L0-05 tentées depuis la dernière remise à zéro (setup L0-05). */
export function roleAssertionCount(): number {
  return roleAssertions;
}
export function resetRoleAssertionCount(): void {
  roleAssertions = 0;
}

export function benchInfo(): BenchInfo {
  const info = inject('ruedaBench');
  if (!info) throw new Error('banc absent : la suite doit utiliser le globalSetup de @rueda/db');
  return info;
}

const benchSecrets = (info: BenchInfo): string[] => [
  info.admin.password,
  ...Object.values(info.passwords),
];

/** Erreur de l'assertion L0-05. */
export class ProductionRoleAssertionError extends Error {
  override readonly name = 'ProductionRoleAssertionError';
}

/**
 * Assertion L0-05 (17 §11) : la connexion tourne sous un rôle de production, sans
 * `SUPERUSER` ni `BYPASSRLS`. À exécuter en tête de chaque test.
 */
export async function assertProductionRole(
  client: pg.ClientBase,
  expected?: AppRole,
): Promise<AppRole> {
  roleAssertions++;
  const result = await client.query<{
    current_user: string;
    session_user: string;
    rolsuper: boolean | null;
    rolbypassrls: boolean | null;
  }>(
    `SELECT current_user, session_user, r.rolsuper, r.rolbypassrls
       FROM (SELECT 1) AS one
       LEFT JOIN pg_catalog.pg_roles r ON r.rolname = current_user`,
  );
  const row = result.rows[0];
  const user = row?.current_user ?? '?';
  if (!row || !isAppRole(user)) {
    throw new ProductionRoleAssertionError(
      `L0-05 : current_user = ${user}, attendu l'un de ${APP_ROLES.join(', ')}`,
    );
  }
  if (row.rolsuper !== false || row.rolbypassrls !== false) {
    throw new ProductionRoleAssertionError(
      `L0-05 : ${user} a rolsuper = ${String(row.rolsuper)}, rolbypassrls = ${String(row.rolbypassrls)}`,
    );
  }
  if (expected !== undefined && user !== expected) {
    throw new ProductionRoleAssertionError(`L0-05 : current_user = ${user}, attendu ${expected}`);
  }
  return user;
}

async function openClient(
  info: BenchInfo,
  user: string,
  password: string,
  database: BenchDatabase,
): Promise<pg.Client> {
  const client = new pg.Client({
    host: info.host,
    port: info.port,
    user,
    password,
    database:
      database === 'main'
        ? info.database
        : database === 'production'
          ? info.productionDatabase
          : database === 'injection'
            ? info.injectionDatabase
            : info.fuzzDatabase,
    application_name: `rueda-test-${user}`,
  });
  try {
    await client.connect();
  } catch (error) {
    throw redactError(error, benchSecrets(info));
  }
  return client;
}

/** Connexion directe sous un rôle de production, assertion L0-05 faite. */
export async function connectAs(
  role: AppRole,
  options: { readonly database?: BenchDatabase } = {},
): Promise<pg.Client> {
  const info = benchInfo();
  const client = await openClient(info, role, info.passwords[role], options.database ?? 'main');
  try {
    await assertProductionRole(client, role);
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  return client;
}

/** Restitue une connexion : `RESET ALL`, puis fermeture. */
export async function releaseClient(client: pg.Client): Promise<void> {
  try {
    await client.query('RESET ALL');
  } finally {
    await client.end();
  }
}

/** Exécute `fn` sur une connexion directe sous `role` (assertion L0-05 en tête). */
export async function withRole<T>(
  role: AppRole,
  fn: (client: pg.Client) => Promise<T>,
  options: { readonly database?: BenchDatabase } = {},
): Promise<T> {
  const client = await connectAs(role, options);
  try {
    return await fn(client);
  } finally {
    await releaseClient(client);
  }
}

/**
 * RÉSERVÉ AUX TESTS NÉGATIFS de l'assertion L0-05 : connexion sous `migrator` ou sous
 * l'administrateur, **sans** assertion. Aucun test fonctionnel ne doit l'utiliser.
 */
export async function connectForNegativeRoleTest(
  who: Extract<LoginRole, 'migrator'> | 'admin',
  options: { readonly database?: BenchDatabase } = {},
): Promise<pg.Client> {
  const info = benchInfo();
  const [user, password] =
    who === 'admin'
      ? [info.admin.user, info.admin.password]
      : ['migrator', info.passwords.migrator];
  return openClient(info, user, password, options.database ?? 'main');
}

export interface TestTransactionOptions {
  /** Horloge virtuelle posée par `SET LOCAL app.virtual_now` (ISO 8601 avec fuseau). */
  readonly virtualNow?: string;
  /** `COMMIT` au lieu du `ROLLBACK` par défaut. */
  readonly commit?: boolean;
  /** Tolérance, sans horloge virtuelle, entre `platform.now()` et l'horloge du test (ms). */
  readonly realClockToleranceMs?: number;
}

/**
 * Transaction de test : `BEGIN`, `SET LOCAL app.virtual_now` éventuel, contrôle de la fenêtre
 * de `platform.now()`, `fn`, puis `ROLLBACK` (ou `COMMIT`) et `RESET ALL` dans tous les cas.
 */
export async function withTestTransaction<T>(
  client: pg.ClientBase,
  options: TestTransactionOptions,
  fn: (client: pg.ClientBase) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  let done = false;
  try {
    if (options.virtualNow !== undefined) {
      // set_config(…, true) = SET LOCAL, avec un paramètre lié (pas de SQL construit).
      await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
        options.virtualNow,
      ]);
      const check = await client.query<{ ok: boolean }>(
        'SELECT platform.now() = $1::timestamptz AS ok',
        [options.virtualNow],
      );
      if (check.rows[0]?.ok !== true) {
        throw new Error(
          `horloge virtuelle non appliquée : platform.now() <> ${options.virtualNow}`,
        );
      }
    } else {
      const tolerance = options.realClockToleranceMs ?? 120_000;
      const check = await client.query<{ epoch_ms: string }>(
        'SELECT (extract(epoch FROM platform.now()) * 1000)::bigint::text AS epoch_ms',
      );
      const drift = Math.abs(Number(check.rows[0]?.epoch_ms) - Date.now());
      if (!(drift <= tolerance)) {
        throw new Error(
          `platform.now() hors de la fenêtre attendue (écart ${drift} ms > ${tolerance} ms) : ` +
            'horloge virtuelle résiduelle ?',
        );
      }
    }
    const result = await fn(client);
    await client.query(options.commit === true ? 'COMMIT' : 'ROLLBACK');
    done = true;
    return result;
  } finally {
    if (!done) await client.query('ROLLBACK').catch(() => undefined);
    await client.query('RESET ALL');
  }
}
