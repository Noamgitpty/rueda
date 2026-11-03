/**
 * Banc PostgreSQL d'une série de tests (ADR-043 ; 17 §1.3, §11 L0-05, L0-06).
 *
 * 1. Prend un verrou consultatif dans la base d'administration : une seule série à la fois par
 *    instance (les mots de passe des rôles d'instance changent à chaque série).
 * 2. Supprime les bases `rueda_test_*` orphelines d'une série interrompue (sous le verrou).
 * 3. Crée deux bases jetables :
 *    - `rueda_test_<aléa>` : migrations de production + migrations de test (horloge virtuelle) ;
 *    - `rueda_test_<aléa>_prod` : migrations de production seules (contrôle du corps L0-06).
 * 4. Dans chacune : amorçage idempotent sous l'administrateur (rôles, droits, `btree_gist`),
 *    puis migrations sous `migrator`.
 * 5. Pose des mots de passe aléatoires propres à la série pour `migrator` et les rôles applicatifs.
 *
 * `teardown()` supprime les bases et libère le verrou, même si la série a échoué.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runBootstrap, setRolePasswords } from '../bootstrap.ts';
import { runMigrations } from '../migrate.ts';
import { MIGRATIONS_DIR, TEST_MIGRATIONS_DIR } from '../paths.ts';
import { LOGIN_ROLES, MIGRATOR_ROLE } from '../roles.ts';
import type { LoginRole } from '../roles.ts';
import { randomPassword } from '../scram.ts';
import { redactError } from '../secrets.ts';
import type { AdminSource, ConnectionTarget } from './source.ts';

export const TEST_DATABASE_PREFIX = 'rueda_test_';

/** Clé du verrou d'instance du banc (pris dans la base d'administration). */
export const BENCH_LOCK_KEY = 7_305_110_005;

/** Ce que les fichiers de test reçoivent (`inject('ruedaBench')`). */
export interface BenchInfo {
  readonly sourceKind: AdminSource['kind'];
  readonly host: string;
  readonly port: number;
  /** Base principale (migrations de production + test-migrations). */
  readonly database: string;
  /** Base de contrôle (migrations de production seules). */
  readonly productionDatabase: string;
  readonly passwords: Readonly<Record<LoginRole, string>>;
  /** Migrations appliquées sous `migrator` (`NNNN_nom`), par base. */
  readonly appliedMigrations: {
    readonly main: readonly string[];
    readonly production: readonly string[];
  };
  /** Administrateur : réservé aux tests NÉGATIFS de l'assertion L0-05. */
  readonly admin: ConnectionTarget;
}

export interface Bench {
  readonly info: BenchInfo;
  /** Tous les secrets de la série, pour expurger les messages. */
  readonly secrets: readonly string[];
  teardown(): Promise<void>;
}

const quoteIdent = (name: string): string => {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`identifiant inattendu : ${name}`);
  return `"${name}"`;
};

async function connect(target: ConnectionTarget, database = target.database): Promise<pg.Client> {
  const client = new pg.Client({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database,
    application_name: 'rueda-test-bench',
  });
  await client.connect();
  return client;
}

/** Prépare le banc. En cas d'échec, tout ce qui a été créé est supprimé. */
export async function provisionBench(
  source: AdminSource,
  log: (line: string) => void = () => undefined,
): Promise<Bench> {
  const passwords = Object.fromEntries(LOGIN_ROLES.map((r) => [r, randomPassword()])) as Record<
    LoginRole,
    string
  >;
  const secrets = [source.admin.password, ...Object.values(passwords)];
  const suffix = randomBytes(6).toString('hex');
  const database = `${TEST_DATABASE_PREFIX}${suffix}`;
  const productionDatabase = `${TEST_DATABASE_PREFIX}${suffix}_prod`;
  const created: string[] = [];
  const appliedMigrations: { main: string[]; production: string[] } = { main: [], production: [] };

  let lockClient: pg.Client | undefined;
  const dropAll = async (): Promise<void> => {
    if (!lockClient) return;
    for (const name of created.splice(0).reverse()) {
      await lockClient.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
      log(`base supprimée : ${name}`);
    }
  };
  const release = async (): Promise<void> => {
    const client = lockClient;
    lockClient = undefined;
    if (!client) return;
    try {
      await client.query('SELECT pg_catalog.pg_advisory_unlock($1)', [BENCH_LOCK_KEY]);
    } finally {
      await client.end();
    }
  };

  try {
    lockClient = await connect(source.admin);
    await lockClient.query(`SET lock_timeout = '120s'`);
    await lockClient.query('SELECT pg_catalog.pg_advisory_lock($1)', [BENCH_LOCK_KEY]);

    const orphans = await lockClient.query<{ datname: string }>(
      `SELECT datname FROM pg_catalog.pg_database WHERE datname LIKE 'rueda\\_test\\_%' ORDER BY 1`,
    );
    for (const { datname } of orphans.rows) {
      await lockClient.query(`DROP DATABASE IF EXISTS ${quoteIdent(datname)} WITH (FORCE)`);
      log(`base orpheline supprimée : ${datname}`);
    }

    for (const [name, dirs, key] of [
      [database, [MIGRATIONS_DIR, TEST_MIGRATIONS_DIR], 'main'],
      [productionDatabase, [MIGRATIONS_DIR], 'production'],
    ] as const) {
      await lockClient.query(
        `CREATE DATABASE ${quoteIdent(name)} TEMPLATE template0 ENCODING 'UTF8'`,
      );
      created.push(name);
      log(`base créée : ${name}`);

      const admin = await connect(source.admin, name);
      try {
        await runBootstrap(admin);
        await setRolePasswords(admin, passwords);
      } finally {
        await admin.end();
      }

      const migrator = await connect(
        { ...source.admin, user: MIGRATOR_ROLE, password: passwords.migrator },
        name,
      );
      try {
        const applied = await runMigrations(migrator, dirs);
        appliedMigrations[key] = applied.map((m) => `${m.version}_${m.name}`);
        log(`${name} : ${applied.length} migration(s) appliquée(s) sous ${MIGRATOR_ROLE}`);
        // Idempotence : un second passage ne doit rien appliquer.
        const again = await runMigrations(migrator, dirs);
        if (again.length > 0)
          throw new Error(`${name} : second passage non vide (${again.length})`);
      } finally {
        await migrator.end();
      }
    }
  } catch (error) {
    const safe = redactError(error, secrets);
    try {
      await dropAll();
    } catch (cleanupError) {
      log(`nettoyage incomplet : ${redactError(cleanupError, secrets).message}`);
    } finally {
      await release().catch(() => undefined);
    }
    throw safe;
  }

  return {
    info: {
      sourceKind: source.kind,
      host: source.admin.host,
      port: source.admin.port,
      database,
      productionDatabase,
      passwords,
      appliedMigrations,
      admin: source.admin,
    },
    secrets,
    teardown: async () => {
      try {
        await dropAll();
      } catch (error) {
        throw redactError(error, secrets);
      } finally {
        await release().catch(() => undefined);
      }
    },
  };
}
