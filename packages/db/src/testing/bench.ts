/**
 * Banc PostgreSQL d'une série de tests (ADR-043 ; 17 §1.3, §11 L0-05, L0-06).
 *
 * 1. Prend un verrou consultatif dans la base d'administration : une seule série à la fois par
 *    instance (les mots de passe des rôles d'instance changent à chaque série).
 * 2. Supprime les bases `rueda_test_*` orphelines d'une série interrompue (sous le verrou).
 * 3. Crée deux bases jetables :
 *    - `rueda_test_<aléa>` : migrations de production + migrations de test (horloge virtuelle) ;
 *    - `rueda_test_<aléa>_prod` : migrations de production seules (contrôle du corps L0-06) ;
 *    - copies (`TEMPLATE`) de la base principale juste après ses migrations : `_inj` (injection
 *      de L0-02, ADR-056) et `_fuzz` (fuzz C11 et oracle C12, US-025, ADR-068) ;
 *    - `rueda_test_<aléa>_mig` : amorcée (rôles, droits) mais SANS migration : le test des
 *      migrations (US-046, RLS-19) les y applique une par une, sous `migrator`, sur des graines.
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

/**
 * `deadlock_timeout` de la base d'**injection** du banc (ADR-056, « Cascade d'interblocages de
 * l'injection »). Sans le verrou par véhicule, PostgreSQL résout les cycles d'attente de la
 * contrainte d'exclusion un par un, chacun au bout de `deadlock_timeout` : avec le défaut de 1 s,
 * une course de 100 poses dure environ une seconde par `40P01` (jusqu'à plus de 60 s). Seule la
 * base d'injection, copie de la base principale réservée au cas « sans verrou » de L0-02, reçoit ce
 * délai ; la base principale garde le réglage du serveur (1 s, celui de la production), sous lequel
 * le p95 « avec verrou » est mesuré. Aucun rôle ni droit ne change. PROPOSÉ.
 */
export const BENCH_DEADLOCK_TIMEOUT = '50ms';

/** Ce que les fichiers de test reçoivent (`inject('ruedaBench')`). */
export interface BenchInfo {
  readonly sourceKind: AdminSource['kind'];
  readonly host: string;
  readonly port: number;
  /** Base principale (migrations de production + test-migrations). */
  readonly database: string;
  /** Base de contrôle (migrations de production seules). */
  readonly productionDatabase: string;
  /**
   * Base d'injection : copie (`TEMPLATE`) de la base principale juste après ses migrations, avec
   * `deadlock_timeout = BENCH_DEADLOCK_TIMEOUT`. Réservée au cas « sans verrou » de L0-02.
   */
  readonly injectionDatabase: string;
  /**
   * Base du fuzz C11 et de l'oracle C12 (US-025, ADR-068) : copie (`TEMPLATE`) de la base
   * principale juste après ses migrations, réglages du serveur inchangés. Aucun autre fichier n'y
   * écrit : les travailleurs du fuzz, qui balaient toute la base, n'y touchent que ses données, et
   * l'oracle C12 y est exigé à zéro sur TOUTE la base.
   */
  readonly fuzzDatabase: string;
  /**
   * Base des migrations (US-046, ADR-081) : amorcée, sans aucune migration. Seul le test des
   * migrations l'utilise (application une par une sous `migrator`, graines, RLS-19).
   */
  readonly migrationDatabase: string;
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
  const injectionDatabase = `${TEST_DATABASE_PREFIX}${suffix}_inj`;
  const fuzzDatabase = `${TEST_DATABASE_PREFIX}${suffix}_fuzz`;
  const migrationDatabase = `${TEST_DATABASE_PREFIX}${suffix}_mig`;
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

    // Base d'injection : copie de la base principale migrée (aucune connexion ouverte sur elle à
    // ce stade, condition de TEMPLATE). Les réglages de base ne sont pas copiés : seul le délai
    // ci-dessous s'applique, à cette base seulement.
    await lockClient.query(
      `CREATE DATABASE ${quoteIdent(injectionDatabase)} TEMPLATE ${quoteIdent(database)}`,
    );
    created.push(injectionDatabase);
    // valeur littérale constante (BENCH_DEADLOCK_TIMEOUT) : aucune donnée externe
    await lockClient.query(
      `ALTER DATABASE ${quoteIdent(injectionDatabase)} SET deadlock_timeout = '${BENCH_DEADLOCK_TIMEOUT}'`,
    );
    log(
      `base d'injection créée : ${injectionDatabase} (deadlock_timeout ${BENCH_DEADLOCK_TIMEOUT})`,
    );
    // Base du fuzz C11 / oracle C12 : seconde copie, réglages du serveur (ceux de production).
    await lockClient.query(
      `CREATE DATABASE ${quoteIdent(fuzzDatabase)} TEMPLATE ${quoteIdent(database)}`,
    );
    created.push(fuzzDatabase);
    log(`base du fuzz créée : ${fuzzDatabase}`);

    // Base des migrations : amorçage seulement (rôles d'instance, droits, extensions) ; les
    // migrations y sont appliquées une par une par le test US-046.
    await lockClient.query(
      `CREATE DATABASE ${quoteIdent(migrationDatabase)} TEMPLATE template0 ENCODING 'UTF8'`,
    );
    created.push(migrationDatabase);
    const migAdmin = await connect(source.admin, migrationDatabase);
    try {
      await runBootstrap(migAdmin);
    } finally {
      await migAdmin.end();
    }
    log(`base des migrations créée (sans migration) : ${migrationDatabase}`);
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
      injectionDatabase,
      fuzzDatabase,
      migrationDatabase,
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
