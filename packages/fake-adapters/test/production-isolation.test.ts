/**
 * Critère 2 d'US-020 : « l'image de production, quand elle est construite, ne contient aucun
 * FAKE » (C19 ; 17 §6.5 point 2, §10). L'image n'embarque que les dépendances de production des
 * applications (`pnpm deploy --prod`) et leurs fichiers compilés hors `testing/` et hors tests.
 * Défense en profondeur, sur tout l'espace de travail (durcie après la revue sécurité US-020,
 * constat 2) :
 *
 * 1. `@rueda/fake-adapters` est privé et **feuille** ;
 * 2. aucun `package.json` ne le déclare ailleurs qu'en `devDependencies` ;
 * 3. aucun fichier de production — **tout** fichier source d'un paquet, `src/` ou non, hors
 *    tests, dossiers de test, dossiers `testing/` et configurations d'outillage à la racine du
 *    paquet — ne contient, hors commentaires (analyse qui respecte les chaînes) :
 *    - la chaîne `fake-adapters` (import nommé ou relatif, chaîne concaténée qui la contient) ;
 *    - le nom d'un FAKE de ce paquet ;
 *    - un chemin vers un dossier `testing/` (les FAKE y sont permis, donc on n'y entre pas) ;
 *    - un `import()` ou un `require()` dont l'argument n'est pas une chaîne littérale unique ;
 * 4. un paquet dont un fichier `testing/` touche aux FAKE n'est la dépendance de production de
 *    personne, et `apps/api` exclut `testing/` de sa compilation.
 *
 * Limites de l'analyse statique (documentées, ADR-058) : un nom de module fabriqué à l'exécution
 * sans `import()` / `require()` littéral (lecture d'un fichier ou d'une variable d'environnement
 * puis `module.createRequire`, `vm`, `eval` d'une chaîne codée), ou du code FAKE recopié sous un
 * autre nom, échappent à ce test. Le contrôle restant est la revue de code et, surtout, l'absence
 * du paquet dans l'image : `devDependencies` seulement, donc toute résolution y échoue.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as everything from '../src/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');

interface PackageJson {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function workspacePackages(): string[] {
  return ['apps', 'packages'].flatMap((group) =>
    readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(ROOT, group, e.name, 'package.json')))
      .map((e) => join(ROOT, group, e.name)),
  );
}

const readPkg = (dir: string): PackageJson =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson;

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'out']);
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'e2e', 'fixtures']);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIPPED_DIRS.has(e.name)) return [];
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(e.name) ? [path] : [];
  });
}

type Kind = 'production' | 'test' | 'testing' | 'tooling';

/** Nature d'un fichier, relativement à la racine de son paquet. */
export function classify(relToPackage: string): Kind {
  const parts = relToPackage.replace(/\\/g, '/').split('/');
  const name = parts[parts.length - 1] ?? '';
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name) || name.endsWith('.test-support.ts')) return 'test';
  if (parts.slice(0, -1).some((p) => TEST_DIRS.has(p))) return 'test';
  if (parts.slice(0, -1).includes('testing')) return 'testing';
  // Outillage à la racine du paquet (jamais embarqué) : vitest*, *.config.*, next-env.d.ts.
  if (parts.length === 1 && /^(vitest[\w.-]*|[\w-]+\.config|next-env\.d)\.[cm]?[jt]s$/.test(name)) {
    return 'tooling';
  }
  return 'production';
}

/** Retire les commentaires en respectant les chaînes et gabarits (pas d'effacement de ligne). */
export function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? '';
    const next = text[i + 1] ?? '';
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Noms exportés par ce paquet qui désignent un FAKE (classes et fabriques). */
const FAKE_NAMES = Object.keys(everything).filter((n) => /^(Fake|InMemory)/.test(n));

