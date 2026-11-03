/**
 * Parcours des composants à contrôler : `apps/web`, `apps/backoffice` et la future bibliothèque
 * `packages/ui` (US-032). Les tests (`*.test.*`) et les fichiers générés sont exclus.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { scanStyleSource } from './scan.ts';
import type { StyleFinding } from './scan.ts';

export const COMPONENT_ROOTS: readonly string[] = ['apps/web', 'apps/backoffice', 'packages/ui'];

const SKIPPED_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  'out',
  'public',
]);
const EXTENSIONS: Record<string, 'css' | 'ts'> = {
  '.css': 'css',
  '.scss': 'css',
  '.ts': 'ts',
  '.tsx': 'ts',
  '.mts': 'ts',
  '.js': 'ts',
  '.jsx': 'ts',
  '.mjs': 'ts',
};
const isSkippedFile = (name: string): boolean =>
  /\.test\.[cm]?[jt]sx?$/.test(name) ||
  name.endsWith('.d.ts') ||
  /\.config\.[cm]?[jt]s$/.test(name);

export interface FileStyleFinding extends StyleFinding {
  /** Chemin relatif à la racine du dépôt, séparateurs `/`. */
  readonly file: string;
}

export interface StyleLintResult {
  readonly filesScanned: number;
  readonly findings: readonly FileStyleFinding[];
}

export function lintStyleTree(
  repoRoot: string,
  roots: readonly string[] = COMPONENT_ROOTS,
): StyleLintResult {
  const findings: FileStyleFinding[] = [];
  let filesScanned = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(path);
        continue;
      }
      const ext = Object.keys(EXTENSIONS).find((e) => entry.name.endsWith(e));
      if (!ext || isSkippedFile(entry.name)) continue;
      filesScanned += 1;
      const file = relative(repoRoot, path).split(sep).join('/');
      for (const f of scanStyleSource(
        readFileSync(path, 'utf8'),
        EXTENSIONS[ext] as 'css' | 'ts',
      )) {
        findings.push({ ...f, file });
      }
    }
  };
  for (const root of roots) {
    const abs = join(repoRoot, root);
    if (existsSync(abs)) walk(abs);
  }
  return { filesScanned, findings };
}
