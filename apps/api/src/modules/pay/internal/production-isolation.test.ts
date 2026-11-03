/**
 * « Aucun FAKE actif en production » côté code (C19 ; 17 §6.5 point 2 ; CLAUDE.md contrainte 2) :
 * - `@rueda/fake-adapters` n'est qu'une dépendance de développement de apps/api ;
 * - aucun fichier de production de apps/api n'importe `@rueda/fake-adapters` ni un `testing/` de
 *   PAY, ni ne nomme un adaptateur FAKE de PAY ;
 * - `tsconfig.build.json` exclut `testing/` ; l'index public de PAY n'exporte aucun FAKE ;
 * - main.ts monte les adaptateurs de production (contrôle de démarrage, registre sans FAKE).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as publicIndex from '../index.js';

const API_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SRC = join(API_ROOT, 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

const isProduction = (file: string): boolean => {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  return (
    !rel.endsWith('.test.ts') &&
    !rel.endsWith('.test-support.ts') &&
    !rel.split('/').includes('testing')
  );
};

const code = (text: string): string => text.replace(/^\s*(\*|\/\/|\/\*).*$/gm, '');

describe('isolement des FAKE de PAY (C19)', () => {
  it('@rueda/fake-adapters : dépendance de développement seulement', () => {
    const pkg = JSON.parse(readFileSync(join(API_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain('@rueda/fake-adapters');
    expect(Object.keys(pkg.devDependencies ?? {})).toContain('@rueda/fake-adapters');
  });

  it('tsconfig.build.json exclut testing/ et les tests', () => {
    const build = JSON.parse(readFileSync(join(API_ROOT, 'tsconfig.build.json'), 'utf8')) as {
      exclude: string[];
    };
    expect(build.exclude).toEqual(
      expect.arrayContaining(['src/**/*.test.ts', 'src/**/testing/**']),
    );
  });

  it('aucun fichier de production n’importe @rueda/fake-adapters ni pay/testing, ni ne nomme un FAKE de PAY', () => {
    const offenders = sources(SRC)
      .filter(isProduction)
      .filter((file) => {
        const text = code(readFileSync(file, 'utf8'));
        return (
          /['"]@rueda\/fake-adapters/.test(text) ||
          /from\s+['"][^'"]*\/testing\//.test(text) ||
          /\b(FakePsp|FakePaymentProvider|MemoryPaymentStore|fakeStack)\b/.test(text)
        );
      })
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('l’index public de PAY n’exporte aucun FAKE ; le registre de production est vide', () => {
    const names = Object.keys(publicIndex);
    // seul nom admis : le détecteur des variables *_ADAPTER=FAKE du contrôle de démarrage
    expect(names.filter((n) => /fake|memory/i.test(n))).toEqual(['fakeAdapterVariables']);
    expect(names.filter((n) => /^(Fake|Memory)|Psp$/.test(n))).toEqual([]);
    expect(publicIndex.PRODUCTION_PROVIDERS).toEqual([]);
  });

  it('main.ts monte les adaptateurs PAY de production et lit le corps brut des webhooks', () => {
    const main = readFileSync(join(SRC, 'main.ts'), 'utf8');
    expect(main).toContain('postgresPayAdapters(pool, process.env)');
    expect(main).toContain('rawBody: true');
  });
});