/** Motifs interdits dans un fichier de production (texte sans commentaires). */
export function violations(code: string): string[] {
  const found: string[] = [];
  if (/fake-adapters/i.test(code)) found.push('fake-adapters');
  const named = new RegExp(`\\b(${FAKE_NAMES.join('|')})\\b`).exec(code);
  if (named !== null) found.push(named[0]);
  if (/['"`][^'"`\n]*\/testing(?:\/[^'"`\n]*)?['"`]/.test(code)) found.push('chemin testing/');
  // import() / require() sans chaîne littérale unique comme argument.
  if (/\b(?:import|require)\s*\(\s*(?!(['"])[^'"`\n]*\1\s*[,)])/.test(code)) {
    found.push('import dynamique non littéral');
  }
  return found;
}

describe('aucun FAKE dans l’image de production (C19)', () => {
  it('@rueda/fake-adapters est privé et feuille', () => {
    const pkg = readPkg(PACKAGE_DIR);
    expect(pkg.private).toBe(true);
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
    expect(Object.keys(pkg.devDependencies ?? {}).filter((d) => d.startsWith('@rueda/'))).toEqual([
      '@rueda/config',
    ]);
  });

  it('aucun paquet ne le déclare hors devDependencies', () => {
    const offenders = workspacePackages()
      .map((dir) => ({ dir, pkg: readPkg(dir) }))
      .filter(({ pkg }) =>
        [pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some(
          (deps) => deps !== undefined && '@rueda/fake-adapters' in deps,
        ),
      )
      .map(({ dir }) => relative(ROOT, dir));
    expect(offenders).toEqual([]);
  });

  it('aucun fichier de production (src/ ou ailleurs) ne l’importe, ne nomme un FAKE ni n’entre dans testing/', () => {
    expect(FAKE_NAMES.length).toBeGreaterThanOrEqual(7);
    const offenders = workspacePackages()
      .filter((dir) => dir !== PACKAGE_DIR)
      .flatMap((dir) =>
        sources(dir)
          .filter((file) => classify(relative(dir, file)) === 'production')
          .map((file) => ({ file, found: violations(stripComments(readFileSync(file, 'utf8'))) })),
      )
      .filter(({ found }) => found.length > 0)
      .map(
        ({ file, found }) => `${relative(ROOT, file).replace(/\\/g, '/')} : ${found.join(', ')}`,
      );
    expect(offenders).toEqual([]);
  });

  it('un paquet dont testing/ touche aux FAKE n’est la dépendance de production de personne', () => {
    const packages = workspacePackages().map((dir) => ({ dir, pkg: readPkg(dir) }));
    const bearers = packages
      .filter(({ dir }) => dir !== PACKAGE_DIR)
      .filter(({ dir }) =>
        sources(dir).some(
          (file) =>
            classify(relative(dir, file)) === 'testing' &&
            /fake-adapters/.test(stripComments(readFileSync(file, 'utf8'))),
        ),
      )
      .map(({ pkg }) => pkg.name ?? '');
    expect(bearers).toContain('@rueda/db');
    const offenders = packages.flatMap(({ dir, pkg }) =>
      bearers
        .filter((name) => name in (pkg.dependencies ?? {}))
        .map((name) => `${relative(ROOT, dir)} → ${name}`),
    );
    expect(offenders).toEqual([]);
    const build = JSON.parse(readFileSync(join(ROOT, 'apps/api/tsconfig.build.json'), 'utf8')) as {
      exclude: string[];
    };
    expect(build.exclude).toEqual(expect.arrayContaining(['src/**/testing/**']));
  });
});

describe('détecteur : contournements de la revue sécurité US-020 (constat 2)', () => {
  const detect = (source: string): string[] => violations(stripComments(source));

  it.each([
    [
      'import précédé d’un commentaire sur la même ligne',
      "/* x */ import { FakeMapTiles } from '@rueda/fake-adapters';",
    ],
    ['import() à chaîne concaténée', "const m = await import('@rueda/' + 'fake-adapters');"],
    ['import() à argument variable', 'const m = await import(name);'],
    ['require() à gabarit', 'const m = require(`@rueda/${x}`);'],
    [
      'chemin relatif vers le paquet',
      "import * as f from '../../../../packages/fake-adapters/src/index.ts';",
    ],
    ['entrée dans un dossier testing/', "import { x } from '../iam/testing/fake-auth-store.js';"],
    ['export testing d’un paquet', "import { FakeKeyWrapper } from '@rueda/db/testing';"],
    ['nom de FAKE seul', 'const a = new InMemoryFileStore();'],
  ])('%s : détecté', (_name, source) => {
    expect(detect(source)).not.toEqual([]);
  });

  it.each([
    ['commentaire qui cite le paquet', '// voir @rueda/fake-adapters\nexport const a = 1;'],
    ['bloc de commentaire', '/** FakeUploadScanner : tests seulement */\nexport const a = 1;'],
    ['import littéral ordinaire', "const m = await import('./locale.js');"],
    ['URL dans une chaîne', "const u = 'https://example.invalid/x'; export { u };"],
  ])('%s : accepté', (_name, source) => {
    expect(detect(source)).toEqual([]);
  });

  it('classement des fichiers : src/ et lib/ sont de la production ; tests, testing/ et outillage non', () => {
    expect(classify('src/a.ts')).toBe('production');
    expect(classify('lib/a.ts')).toBe('production');
    expect(classify('app/page.tsx')).toBe('production');
    expect(classify('src/a.test.ts')).toBe('test');
    expect(classify('test/l0/a.ts')).toBe('test');
    expect(classify('src/modules/iam/testing/x.ts')).toBe('testing');
    expect(classify('vitest.config.ts')).toBe('tooling');
    expect(classify('src/vitest.config.ts')).toBe('production');
  });
});
