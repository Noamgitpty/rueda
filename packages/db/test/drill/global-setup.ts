/**
 * `globalSetup` de l'EXERCICE DE RESTAURATION (US-051, ADR-082 ; `pnpm --filter @rueda/db
 * test:drill`, lancé par scripts/ops/restore-drill.sh qui crée l'instance source).
 *
 * Prépare la base `rueda` de l'instance source comme une PRÉPRODUCTION : job de base de production
 * (`deployDatabase` : amorçage, mots de passe tirés au hasard, migrations, déclaration
 * « preproduction », vérification sous app_api), puis les fixtures de test (test-migrations, sous
 * migrator) qui tiennent lieu des commandes pas encore construites pour peupler des données
 * fictives PA et PY. Crée aussi la base `drill_meta` (battement de cœur de l'exercice, mesure du
 * RPO). Les mots de passe sont écrits dans RUEDA_DRILL_WORK/secrets/<rôle> (0600, jamais affichés)
 * pour les étapes du runbook, et fournis aux tests comme un banc (`ruedaBench`).
 *
 * Variables (posées par restore-drill.sh) : RUEDA_DRILL_WORK, RUEDA_DRILL_PG_PORT.
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { deployDatabase } from '../../src/deploy/setup.ts';
import { runMigrations } from '../../src/migrate.ts';
import { MIGRATIONS_DIR, TEST_MIGRATIONS_DIR } from '../../src/paths.ts';
import { LOGIN_ROLES, MIGRATOR_ROLE } from '../../src/roles.ts';
import type { LoginRole } from '../../src/roles.ts';
import { randomPassword } from '../../src/scram.ts';
import { redactError } from '../../src/secrets.ts';
import type { BenchInfo } from '../../src/testing/bench.ts';

export const DRILL_DATABASE = 'rueda';
export const DRILL_META_DATABASE = 'drill_meta';

const log = (line: string): void => {
  console.log(`[exercice] ${line}`);
};

function env(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`${name} absente : lancer l'exercice par scripts/ops/restore-drill.sh`);
  }
  return v;
}

export default async function setup(project: TestProject): Promise<void> {
  const work = env('RUEDA_DRILL_WORK');
  const port = Number(env('RUEDA_DRILL_PG_PORT'));
  const adminPassword = readFileSync(join(work, 'secrets', 'postgres'), 'utf8').trim();
  const passwords = Object.fromEntries(LOGIN_ROLES.map((r) => [r, randomPassword()])) as Record<
    LoginRole,
    string
  >;
  const secrets = [adminPassword, ...Object.values(passwords)];
  for (const [role, value] of Object.entries(passwords)) {
    const file = join(work, 'secrets', role);
    writeFileSync(file, value, { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  const host = '127.0.0.1';
  try {
    await deployDatabase(
      {
        environment: 'preproduction',
        host,
        port,
        database: DRILL_DATABASE,
        adminUser: 'postgres',
        adminPassword,
        passwords,
      },
      log,
    );
    const migrator = new pg.Client({
      host,
      port,
      database: DRILL_DATABASE,
      user: MIGRATOR_ROLE,
      password: passwords.migrator,
    });
    await migrator.connect();
    try {
      const applied = await runMigrations(migrator, [MIGRATIONS_DIR, TEST_MIGRATIONS_DIR]);
      log(`${applied.length} fixture(s) de données fictives appliquée(s) sous ${MIGRATOR_ROLE}`);
    } finally {
      await migrator.end();
    }
    const admin = new pg.Client({
      host,
      port,
      database: 'postgres',
      user: 'postgres',
      password: adminPassword,
    });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${DRILL_META_DATABASE}`);
    } finally {
      await admin.end();
    }
    const meta = new pg.Client({
      host,
      port,
      database: DRILL_META_DATABASE,
      user: 'postgres',
      password: adminPassword,
    });
    await meta.connect();
    try {
      await meta.query(
        // instant d'écriture fourni par l'exercice (horloge de l'hôte, celle des conteneurs)
        'CREATE TABLE heartbeat (id bigserial PRIMARY KEY, at timestamptz NOT NULL)',
      );
    } finally {
      await meta.end();
    }
  } catch (error) {
    throw redactError(error, secrets);
  }

  const info: BenchInfo = {
    sourceKind: 'native',
    host,
    port,
    database: DRILL_DATABASE,
    productionDatabase: DRILL_DATABASE,
    injectionDatabase: DRILL_DATABASE,
    fuzzDatabase: DRILL_DATABASE,
    passwords,
    appliedMigrations: { main: [], production: [] },
    admin: { host, port, user: 'postgres', password: adminPassword, database: 'postgres' },
  };
  project.provide('ruedaBench', info);
}
