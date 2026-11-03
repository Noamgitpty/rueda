import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { listMigrations, MIGRATION_FILE_PATTERN } from './migrate.ts';
import { checkMigrationNumbering } from './numbering.ts';
import { MIGRATIONS_DIR, PACKAGE_ROOT, TEST_MIGRATIONS_DIR } from './paths.ts';

const ids = (dir: string): string[] => listMigrations([dir]).map((m) => `${m.version}_${m.name}`);

/** Versions de production sur origin/main, si la référence existe (dépôt complet). */
function baseVersions(): string[] | undefined {
  try {
    const out = execFileSync(
      'git',
      ['ls-tree', '--name-only', 'origin/main', 'packages/db/migrations/'],
      { cwd: PACKAGE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out
      .split('\n')
      .map((p) => MIGRATION_FILE_PATTERN.exec(p.split('/').at(-1) ?? ''))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => `${m[1] ?? ''}_${m[2] ?? ''}`);
  } catch {
    return undefined; // clone superficiel (CI) : la règle 3 n'est pas vérifiable ici
  }
}

describe('numérotation des migrations (règle de migrations/README.md)', () => {
  it('le dépôt respecte la règle : uniques, contiguës en production, tests ≥ 9000, au-dessus de origin/main', () => {
    const base = baseVersions();
    expect(
      checkMigrationNumbering({
        production: ids(MIGRATIONS_DIR),
        test: ids(TEST_MIGRATIONS_DIR),
        ...(base !== undefined ? { base } : {}),
      }),
    ).toEqual([]);
  });

  it('refuse un doublon, un trou, une plage réservée et un numéro de test trop bas', () => {
    expect(
      checkMigrationNumbering({ production: ['0000_a', '0001_b', '0001_c'], test: [] }),
    ).toEqual(['production : numéro 0001 en double']);
    expect(
      checkMigrationNumbering({ production: ['0000_a', '0001_b', '0100_c'], test: [] }),
    ).toEqual([
      'production : numéros non contigus (attendu 0002, trouvé 0100) ; renuméroter à la suite de origin/main',
    ]);
    expect(checkMigrationNumbering({ production: ['0000_a'], test: ['0000_t', '9000_u'] })).toEqual(
      ['numéro 0000 à la fois en production et en test', 'test : 0000 < 9000'],
    );
  });

  it('refuse une migration nouvelle numérotée sous le maximum de origin/main', () => {
    expect(
      checkMigrationNumbering({
        production: ['0000_a', '0001_mine', '0002_b'],
        test: [],
        base: ['0000_a', '0001_other', '0002_b'],
      }),
    ).toEqual([
      'migration 0001_mine absente de la base mais ≤ 0002 (dernière de origin/main) : mettre à jour la branche et renuméroter',
    ]);
    expect(
      checkMigrationNumbering({
        production: ['0000_a', '0001_b', '0002_mine'],
        test: [],
        base: ['0000_a', '0001_b'],
      }),
    ).toEqual([]);
  });
});
