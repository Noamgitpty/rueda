/**
 * Parcours du lint des styles : **tout** `apps/` et `packages/` (composants, tests, configuration,
 * fichiers statiques), à l'exception :
 *
 * - des dossiers de dépendances et de sortie de construction (`node_modules` partout ; `.next`,
 *   `.turbo`, `dist`, `coverage`, `out` seulement à la racine d'une application ou d'un paquet,
 *   pour qu'un `app/out/` ou `app/public/` imbriqué reste analysé) ;
 * - des fichiers du paquet de jetons listés dans `EXEMPT_PATHS`, seule exemption, explicite.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { scanReducedMotion } from './motion.ts';
import { scanStyleSource } from './scan.ts';
import type { SourceKind, StyleFinding } from './scan.ts';

export const LINT_ROOTS: readonly string[] = ['apps', 'packages'];

/**
 * Seule exemption : le paquet de jetons lui-même, qui définit les valeurs (et les décrit dans ses
 * règles et ses tests). Chaque entrée porte sa raison ; en ajouter une demande une revue design.
 */
export const EXEMPT_PATHS: Readonly<Record<string, string>> = {
  'packages/design-tokens/src/':
    'compilateur des jetons : écrit les valeurs des palettes et les règles de base (0s, !important)',
  'packages/design-tokens/lint/': 'règles du lint : décrivent les valeurs interdites',
  'packages/design-tokens/test/':
    'tests des jetons et du lint : couleurs attendues et exemples fautifs',
};

/** Dossiers de dépendances, ignorés à toute profondeur. */
const DEPENDENCY_DIRS = new Set(['node_modules', '.git']);
/** Sorties de construction, ignorées seulement à la racine d'une application ou d'un paquet. */
const BUILD_OUTPUT_DIRS = new Set(['.next', '.turbo', 'dist', 'coverage', 'out']);

const EXTENSIONS: Readonly<Record<string, SourceKind>> = {
  '.css': 'css',
  '.scss': 'css',
  '.sass': 'css',
  '.less': 'css',
  '.ts': 'ts',
  '.tsx': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.js': 'ts',
  '.jsx': 'ts',
  '.mjs': 'ts',
  '.cjs': 'ts',
  '.html': 'markup',
  '.htm': 'markup',
  '.svg': 'markup',
};

export interface FileStyleFinding extends StyleFinding {
  /** Chemin relatif à la racine du dépôt, séparateurs `/`. */
  readonly file: string;
}

export interface StyleLintResult {
  readonly filesScanned: number;
  readonly findings: readonly FileStyleFinding[];
}

const toPosix = (p: string): string => p.split(sep).join('/');
const isExempt = (file: string): boolean =>
  Object.keys(EXEMPT_PATHS).some((p) => file.startsWith(p));
const kindOf = (name: string): SourceKind | undefined => {
  const ext = Object.keys(EXTENSIONS).find((e) => name.toLowerCase().endsWith(e));
  return ext === undefined || name.endsWith('.d.ts') ? undefined : EXTENSIONS[ext];
};

export function lintStyleTree(
  repoRoot: string,
  roots: readonly string[] = LINT_ROOTS,
): StyleLintResult {
  const findings: FileStyleFinding[] = [];
  let filesScanned = 0;
  /** `depth` : 0 = racine parcourue (apps), 1 = une application ou un paquet, 2+ = dedans. */
  const walk = (dir: string, depth: number): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const file = toPosix(relative(repoRoot, path));
      if (entry.isDirectory()) {
        if (DEPENDENCY_DIRS.has(entry.name)) continue;
        if (depth === 1 && BUILD_OUTPUT_DIRS.has(entry.name)) continue;
        if (isExempt(`${file}/`)) continue;
        walk(path, depth + 1);
        continue;
      }
      const kind = kindOf(entry.name);
      if (!kind || isExempt(file)) continue;
      filesScanned += 1;
      const source = readFileSync(path, 'utf8');
      for (const f of scanStyleSource(source, kind)) findings.push({ ...f, file });
      // US-031 : toute animation s'arrête avec prefers-reduced-motion (10b UX-69).
      for (const f of scanReducedMotion(source, kind)) findings.push({ ...f, file });
    }
  };
  for (const root of roots) {
    const abs = join(repoRoot, root);
    if (existsSync(abs)) walk(abs, 0);
  }
  return { filesScanned, findings };
}
