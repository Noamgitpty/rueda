/**
 * Amorçage idempotent d'une base : rôles d'instance, droits sur la base, extensions
 * (`bootstrap/*.sql`). Exécuté par un rôle d'administration, avant `runMigrations`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { BOOTSTRAP_DIR } from './paths.ts';
import { LOGIN_ROLES } from './roles.ts';
import type { LoginRole } from './roles.ts';
import { scramSha256Verifier } from './scram.ts';

/**
 * Clé du verrou consultatif de l'amorçage. Un verrou consultatif est propre à la base : entre
 * deux bases, la création concurrente d'un rôle est absorbée par le `EXCEPTION` du SQL.
 */
export const BOOTSTRAP_LOCK_KEY = 7_305_110_000;

export async function runBootstrap(
  admin: pg.ClientBase,
  dir: string = BOOTSTRAP_DIR,
): Promise<void> {
  const files = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort();
  await admin.query('SELECT pg_catalog.pg_advisory_lock($1)', [BOOTSTRAP_LOCK_KEY]);
  try {
    for (const name of files) {
      const sql = readFileSync(join(dir, name), 'utf8');
      await admin.query('BEGIN');
      try {
        await admin.query(sql);
        await admin.query('COMMIT');
      } catch (error) {
        await admin.query('ROLLBACK').catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`échec de l'amorçage ${name} : ${reason}`, { cause: error });
      }
    }
  } finally {
    await admin.query('SELECT pg_catalog.pg_advisory_unlock($1)', [BOOTSTRAP_LOCK_KEY]);
  }
}

/**
 * Pose les mots de passe des rôles de connexion. Seul le vérificateur SCRAM transite dans le
 * texte SQL, jamais le mot de passe en clair.
 */
export async function setRolePasswords(
  admin: pg.ClientBase,
  passwords: Readonly<Record<LoginRole, string>>,
): Promise<void> {
  for (const role of LOGIN_ROLES) {
    const verifier = scramSha256Verifier(passwords[role]);
    // Rôle issu d'une liste fermée ; le vérificateur ne contient que [A-Za-z0-9+/=:$-].
    if (!/^[A-Za-z0-9+/=:$-]+$/.test(verifier)) throw new Error('vérificateur SCRAM inattendu');
    await admin.query(`ALTER ROLE ${role} PASSWORD '${verifier}'`);
  }
}
