/**
 * Version SQL du contrôle « aucune constante pays » (US-013 ; ADR-024) : les littéraux chaîne
 * des migrations ne nomment ni devise, ni fuseau, ni pays… Seules les migrations de **graines**,
 * générées depuis les données CFG et inscrites dans la liste blanche, en contiennent.
 * Les commentaires sont ignorés (masqués par `maskSql`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { maskSql } from '../sql-clock/scan.ts';
import { findCountryConstants } from './tokens.ts';

export const DEFAULT_COUNTRY_ALLOWLIST = 'packages/db/country-data-allowlist.json';
/** Dossiers de SQL analysés, relatifs à la racine. */
export const SQL_DIRS = [
  'packages/db/migrations',
  'packages/db/test-migrations',
  'packages/db/bootstrap',
];

export interface SqlCountryFinding {
  readonly file: string;
  readonly line: number;
  readonly token: string;
}

export interface SqlCountryResult {
  readonly filesScanned: number;
  readonly findings: readonly SqlCountryFinding[];
  readonly allowlistErrors: readonly string[];
}

/** Jetons trouvés dans les littéraux chaîne d'un texte SQL, avec leur ligne. */
export function scanSqlCountryConstants(
  source: string,
  tokens: readonly string[],
): Array<{ line: number; token: string }> {
  const out: Array<{ line: number; token: string }> = [];
  for (const literal of maskSql(source).strings) {
    for (const f of findCountryConstants(literal.value, tokens)) {
      out.push({ line: source.slice(0, literal.offset).split('\n').length, token: f.token });
    }
  }
  return out;
}

function loadAllowlist(root: string, file: string): { paths: Set<string>; errors: string[] } {
  const errors: string[] = [];
  const paths = new Set<string>();
  const full = join(root, file);
  if (!existsSync(full)) return { paths, errors: [`liste blanche absente : ${file}`] };
  const doc = JSON.parse(readFileSync(full, 'utf8')) as {
    entries?: Array<{ path?: unknown; justification?: unknown }>;
  };
  for (const [i, entry] of (doc.entries ?? []).entries()) {
    if (
      typeof entry.path !== 'string' ||
      typeof entry.justification !== 'string' ||
      entry.justification.trim() === ''
    ) {
      errors.push(`${file} entrée ${i} : path et justification obligatoires`);
      continue;
    }
    if (!existsSync(join(root, entry.path)))
      errors.push(`${file} : fichier inexistant ${entry.path}`);
    paths.add(entry.path);
  }
  return { paths, errors };
}

export function lintSqlCountryConstants(
  root: string,
  tokens: readonly string[],
  allowlistFile = DEFAULT_COUNTRY_ALLOWLIST,
): SqlCountryResult {
  const { paths, errors } = loadAllowlist(root, allowlistFile);
  if (tokens.length === 0) errors.push('aucun jeton pays (données CFG introuvables)');
  const findings: SqlCountryFinding[] = [];
  let filesScanned = 0;
  for (const dir of SQL_DIRS) {
    const full = join(root, dir);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      const file = `${dir}/${name}`;
      if (paths.has(file)) continue;
      filesScanned++;
      for (const f of scanSqlCountryConstants(readFileSync(join(full, name), 'utf8'), tokens)) {
        findings.push({ file, ...f });
      }
    }
  }
  return { filesScanned, findings, allowlistErrors: errors };
}
