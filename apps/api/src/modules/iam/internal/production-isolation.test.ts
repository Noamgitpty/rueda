/**
 * « Aucun FAKE actif en production » (CLAUDE.md point 2, consigne US-010 : inconnu = non) :
 * - le répertoire testing/ (FakeAuthStore, RecordingIdentityNotifier) est exclu de la
 *   compilation de production ;
 * - aucun fichier de production de apps/api n'importe un module testing/ ;
 * - les adaptateurs de production n'ont aucune option qui accepte un autre magasin.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

const isProduction = (file: string) => {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  return !rel.endsWith('.test.ts') && !rel.split('/').includes('testing');
};

describe('isolement des FAKE IAM', () => {
  it('tsconfig.build.json exclut les tests et les répertoires testing/', () => {
    const build = JSON.parse(readFileSync(join(API_ROOT, 'tsconfig.build.json'), 'utf8')) as {
      exclude: string[];
    };
    expect(build.exclude).toEqual(
      expect.arrayContaining(['src/**/*.test.ts', 'src/**/testing/**']),
    );
  });

  it('aucun fichier de production n’importe testing/ ni ne mentionne un FAKE', () => {
    const offenders = sources(SRC)
      .filter(isProduction)
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return (
          /from\s+['"][^'"]*\/testing\//.test(text) ||
          /\bFakeAuthStore\b|\bRecordingIdentityNotifier\b/.test(
            text.replace(/^\s*(\*|\/\/).*$/gm, ''),
          )
        );
      })
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('main.ts monte les adaptateurs PostgreSQL de production', () => {
    const main = readFileSync(join(SRC, 'main.ts'), 'utf8');
    // US-104 : OTP du téléphone sur le même pool, plafonds d'AbuseGuard (risk.guard)
    expect(main).toContain('postgresIamAdapters(pool, process.env, risk.guard)');
    expect(main).not.toMatch(/process\.env\[['"]RUEDA_AUTH/);
  });
});
