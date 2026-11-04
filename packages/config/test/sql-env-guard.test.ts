/**
 * US-043 (ADR-077) : une garde d'environnement ouverte sur NULL fait échouer `pnpm lint:sql`.
 * Seule `COALESCE(platform.deployment_env(), 'production')` est admise dans une migration ; les
 * instructions qui nomment la fonction sans l'appeler sont ignorées ; une lecture historique n'est
 * tolérée que par une entrée de liste blanche qui désigne une migration de remplacement postérieure.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lintEnvGuards } from '../sql-env-guard/lint-tree.ts';
import { scanEnvGuards } from '../sql-env-guard/scan.ts';
import { repoRoot } from './paths.ts';

const cli = join(repoRoot, 'packages', 'config', 'sql-env-guard', 'cli.ts');

describe('scanEnvGuards', () => {
  it.each([
    ["IF v = 'FAKE' AND platform.deployment_env() = 'production' THEN"],
    ["IF platform.deployment_env() <> 'production' THEN"],
    ["IF platform.deployment_env() NOT IN ('test', 'development') THEN"],
    ["IF platform.deployment_env() IS DISTINCT FROM 'production' THEN"],
    ['v_env := platform.deployment_env();'],
    ["SELECT CASE WHEN deployment_env() = 'production' THEN 1 END"],
    ["v := COALESCE(platform.deployment_env(), 'test');"],
    ["v := COALESCE(platform.deployment_env(), 'production', 'x');"],
    ["v := COALESCE(NULL, platform.deployment_env(), 'production');"],
    ['SELECT platform . deployment_env ( )'],
  ])('refusé : %s', (sql) => {
    expect(scanEnvGuards(sql)).toHaveLength(1);
  });

  it.each([
    ["IF v = 'FAKE' AND COALESCE(platform.deployment_env(), 'production') = 'production' THEN"],
    ["v_env := COALESCE( platform.deployment_env() ,  'production' );"],
    [
      "CREATE OR REPLACE FUNCTION platform.deployment_env() RETURNS text LANGUAGE sql AS $$ SELECT 'production' $$;",
    ],
    ['CREATE FUNCTION platform.deployment_env()\n  RETURNS text'],
    ["COMMENT ON FUNCTION platform.deployment_env() IS 'x';"],
    ['REVOKE ALL ON FUNCTION platform.deployment_env() FROM PUBLIC;'],
    ['GRANT EXECUTE ON FUNCTION platform.now(), platform.deployment_env() TO app_api;'],
    ['DROP FUNCTION platform.deployment_env();'],
    ["-- IF platform.deployment_env() = 'production' (commentaire)"],
    ["SELECT 'platform.deployment_env() = production'"],
  ])('admis : %s', (sql) => {
    expect(scanEnvGuards(sql)).toEqual([]);
  });

  it('dans le corps d’une fonction entre dollars, ligne et colonne de l’appel', () => {
    const sql = [
      'CREATE FUNCTION core.f() RETURNS void LANGUAGE plpgsql AS $fn$',
      'BEGIN',
      "  IF platform.deployment_env() = 'production' THEN RAISE EXCEPTION 'x'; END IF;",
      'END',
      '$fn$;',
    ].join('\n');
    expect(scanEnvGuards(sql)).toMatchObject([{ line: 3, column: 6 }]);
  });
});

describe('lintEnvGuards (arbre de migrations)', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function tree(files: Record<string, string>, allowlist?: unknown): string {
    root = mkdtempSync(join(tmpdir(), 'env-guard-'));
    mkdirSync(join(root, 'packages', 'db', 'migrations'), { recursive: true });
    for (const [name, sql] of Object.entries(files)) {
      writeFileSync(join(root, 'packages', 'db', 'migrations', name), sql);
    }
    if (allowlist !== undefined) {
      writeFileSync(
        join(root, 'packages', 'db', 'env-guard-allowlist.json'),
        JSON.stringify(allowlist),
      );
    }
    return root;
  }

  const OPEN = "SELECT 1 WHERE platform.deployment_env() = 'production';\n";
  const CLOSED =
    "SELECT 1 WHERE COALESCE(platform.deployment_env(), 'production') = 'production';\n";
  const entry = (supersededBy: string, line = 1) => ({
    path: 'packages/db/migrations/0001_old.sql',
    line,
    function: 'core.f()',
    supersededBy,
    justification: 'garde historique remplacée par la migration suivante',
  });

  it('une nouvelle garde ouverte fait échouer, la CLI sort en erreur', () => {
    const dir = tree({ '0001_old.sql': CLOSED, '0002_new.sql': OPEN });
    expect(lintEnvGuards(dir).findings).toMatchObject([
      { file: 'packages/db/migrations/0002_new.sql', line: 1 },
    ]);
    let status = 0;
    try {
      execFileSync(process.execPath, [cli, '--root', dir], { stdio: 'pipe' });
    } catch (error) {
      status = (error as { status: number }).status;
    }
    expect(status).toBe(1);
  });

  it('lecture historique tolérée si une migration postérieure la remplace', () => {
    const dir = tree(
      { '0001_old.sql': OPEN, '0002_fix.sql': CLOSED },
      { entries: [entry('0002_fix')] },
    );
    expect(lintEnvGuards(dir)).toMatchObject({ findings: [], allowlistErrors: [] });
  });

  it('liste blanche : entrée périmée, remplacement absent ou antérieur ⇒ erreur', () => {
    expect(
      lintEnvGuards(
        tree({ '0001_old.sql': CLOSED, '0002_fix.sql': CLOSED }, { entries: [entry('0002_fix')] }),
      ).allowlistErrors,
    ).toEqual([expect.stringMatching(/aucune lecture à tolérer/)]);
    rmSync(root, { recursive: true, force: true });
    expect(
      lintEnvGuards(tree({ '0001_old.sql': OPEN }, { entries: [entry('0009_absent')] }))
        .allowlistErrors,
    ).toEqual([expect.stringMatching(/absente/)]);
    rmSync(root, { recursive: true, force: true });
    expect(
      lintEnvGuards(
        tree(
          { '0000_before.sql': CLOSED, '0001_old.sql': OPEN },
          { entries: [entry('0000_before')] },
        ),
      ).allowlistErrors,
    ).toEqual([expect.stringMatching(/pas postérieure/)]);
  });

  it('dépôt réel : aucune garde ouverte hors des lectures historiques remplacées', () => {
    expect(lintEnvGuards(repoRoot)).toMatchObject({ findings: [], allowlistErrors: [] });
  });
});
