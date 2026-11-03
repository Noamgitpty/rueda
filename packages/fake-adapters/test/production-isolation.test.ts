/**
 * Critère 2 d'US-020 : « l'image de production, quand elle est construite, ne contient aucun
 * FAKE » (C19 ; 17 §6.5 point 2, §10). L'image n'embarque que les dépendances de production des
 * applications (`pnpm deploy --prod`) et leurs fichiers compilés hors `testing/` et hors tests.
 * Ce test le vérifie sur tout l'espace de travail :
 *
 * 1. `@rueda/fake-adapters` est privé et **feuille** (aucune dépendance de production, aucun paquet
 *    de l'espace de travail) ;
 * 2. aucun `package.json` ne le déclare ailleurs qu'en `devDependencies` ;
 * 3. aucun fichier de production (`apps/<x>/src`, `packages/<x>/src`, hors tests et `testing/`)
 *    ne l'importe ni ne nomme un FAKE de ce paquet.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as everything from '../src/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url));

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

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === 'dist') return [];
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx|mts|cts|js|mjs)$/.test(e.name) ? [path] : [];
  });
}

const isProductionSource = (file: string): boolean => {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  return (
    !/\.(test|spec)\.[cm]?tsx?$/.test(rel) &&
    !rel.endsWith('.test-support.ts') &&
    !rel.split('/').includes('testing')
  );
};

/** Noms exportés par ce paquet qui désignent un FAKE (classes et fabriques). */
const FAKE_NAMES = Object.keys(everything).filter((n) => /^(Fake|InMemory)/.test(n));

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

  it('aucun fichier de production ne l’importe ni ne nomme un de ses FAKE', () => {
    expect(FAKE_NAMES.length).toBeGreaterThanOrEqual(7);
    const named = new RegExp(`\\b(${FAKE_NAMES.join('|')})\\b`);
    const offenders = workspacePackages()
      .filter((dir) => dir !== PACKAGE_DIR.replace(/[\\/]$/, ''))
      .flatMap((dir) => sources(join(dir, 'src')).concat(sources(join(dir, 'app'))))
      .filter(isProductionSource)
      .filter((file) => {
        const text = readFileSync(file, 'utf8').replace(/^\s*(\*|\/\/|\/\*).*$/gm, '');
        return /['"]@rueda\/fake-adapters/.test(text) || named.test(text);
      })
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
