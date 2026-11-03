/**
 * Préparation de la base de DÉVELOPPEMENT LOCAL (US-035, ADR-070 ; guide docs/ops/INSTALL.md).
 * Lancé par le service `db-setup` de `compose.yaml` : `node packages/db/src/dev/cli.ts`.
 *
 * 1. Refuse de tourner hors `RUEDA_ENV=development` (fail-closed : jamais en préproduction ni en
 *    production, où le pipeline d'US-003 applique les migrations).
 * 2. Crée la base de développement si elle manque (sous l'administrateur du conteneur).
 * 3. Amorçage idempotent (rôles, droits, `btree_gist`) puis mots de passe des rôles de connexion,
 *    lus dans des fichiers tirés au hasard au premier lancement (service `secrets-init`,
 *    docker/dev/init-secrets.sh, un volume par rôle), jamais affichés ni commités.
 * 4. Migrations de production sous `migrator` (graines PA / PY comprises : 0009, générée depuis
 *    les données CFG), puis la surcouche `dev-overlay/` (base déclarée « development »).
 * 5. Vérification sous les rôles de PRODUCTION `app_api` et `app_worker` (L0-05) : rôle courant,
 *    ni SUPERUSER ni BYPASSRLS, base « development », pays des données CFG présents avec leur
 *    devise et des paramètres.
 *
 * `--verify-only` : saute les étapes 2 à 4 (contrôle d'une pile déjà prête).
 *
 * Variables (noms seulement, docs/ops/ENV_VARS.md) : `RUEDA_ENV`, `RUEDA_DEV_DB_HOST`,
 * `RUEDA_DEV_DB_PORT`, `RUEDA_DEV_DB_NAME`, `RUEDA_DEV_SECRETS_DIR`.
 * Aucune donnée personnelle n'est créée : les seules données sont la configuration pays.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { runBootstrap, setRolePasswords } from '../bootstrap.ts';
import { runMigrations } from '../migrate.ts';
import { MIGRATIONS_DIR, PACKAGE_ROOT } from '../paths.ts';
import { LOGIN_ROLES, MIGRATOR_ROLE } from '../roles.ts';
import type { LoginRole } from '../roles.ts';
import { redactError } from '../secrets.ts';

/**
 * Lit un fichier de secret (une ligne, fin de ligne retirée) ; le contenu n'apparaît dans aucune
 * erreur. Même contrat que le lecteur du banc (`readPasswordFile` du harnais), recopié ici : un
 * code hors tests n'entre pas dans `testing/` (contrôle C19 de packages/fake-adapters).
 */
export function readSecretFile(path: string): string {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'erreur';
    throw new Error(`fichier de secret illisible (${code}) : ${path}`, { cause: error });
  }
  const secret = content.replace(/^\uFEFF/, '').replace(/\r?\n$/, '');
  if (secret.length === 0 || /[\r\n]/.test(secret)) {
    throw new Error(`fichier de secret : une seule ligne non vide attendue (${path})`);
  }
  return secret;
}

/** Surcouche de développement : jamais appliquée par le pipeline de production. */
export const DEV_OVERLAY_DIR: string = join(PACKAGE_ROOT, 'dev-overlay');

/** Données CFG (source des graines 0009) : lues comme données, aucune constante pays ici. */
const COUNTRIES_FILE = join(
  PACKAGE_ROOT,
  '..',
  '..',
  'apps/api/src/modules/cfg/data/countries.json',
);

/** Préfixe des bases jetables du banc de tests : interdit, le banc les supprime. */
const BENCH_PREFIX = 'rueda_test_';

export interface DevSetupConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly secretsDir: string;
}

/** Lit et valide la configuration ; refuse tout environnement autre que development. */
export function devSetupConfig(env: Readonly<Record<string, string | undefined>>): DevSetupConfig {
  if (env['RUEDA_ENV'] !== 'development') {
    throw new Error(
      `base de développement refusée : RUEDA_ENV doit valoir « development » (reçu : ${
        env['RUEDA_ENV'] === undefined ? 'absent' : JSON.stringify(env['RUEDA_ENV'])
      })`,
    );
  }
  const database = env['RUEDA_DEV_DB_NAME'] ?? 'rueda_dev';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(database) || database.startsWith(BENCH_PREFIX)) {
    throw new Error(`RUEDA_DEV_DB_NAME invalide : ${database}`);
  }
  const port = Number(env['RUEDA_DEV_DB_PORT'] ?? '5432');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('RUEDA_DEV_DB_PORT invalide');
  }
  return {
    host: env['RUEDA_DEV_DB_HOST'] ?? 'postgres',
    port,
    database,
    secretsDir: env['RUEDA_DEV_SECRETS_DIR'] ?? '/run/rueda-secrets',
  };
}

/** Fichier de secret d'un rôle (`<dir>/<rôle>/password`) : un volume compose par rôle. */
export const secretFileOf = (dir: string, role: 'postgres' | LoginRole): string =>
  join(dir, role, 'password');

