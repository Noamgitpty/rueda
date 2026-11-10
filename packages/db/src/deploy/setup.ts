/**
 * Job de base du DÉPLOIEMENT (US-003, ADR-078 ; runbook docs/ops/DEPLOY.md) : exécuté avant chaque
 * version, en préproduction puis en production, par la tâche ponctuelle `migrate` de l'image de
 * production (`node packages/db/src/deploy/cli.ts`).
 *
 * 1. Refuse de tourner hors `RUEDA_ENV` = `preproduction` ou `production` (absent ⇒ refus : ce job
 *    déclare l'environnement, il ne le devine pas). Le développement local a son propre job
 *    (`src/dev/`), les tests leur banc.
 * 2. Amorçage idempotent sous le rôle d'administration de l'instance (rôles, droits, `btree_gist`),
 *    puis mots de passe des rôles de connexion. La base elle-même est créée par l'IaC.
 * 3. Migrations de production sous `migrator` (expand / contract : une version N+1 ne casse jamais
 *    la version N encore servie ; le retour arrière ne rejoue aucune migration descendante).
 * 4. Déclaration de l'environnement (`platform.declare_environment`, migration 0050) : écrite une
 *    fois, jamais modifiée ; une base déjà déclarée autrement fait échouer le job.
 * 5. Vérification sous le rôle de PRODUCTION `app_api` (L0-05) : rôle courant sans SUPERUSER ni
 *    BYPASSRLS, `platform.deployment_env()` égale à l'environnement visé, aucun compte PSP `FAKE`
 *    (C19 : refusé en préproduction comme en production, l'image n'a pas de FAKE), et aucune
 *    fonction de `pg_catalog` à effet de bord exécutable par un rôle applicatif (US-049, F-RLS-04 :
 *    sur un service géré, l'amorçage peut ne pas pouvoir les retirer ; le déploiement échoue alors
 *    au lieu de n'émettre qu'un avertissement).
 *
 * Secrets (noms seulement, docs/ops/ENV_VARS.md) : injectés par l'orchestrateur de conteneurs depuis
 * le coffre, jamais affichés ni journalisés ; tout message d'erreur est expurgé.
 * Aucune donnée personnelle n'est créée : les seules données sont la configuration pays (0009).
 */
import pg from 'pg';
import { runBootstrap, setRolePasswords } from '../bootstrap.ts';
import { runMigrations } from '../migrate.ts';
import { MIGRATIONS_DIR } from '../paths.ts';
import { LOGIN_ROLES, MIGRATOR_ROLE } from '../roles.ts';
import type { LoginRole } from '../roles.ts';
import {
  PROBED_ROLES,
  SIDE_EFFECT_FUNCTIONS,
  SIDE_EFFECT_PROBE_SQL,
} from '../catalog-functions.ts';
import { redactError } from '../secrets.ts';

export const DEPLOY_ENVIRONMENTS = ['preproduction', 'production'] as const;
export type DeployEnvironment = (typeof DEPLOY_ENVIRONMENTS)[number];

/** Variable du mot de passe de chaque rôle de connexion (secret du coffre). */
export const PASSWORD_VARIABLES: Readonly<Record<LoginRole, string>> = {
  migrator: 'RUEDA_DB_MIGRATOR_PASSWORD',
  app_api: 'RUEDA_DB_APP_API_PASSWORD',
  app_worker: 'RUEDA_DB_APP_WORKER_PASSWORD',
  app_anon: 'RUEDA_DB_APP_ANON_PASSWORD',
};

export interface DeployConfig {
  readonly environment: DeployEnvironment;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly adminUser: string;
  readonly adminPassword: string;
  readonly passwords: Readonly<Record<LoginRole, string>>;
}

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
/** Mots de passe tirés par le coffre : longueur minimale, une seule ligne. */
const MIN_PASSWORD_LENGTH = 24;

