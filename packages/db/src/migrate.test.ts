import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checksumOf, listMigrations, planMigrations } from './migrate.ts';
import type { MigrationFile } from './migrate.ts';
import { MIGRATIONS_DIR, TEST_MIGRATIONS_DIR } from './paths.ts';

const file = (version: string, name: string, sql = `-- ${name}`): MigrationFile => ({
  version,
  name,
  path: `${version}_${name}.sql`,
  sql,
  checksum: checksumOf(sql),
});

describe('planMigrations', () => {
  const a = file('0000', 'a');
  const b = file('0001', 'b');
  const c = file('0002', 'c');

  it('renvoie les migrations non appliquées, dans l’ordre', () => {
    expect(planMigrations([a, b, c], []).map((m) => m.version)).toEqual(['0000', '0001', '0002']);
    expect(planMigrations([a, b, c], [a, b]).map((m) => m.version)).toEqual(['0002']);
    expect(planMigrations([a, b], [a, b])).toEqual([]);
  });

  it('refuse une migration appliquée modifiée', () => {
    expect(() => planMigrations([a, file('0001', 'b', '-- changé')], [a, b])).toThrow(/modifiée/);
  });

  it('refuse une migration appliquée absente des fichiers', () => {
    expect(() => planMigrations([a], [a, b])).toThrow(/absente/);
  });

  it('refuse une migration nouvelle antérieure à la dernière appliquée', () => {
    expect(() => planMigrations([a, b, c], [a, c])).toThrow(/antérieure/);
  });

  it('normalise les fins de ligne dans la somme', () => {
    expect(checksumOf('a\r\nb\r\n')).toBe(checksumOf('a\nb\n'));
  });
});

describe('fichiers de migration du dépôt', () => {
  const production = listMigrations([MIGRATIONS_DIR]);
  const withTests = listMigrations([MIGRATIONS_DIR, TEST_MIGRATIONS_DIR]);

  it('commencent par 0000_platform_now, sans numéro en double', () => {
    expect(production[0]?.name).toBe('platform_now');
    expect(production[0]?.version).toBe('0000');
    expect(new Set(withTests.map((m) => m.version)).size).toBe(withTests.length);
  });

  it('les migrations de test sont numérotées après la production (9000 et plus)', () => {
    const testOnly = withTests.filter((m) => !production.some((p) => p.version === m.version));
    expect(testOnly.length).toBeGreaterThan(0);
    for (const m of testOnly) expect(Number(m.version)).toBeGreaterThanOrEqual(9000);
  });

  it('aucune migration de production ne lit app.virtual_now (contrôle statique, L0-06)', () => {
    for (const m of production) expect(readFileSync(m.path, 'utf8')).not.toMatch(/virtual_now/);
  });
});