async function connect(
  config: DevSetupConfig,
  user: string,
  password: string,
  database: string,
): Promise<pg.Client> {
  const client = new pg.Client({
    host: config.host,
    port: config.port,
    user,
    password,
    database,
    application_name: 'rueda-dev-setup',
  });
  await client.connect();
  return client;
}

async function prepare(
  config: DevSetupConfig,
  admin: string,
  passwords: Readonly<Record<LoginRole, string>>,
  log: (line: string) => void,
): Promise<void> {
  const server = await connect(config, 'postgres', admin, 'postgres');
  try {
    const exists = await server.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1', [
      config.database,
    ]);
    if (exists.rowCount === 0) {
      // nom validé par devSetupConfig ([a-z0-9_])
      await server.query(`CREATE DATABASE "${config.database}" TEMPLATE template0 ENCODING 'UTF8'`);
      log(`base créée : ${config.database}`);
    } else {
      log(`base existante : ${config.database}`);
    }
  } finally {
    await server.end();
  }

  const db = await connect(config, 'postgres', admin, config.database);
  try {
    await runBootstrap(db);
    await setRolePasswords(db, passwords);
    log('amorçage rejoué, mots de passe des rôles de connexion posés');
  } finally {
    await db.end();
  }

  const migrator = await connect(config, MIGRATOR_ROLE, passwords.migrator, config.database);
  try {
    const applied = await runMigrations(migrator, [MIGRATIONS_DIR]);
    log(`${applied.length} migration(s) de production appliquée(s) sous ${MIGRATOR_ROLE}`);
    for (const name of readdirSync(DEV_OVERLAY_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await migrator.query('BEGIN');
      try {
        await migrator.query(readFileSync(join(DEV_OVERLAY_DIR, name), 'utf8'));
        await migrator.query('COMMIT');
      } catch (error) {
        await migrator.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      log(`surcouche de développement appliquée : ${name}`);
    }
  } finally {
    await migrator.end();
  }
}

interface CountryData {
  readonly countries: readonly { readonly code: string; readonly currency: string }[];
}

async function verify(
  config: DevSetupConfig,
  passwords: Readonly<Record<LoginRole, string>>,
  log: (line: string) => void,
): Promise<void> {
  const expected = (JSON.parse(readFileSync(COUNTRIES_FILE, 'utf8')) as CountryData).countries;
  for (const role of ['app_api', 'app_worker'] as const) {
    const client = await connect(config, role, passwords[role], config.database);
    try {
      // L0-05 : rôle de production, ni SUPERUSER ni BYPASSRLS.
      const who = await client.query<{ user: string; super: boolean; bypass: boolean }>(
        `SELECT current_user AS user, r.rolsuper AS super, r.rolbypassrls AS bypass
           FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`,
      );
      const me = who.rows[0];
      if (me?.user !== role || me.super || me.bypass) {
        throw new Error(`${role} : rôle de production attendu, sans SUPERUSER ni BYPASSRLS`);
      }
      const env = await client.query<{ env: string }>('SELECT platform.deployment_env() AS env');
      if (env.rows[0]?.env !== 'development') {
        throw new Error(`${role} : base « ${env.rows[0]?.env ?? '?'} », « development » attendu`);
      }
      const rows = await client.query<{ code: string; currency: string; params: string }>(
        `SELECT c.code, c.currency,
                (SELECT count(*) FROM core.config_param_value v WHERE v.country_code = c.code)::text AS params
           FROM core.config_country c ORDER BY c.code`,
      );
      for (const country of expected) {
        const row = rows.rows.find((r) => r.code === country.code);
        if (row === undefined || row.currency !== country.currency || Number(row.params) === 0) {
          throw new Error(`${role} : graine du pays ${country.code} absente ou incomplète`);
        }
      }
      log(
        `${role} : rôle de production, base development, graines ${rows.rows
          .map((r) => `${r.code} (${r.currency}, ${r.params} paramètres)`)
          .join(', ')}`,
      );
    } finally {
      await client.end();
    }
  }
}

export async function main(argv: readonly string[], env = process.env): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: { 'verify-only': { type: 'boolean', default: false } },
  });
  const config = devSetupConfig(env);
  const admin = readSecretFile(secretFileOf(config.secretsDir, 'postgres'));
  const passwords = Object.fromEntries(
    LOGIN_ROLES.map((r) => [r, readSecretFile(secretFileOf(config.secretsDir, r))]),
  ) as Record<LoginRole, string>;
  const secrets = [admin, ...Object.values(passwords)];
  const log = (line: string): void => {
    console.log(`[db-setup] ${line}`);
  };
  try {
    if (values['verify-only'] !== true) await prepare(config, admin, passwords, log);
    await verify(config, passwords, log);
    log('base de développement prête');
  } catch (error) {
    throw redactError(error, secrets);
  }
}
