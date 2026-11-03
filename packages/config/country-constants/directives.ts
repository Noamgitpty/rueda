/**
 * Refus des commentaires ESLint qui couperaient `rueda/no-country-constants` (revue code US-013) :
 * `eslint-disable` sans liste de règles, ou toute directive qui nomme la règle. Contrôle hors
 * ESLint (une directive ne peut donc pas le désactiver), dans `pnpm lint`. Exceptions : globs de
 * `exemptions.json` (« directives », vide aujourd'hui).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, matchesGlob, relative, sep } from 'node:path';
import { isCountryRuleDirective } from './tokens.ts';

const SOURCE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  '.next',
  'dist',
  'coverage',
  '.claude',
]);
/** L'outil lui-même et les fixtures volontairement fautives des tests de lint. */
const SKIPPED_PATHS = ['packages/config/country-constants', 'packages/config/test/fixtures'];
export const DIRECTIVE_ROOTS = ['apps', 'packages', 'scripts'];

export interface DirectiveFinding {
  readonly file: string;
  readonly line: number;
  readonly comment: string;
}

const toPosix = (p: string): string => p.split(sep).join('/');

/** Commentaires `//` et `/* … *\/` d'un source (approximation lexicale, chaînes ignorées). */
export function findCountryDirectives(source: string): Array<{ line: number; comment: string }> {
  const out: Array<{ line: number; comment: string }> = [];
  // Chaînes (sautées), puis commentaires de ligne et de bloc. BS = barre oblique inverse.
  const BS = String.fromCharCode(92);
  const str = (q: string): string => `${q}(?:${BS}${BS}.|[^${q}${BS}${BS}${BS}n])*${q}`;
  const re = new RegExp(
    `${str("'")}|${str('"')}|\`(?:${BS}${BS}.|[^\`${BS}${BS}])*\`|//([^${BS}n]*)|/${BS}*([${BS}s${BS}S]*?)${BS}*/`,
    'g',
  );
  for (const m of source.matchAll(re)) {
    const text = m[1] ?? m[2];
    if (text !== undefined && isCountryRuleDirective(text)) {
      out.push({ line: source.slice(0, m.index).split('\n').length, comment: text.trim() });
    }
  }
  return out;
}

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = toPosix(relative(root, full));
    if (SKIPPED_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walk(root, full, out);
    } else if (SOURCE.test(entry.name)) {
      out.push(rel);
    }
  }
}

export function lintCountryDirectives(
  root: string,
  allowedGlobs: readonly string[],
): { filesScanned: number; findings: DirectiveFinding[] } {
  const files: string[] = [];
  for (const r of DIRECTIVE_ROOTS) if (existsSync(join(root, r))) walk(root, join(root, r), files);
  for (const f of readdirSync(root)) if (SOURCE.test(f)) files.push(f);
  const findings: DirectiveFinding[] = [];
  for (const file of files) {
    if (allowedGlobs.some((g) => matchesGlob(file, g))) continue;
    for (const f of findCountryDirectives(readFileSync(join(root, file), 'utf8'))) {
      findings.push({ file, ...f });
    }
  }
  return { filesScanned: files.length, findings };
}
