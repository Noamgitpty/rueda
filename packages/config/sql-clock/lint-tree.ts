import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ALLOWLISTABLE_TOKENS, CLOCK_TOKENS, scanSql } from './scan.ts';
import type { ClockToken, SqlClockFinding } from './scan.ts';

/** Entrée de liste blanche : chemin relatif à la racine, jetons tolérés, justification. */
export interface AllowlistEntry {
  readonly path: string;
  readonly allow: readonly ClockToken[];
  readonly justification: string;
}

export interface FileFinding extends SqlClockFinding {
  /** Chemin relatif à la racine, séparateurs `/`. */
  readonly file: string;
}

export interface LintTreeResult {
  readonly filesScanned: number;
  readonly findings: readonly FileFinding[];
  readonly allowlistErrors: readonly string[];
}

/** Répertoires jamais parcourus. */
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  '.next',
  'dist',
  'coverage',
  'out',
]);
/** Chemins (relatifs à la racine) exclus : fixtures volontairement fautives des tests de lint. */
const SKIPPED_PATHS = ['packages/config/test/fixtures'];

export const DEFAULT_ALLOWLIST_PATH = 'packages/db/sql-clock-allowlist.json';

const toPosix = (p: string): string => p.split(sep).join('/');

/** Lit et valide la liste blanche ; toute entrée invalide est une erreur de lint. */
export function loadAllowlist(file: string): { entries: AllowlistEntry[]; errors: string[] } {
  if (!existsSync(file)) return { entries: [], errors: [] };
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { entries: [], errors: [`liste blanche illisible (${String(error)})`] };
  }
  const list = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(list))
    return { entries: [], errors: ['liste blanche : champ "entries" absent'] };
  const entries: AllowlistEntry[] = [];
  for (const [index, item] of list.entries()) {
    const entry = item as Partial<AllowlistEntry>;
    const where = `liste blanche, entrée ${index}`;
    if (typeof entry.path !== 'string' || entry.path.length === 0) {
      errors.push(`${where} : "path" manquant`);
      continue;
    }
    if (typeof entry.justification !== 'string' || entry.justification.trim().length < 20) {
      errors.push(`${where} (${entry.path}) : "justification" manquante ou trop courte`);
      continue;
    }
    const allow = Array.isArray(entry.allow) ? entry.allow : [];
    const invalid = allow.filter(
      (t) => !CLOCK_TOKENS.includes(t) || !ALLOWLISTABLE_TOKENS.includes(t),
    );
    if (allow.length === 0 || invalid.length > 0) {
      errors.push(
        `${where} (${entry.path}) : seuls ${ALLOWLISTABLE_TOKENS.join(', ')} peuvent être tolérés` +
          (invalid.length > 0 ? ` (refusé : ${invalid.join(', ')})` : ''),
      );
      continue;
    }
    entries.push({ path: toPosix(entry.path), allow, justification: entry.justification });
  }
  return { entries, errors };
}

function collectSqlFiles(root: string, dir: string, out: string[]): void {
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, dirent.name);
    const rel = toPosix(relative(root, full));
    if (dirent.isDirectory()) {
      if (SKIPPED_DIRS.has(dirent.name)) continue;
      if (SKIPPED_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      collectSqlFiles(root, full, out);
    } else if (dirent.isFile() && dirent.name.toLowerCase().endsWith('.sql')) {
      out.push(full);
    }
  }
}

/** Analyse tous les fichiers `.sql` sous `root`. */
export function lintSqlTree(root: string, allowlistFile?: string): LintTreeResult {
  const { entries, errors } = loadAllowlist(allowlistFile ?? join(root, DEFAULT_ALLOWLIST_PATH));
  const allowByPath = new Map(entries.map((e) => [e.path, e.allow]));
  const files: string[] = [];
  collectSqlFiles(root, root, files);
  files.sort();
  const findings: FileFinding[] = [];
  for (const full of files) {
    const rel = toPosix(relative(root, full));
    const allow = allowByPath.get(rel) ?? [];
    for (const finding of scanSql(readFileSync(full, 'utf8'), { allow })) {
      findings.push({ ...finding, file: rel });
    }
  }
  return { filesScanned: files.length, findings, allowlistErrors: errors };
}
