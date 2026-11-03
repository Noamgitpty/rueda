/**
 * Exécuteur de migrations minimal (US-005).
 *
 * - Fichiers `NNNN_<nom>.sql` (minuscules, chiffres, `_`) lus dans un ou plusieurs dossiers,
 *   appliqués dans l'ordre de `NNNN` ; un numéro ne peut exister qu'une fois.
 * - Chaque migration s'applique dans **sa propre transaction**, avec son inscription dans
 *   `platform.schema_migration` : jamais de migration à moitié appliquée.
 * - Une migration appliquée est immuable : somme SHA-256 vérifiée à chaque passage.
 * - Appliqué sous `migrator` seulement : l'exécuteur refuse un superutilisateur ou un rôle
 *   `BYPASSRLS` (les objets seraient mal possédés et la RLS forcée contournée).
 * - Un verrou consultatif sérialise deux exécuteurs concurrents sur la même base.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { MIGRATOR_ROLE } from './roles.ts';

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly path: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
}

export const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Clé du verrou consultatif de l'exécuteur (constante arbitraire, propre au projet). */
export const MIGRATION_LOCK_KEY = 7_305_110_001;

/** Somme SHA-256 du texte, fins de ligne normalisées en LF. */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/** Lit les migrations des dossiers donnés, triées par version. */
export function listMigrations(dirs: readonly string[]): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const dir of dirs) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.sql')) continue;
      const match = MIGRATION_FILE_PATTERN.exec(entry.name);
      if (!match) {
        throw new Error(`migration mal nommée : ${entry.name} (attendu NNNN_<nom>.sql)`);
      }
      const path = join(dir, entry.name);
      const sql = readFileSync(path, 'utf8');
      files.push({
        version: match[1] as string,
        name: match[2] as string,
        path,
        sql,
        checksum: checksumOf(sql),
      });
    }
  }
  files.sort((a, b) => a.version.localeCompare(b.version));
  for (let i = 1; i < files.length; i++) {
    const prev = files[i - 1] as MigrationFile;
    const cur = files[i] as MigrationFile;
    if (prev.version === cur.version) {
      throw new Error(
        `numéro de migration en double : ${prev.version} (${prev.path}, ${cur.path})`,
      );
    }
  }
  return files;
}

/**
 * Calcule les migrations à appliquer. Refuse (exception) : une migration appliquée absente
 * des fichiers, une somme modifiée, ou une migration nouvelle plus ancienne que la dernière
 * appliquée (ordre non linéaire).
 */
export function planMigrations(
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationFile[] {
  const byVersion = new Map(files.map((f) => [f.version, f]));
  const errors: string[] = [];
  for (const a of applied) {
    const file = byVersion.get(a.version);
    if (!file) {
      errors.push(`migration appliquée ${a.version}_${a.name} absente des fichiers`);
    } else if (file.checksum !== a.checksum || file.name !== a.name) {
      errors.push(`migration appliquée ${a.version}_${a.name} modifiée depuis son application`);
    }
  }
  const appliedVersions = new Set(applied.map((a) => a.version));
  const lastApplied = [...appliedVersions].sort().at(-1);
  const pending = files.filter((f) => !appliedVersions.has(f.version));
  for (const p of pending) {
    if (lastApplied !== undefined && p.version < lastApplied) {
      errors.push(
        `migration ${p.version}_${p.name} antérieure à la dernière appliquée (${lastApplied})`,
      );
    }
  }
  if (errors.length > 0) throw new Error(`migrations refusées :\n- ${errors.join('\n- ')}`);
  return pending;
}

export interface RunMigrationsOptions {
  /** Rôle attendu de la connexion (défaut : `migrator`). */
  readonly expectedRole?: string;
  readonly log?: (line: string) => void;
}

/** Applique les migrations en attente ; renvoie celles qui ont été appliquées. */
export async function runMigrations(
  client: pg.ClientBase,
  dirs: readonly string[],
  options: RunMigrationsOptions = {},
): Promise<MigrationFile[]> {
  const expectedRole = options.expectedRole ?? MIGRATOR_ROLE;
  const who = await client.query<{
    current_user: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>(
    `SELECT current_user, r.rolsuper, r.rolbypassrls
       FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`,
  );
  const me = who.rows[0];
  if (!me || me.current_user !== expectedRole || me.rolsuper || me.rolbypassrls) {
    throw new Error(
      `les migrations s'appliquent sous ${expectedRole}, sans SUPERUSER ni BYPASSRLS ` +
        `(connexion actuelle : ${me?.current_user ?? 'inconnue'})`,
    );
  }

  const files = listMigrations(dirs);
  await client.query('SELECT pg_catalog.pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    const exists = await client.query<{ present: boolean }>(
      `SELECT pg_catalog.to_regclass('platform.schema_migration') IS NOT NULL AS present`,
    );
    const applied = exists.rows[0]?.present
      ? (
          await client.query<AppliedMigration>(
            'SELECT version, name, checksum FROM platform.schema_migration ORDER BY version',
          )
        ).rows
      : [];
    const pending = planMigrations(files, applied);
    for (const migration of pending) {
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL lock_timeout = '10s'`);
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO platform.schema_migration (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `échec de la migration ${migration.version}_${migration.name} : ${reason}`,
          {
            cause: error,
          },
        );
      }
      options.log?.(`migration appliquée : ${migration.version}_${migration.name}`);
    }
    return pending;
  } finally {
    await client.query('SELECT pg_catalog.pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}