function secret(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} absente (secret du coffre)`);
  if (/[\r\n]/.test(value)) throw new Error(`${name} : une seule ligne attendue`);
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`${name} : ${MIN_PASSWORD_LENGTH} caractères au moins attendus`);
  }
  return value;
}

/** Lit et valide la configuration du job ; aucune valeur secrète dans les messages. */
export function deployConfig(env: Readonly<Record<string, string | undefined>>): DeployConfig {
  const environment = env['RUEDA_ENV'];
  if (!DEPLOY_ENVIRONMENTS.includes(environment as DeployEnvironment)) {
    throw new Error(
      `RUEDA_ENV doit valoir preproduction ou production (reçu : ${environment === undefined ? 'absente' : JSON.stringify(environment)})`,
    );
  }
  const host = env['PGHOST'] ?? '';
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) throw new Error('PGHOST absente ou invalide');
  const port = Number(env['PGPORT'] ?? '5432');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PGPORT invalide');
  const database = env['PGDATABASE'] ?? '';
  if (!IDENTIFIER.test(database) || database.startsWith('rueda_test_')) {
    throw new Error('PGDATABASE absente ou invalide (les bases rueda_test_* sont celles du banc)');
  }
  const adminUser = env['RUEDA_DB_ADMIN_USER'] ?? '';
  if (!IDENTIFIER.test(adminUser) || (LOGIN_ROLES as readonly string[]).includes(adminUser)) {
    throw new Error('RUEDA_DB_ADMIN_USER absente ou invalide (jamais un rôle applicatif)');
  }
  return {
    environment: environment as DeployEnvironment,
    host,
    port,
    database,
    adminUser,
    adminPassword: secret(env, 'RUEDA_DB_ADMIN_PASSWORD'),
    passwords: Object.fromEntries(
      LOGIN_ROLES.map((role) => [role, secret(env, PASSWORD_VARIABLES[role])]),
    ) as Record<LoginRole, string>,
  };
}

async function connect(config: DeployConfig, user: string, password: string): Promise<pg.Client> {
  // TLS : PGSSLMODE (lu par le pilote) ; certificats de l'hébergeur par NODE_EXTRA_CA_CERTS.
  const client = new pg.Client({
    host: config.host,
    port: config.port,
    user,
    password,
    database: config.database,
    application_name: 'rueda-deploy',
  });
  await client.connect();
  return client;
}

export interface DeployReport {
  readonly environment: DeployEnvironment;
  readonly migrationsApplied: readonly string[];
}

/** Amorçage, migrations, déclaration puis vérification (voir l'en-tête). */
export async function deployDatabase(
  config: DeployConfig,
  log: (line: string) => void,
): Promise<DeployReport> {
  const admin = await connect(config, config.adminUser, config.adminPassword);
  try {
    await runBootstrap(admin);
    await setRolePasswords(admin, config.passwords);
    log('amorçage rejoué, mots de passe des rôles de connexion posés');
  } finally {
    await admin.end();
  }

  const migrator = await connect(config, MIGRATOR_ROLE, config.passwords.migrator);
  let applied: string[];
  try {
    applied = (await runMigrations(migrator, [MIGRATIONS_DIR], { log })).map(
      (m) => `${m.version}_${m.name}`,
    );
    log(`${applied.length} migration(s) de production appliquée(s) sous ${MIGRATOR_ROLE}`);
    await migrator.query('SELECT platform.declare_environment($1)', [config.environment]);
    log(`base déclarée « ${config.environment} »`);
  } finally {
    await migrator.end();
  }

  const api = await connect(config, 'app_api', config.passwords.app_api);
  try {
    const who = await api.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      env: string;
      fakes: number;
    }>(
      `SELECT current_user, r.rolsuper, r.rolbypassrls, platform.deployment_env() AS env,
              (SELECT g.fake_accounts FROM core.payment_startup_guard() AS g) AS fakes
         FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`,
    );
    const me = who.rows[0];
    if (me === undefined || me.current_user !== 'app_api' || me.rolsuper || me.rolbypassrls) {
      throw new Error('app_api : rôle de production attendu, sans SUPERUSER ni BYPASSRLS');
    }
    if (me.env !== config.environment) {
      throw new Error(`base « ${me.env} » alors que « ${config.environment} » est visé`);
    }
    if (Number(me.fakes) !== 0) {
      throw new Error(`${me.fakes} compte(s) PSP FAKE en base : refusé (C19)`);
    }
    // US-049 (F-RLS-04) : sonde du catalogue, fail-closed
    const exposed = await api.query<{ sig: string; role: string }>(SIDE_EFFECT_PROBE_SQL, [
      [...SIDE_EFFECT_FUNCTIONS],
      [...PROBED_ROLES],
    ]);
    if (exposed.rows.length > 0) {
      throw new Error(
        `fonctions de pg_catalog exécutables par un rôle applicatif : ${exposed.rows
          .map((r) => `${r.sig} (${r.role})`)
          .join(', ')} ; REVOKE EXECUTE … FROM PUBLIC requis (amorçage § 3)`,
      );
    }
    log(`vérifié sous app_api : base « ${me.env} », aucun compte PSP FAKE`);
    log('vérifié sous app_api : aucune fonction de pg_catalog à effet de bord exécutable');
  } finally {
    await api.end();
  }
  return { environment: config.environment, migrationsApplied: applied };
}

export async function main(env: Readonly<Record<string, string | undefined>>): Promise<void> {
  const log = (line: string): void => {
    console.log(`[deploy-db] ${line}`);
  };
  let config: DeployConfig;
  try {
    config = deployConfig(env);
  } catch (error) {
    // la configuration n'a pas encore de secret validé : on expurge tout ce qui ressemble à l'un
    const candidates = [
      env['RUEDA_DB_ADMIN_PASSWORD'],
      ...Object.values(PASSWORD_VARIABLES).map((v) => env[v]),
    ].filter((v): v is string => typeof v === 'string' && v !== '');
    throw redactError(error, candidates);
  }
  const secrets = [config.adminPassword, ...Object.values(config.passwords)];
  try {
    const report = await deployDatabase(config, log);
    log(`base prête (${report.environment})`);
  } catch (error) {
    throw redactError(error, secrets);
  }
}
