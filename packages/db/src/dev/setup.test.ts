import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../paths.ts';
import { DEV_OVERLAY_DIR, devSetupConfig, readSecretFile, secretFileOf } from './setup.ts';

describe('base de développement locale (US-035, ADR-070)', () => {
  it('refuse tout environnement autre que development (fail-closed)', () => {
    for (const value of [undefined, '', 'production', 'preproduction', 'test', 'DEVELOPMENT']) {
      expect(() => devSetupConfig({ RUEDA_ENV: value })).toThrow(/RUEDA_ENV/);
    }
  });

  it('valeurs par défaut du compose', () => {
    expect(devSetupConfig({ RUEDA_ENV: 'development' })).toEqual({
      host: 'postgres',
      port: 5432,
      database: 'rueda_dev',
      secretsDir: '/run/rueda-secrets',
    });
  });

  it('refuse un nom de base invalide ou réservé au banc de tests (supprimé par le banc)', () => {
    for (const database of ['rueda_test_x', 'Rueda', 'a-b', 'x"; DROP', '']) {
      expect(() =>
        devSetupConfig({ RUEDA_ENV: 'development', RUEDA_DEV_DB_NAME: database }),
      ).toThrow(/RUEDA_DEV_DB_NAME/);
    }
    expect(() => devSetupConfig({ RUEDA_ENV: 'development', RUEDA_DEV_DB_PORT: '0' })).toThrow(
      /RUEDA_DEV_DB_PORT/,
    );
  });

  it('fichier de secret par rôle', () => {
    expect(
      secretFileOf('/run/rueda-secrets', 'app_api').replaceAll(String.fromCharCode(92), '/'),
    ).toBe('/run/rueda-secrets/app_api/password');
  });

  it('la surcouche ne touche qu’à platform.deployment_env(), hors des migrations de production', () => {
    const files = readdirSync(DEV_OVERLAY_DIR).filter((f) => f.endsWith('.sql'));
    expect(files).toEqual(['0000_dev_deployment_env.sql']);
    const sql = readFileSync(join(DEV_OVERLAY_DIR, files[0] ?? ''), 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\$fn\$[\s\S]*?\$fn\$/g, '');
    const statements = sql
      .split(';')
      .map((s) => s.trim().split(/\s+/).slice(0, 4).join(' '))
      .filter((s) => s !== '');
    expect(statements).toEqual([
      'CREATE OR REPLACE FUNCTION',
      'COMMENT ON FUNCTION platform.deployment_env()',
    ]);
    expect(readdirSync(MIGRATIONS_DIR)).not.toContain(files[0]);
  });

  it('fichier de secret : une ligne, fin de ligne retirée, contenu jamais dans l’erreur', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rueda-dev-'));
    try {
      const file = join(dir, 'password');
      writeFileSync(file, 'abc123\n');
      expect(readSecretFile(file)).toBe('abc123');
      writeFileSync(file, 'ligne1\nligne2\n');
      expect(() => readSecretFile(file)).toThrow(/une seule ligne/);
      try {
        readSecretFile(file);
      } catch (error) {
        expect(String(error)).not.toContain('ligne1');
      }
      writeFileSync(file, '');
      expect(() => readSecretFile(file)).toThrow(/une seule ligne/);
      expect(() => readSecretFile(join(dir, 'absent'))).toThrow(/illisible \(ENOENT\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
