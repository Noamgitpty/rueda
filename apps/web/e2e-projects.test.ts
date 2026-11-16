/**
 * Garde-fou : aucun parcours e2e orphelin (US-041). Chaque fichier de parcours de `e2e/` doit être
 * lancé par au moins un projet de `playwright.config.ts` (`testDir`, `testMatch`, `testIgnore`), sinon
 * il ne tourne jamais en CI et la story qui le cite n'a aucune preuve d'exécution (constat du
 * 2026-11-15 : `host-calendar.spec.ts` d'US-119 et `host-trips.spec.ts` d'US-219 n'étaient lancés par
 * aucun projet). Lancé par `test:unit`, donc par le job `qualite`.
 *
 * Fail-closed : un motif que ce garde-fou ne sait pas évaluer (glob en chaîne, fonction) le fait
 * échouer au lieu d'être supposé correspondre.
 */
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from './playwright.config.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
/** Fichiers que Playwright prend pour des tests (motif par défaut de `testMatch`). */
const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;

type Pattern = unknown;
interface ProjectLike {
  readonly name?: string;
  readonly testDir?: string;
  readonly testMatch?: Pattern;
  readonly testIgnore?: Pattern;
}
interface ConfigLike {
  readonly testDir?: string;
  readonly testMatch?: Pattern;
  readonly testIgnore?: Pattern;
  readonly projects?: readonly ProjectLike[];
}

function patternsOf(pattern: Pattern): readonly RegExp[] {
  const list = Array.isArray(pattern) ? (pattern as readonly unknown[]) : [pattern];
  return list.map((p) => {
    if (p instanceof RegExp) return p;
    throw new Error(
      `motif Playwright non évalué par le garde-fou (${String(p)}) : utiliser une RegExp ou étendre e2e-projects.test.ts`,
    );
  });
}

function matches(patterns: readonly RegExp[], file: string): boolean {
  return patterns.some((re) => {
    re.lastIndex = 0;
    return re.test(file);
  });
}

function under(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep);
}

/** Projets qui lancent `file` (chemin absolu), selon les règles de sélection de Playwright. */
function projectsRunning(cfg: ConfigLike, root: string, file: string): readonly string[] {
  const projects = cfg.projects ?? [{}];
  return projects
    .filter((p) => {
      const dir = resolve(root, p.testDir ?? cfg.testDir ?? '.');
      if (!under(dir, file)) return false;
      const match = p.testMatch ?? cfg.testMatch;
      const ignore = p.testIgnore ?? cfg.testIgnore;
      const included =
        match === undefined ? TEST_FILE.test(file) : matches(patternsOf(match), file);
      const ignored = ignore === undefined ? false : matches(patternsOf(ignore), file);
      return included && !ignored;
    })
    .map((p) => p.name ?? '');
}

function testFilesUnder(dir: string): readonly string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((f) => join(dir, f))
    .filter((f) => TEST_FILE.test(f))
    .sort();
}

/** Fichiers de parcours lancés par aucun projet (chemins relatifs au dossier des tests). */
function orphansOf(
  cfg: ConfigLike,
  root: string,
  dir: string,
  files: readonly string[],
): readonly string[] {
  return files
    .filter((f) => projectsRunning(cfg, root, f).length === 0)
    .map((f) => relative(dir, f).split(sep).join('/'));
}

const E2E = resolve(ROOT, config.testDir ?? '.');
const files = testFilesUnder(E2E);

describe('parcours e2e : chacun lancé par au moins un projet Playwright', () => {
  it('le dossier des parcours est bien lu (garde-fou non vide)', () => {
    expect(E2E).toBe(resolve(ROOT, 'e2e'));
    // les parcours connus au 2026-11-15 : la liste ne peut que croître
    const names = files.map((f) => relative(E2E, f).split(sep).join('/'));
    expect(names).toEqual(
      expect.arrayContaining([
        'console.spec.ts',
        'host-calendar.spec.ts',
        'host-listings.spec.ts',
        'host-trips.spec.ts',
        'host-verification.spec.ts',
        'identity.spec.ts',
        'phone.spec.ts',
        'pwa.spec.ts',
        'screens.spec.ts',
        'shell.spec.ts',
        'signup.spec.ts',
      ]),
    );
  });

  it('aucun parcours orphelin dans playwright.config.ts', () => {
    expect(orphansOf(config, ROOT, E2E, files)).toEqual([]);
  });

  it('les parcours de l’hôte (US-119, US-219) tournent à 360 et 390 px', () => {
    for (const name of ['host-calendar.spec.ts', 'host-trips.spec.ts']) {
      expect(projectsRunning(config, ROOT, join(E2E, name))).toEqual(['mobile-360', 'mobile-390']);
    }
  });

  it('détecte un orphelin, un testIgnore et un testDir (le garde-fou n’est pas vide)', () => {
    const root = resolve(ROOT, 'fictif');
    const dir = join(root, 'e2e');
    const fake = [join(dir, 'a.spec.ts'), join(dir, 'b.spec.ts'), join(dir, 'sub', 'c.spec.ts')];
    const cfg: ConfigLike = {
      testDir: './e2e',
      projects: [
        { name: 'p1', testMatch: [/a\.spec\.ts$/, /c\.spec\.ts$/], testIgnore: /sub[\\/]/ },
        { name: 'p2', testDir: './autre' },
      ],
    };
    expect(orphansOf(cfg, root, dir, fake)).toEqual(['b.spec.ts', 'sub/c.spec.ts']);
    // sans `projects`, le projet implicite prend tout le dossier (motif par défaut)
    expect(orphansOf({ testDir: './e2e' }, root, dir, fake)).toEqual([]);
    // motif en chaîne : non évalué, donc refusé (fail-closed)
    expect(() => orphansOf({ projects: [{ testMatch: '**/*.spec.ts' }] }, root, dir, fake)).toThrow(
      /non évalué/,
    );
  });
});
