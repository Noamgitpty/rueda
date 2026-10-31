/**
 * Critère d'acceptation 2 de US-001 : du SQL métier contenant `now()`, `current_timestamp`
 * (et variantes) fait échouer `pnpm lint` ; seule la définition de `platform.now()`, inscrite
 * dans la liste blanche, a droit à `clock_timestamp()` ; les commentaires ne déclenchent rien.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { lintSqlTree } from '../sql-clock/lint-tree.ts';
import { scanSql } from '../sql-clock/scan.ts';
import { fixturesDir, repoRoot } from './paths.ts';

const sqlFixtures = join(fixturesDir, 'sql');
const cli = join(repoRoot, 'packages', 'config', 'sql-clock', 'cli.ts');

function runCli(root: string): { status: number; output: string } {
  try {
    const stdout = execFileSync(process.execPath, [cli, '--root', root], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

describe('scanSql', () => {
  it.each([
    ['SELECT now()', 'now()'],
    ['select NOW ()', 'now()'],
    ['select pg_catalog.now()', 'now()'],
    ['select other_schema.now()', 'now()'],
    ['values (current_timestamp)', 'current_timestamp'],
    ['values (CURRENT_TIMESTAMP(3))', 'current_timestamp'],
    ['select localtimestamp', 'localtimestamp'],
    ['select transaction_timestamp()', 'transaction_timestamp()'],
    ['select statement_timestamp()', 'statement_timestamp()'],
    ['select clock_timestamp()', 'clock_timestamp()'],
    ['select current_date', 'current_date'],
    ['select current_time', 'current_time'],
    ['select localtime', 'localtime'],
    ["select 'now'::timestamptz", "'now'"],
    ["select ' TODAY '::date", "'today'"],
    ['create function f() returns timestamptz as $$ select now() $$ language sql', 'now()'],
    ['do $body$ begin perform current_timestamp; end $body$', 'current_timestamp'],
  ])('détecte %s', (sql, token) => {
    expect(scanSql(sql).map((f) => f.token)).toEqual([token]);
  });

  it.each([
    'select platform.now()',
    'select platform . now ( )',
    '-- now() current_timestamp',
    '/* now() /* imbriqué current_timestamp */ localtimestamp */ select 1',
    "select 'now() et current_timestamp dans un texte'",
    "select E'l\\'heure : now()'",
    'select "now", "current_timestamp" from t',
    'select t.current_date from t',
    'select snowfall, current_date_label, nowhere from t',
    'select $1, $2::int',
  ])('ne détecte rien dans %s', (sql) => {
    expect(scanSql(sql)).toEqual([]);
  });

  it('donne la ligne et la colonne', () => {
    expect(scanSql('select 1;\n  select now();')[0]).toMatchObject({ line: 2, column: 10 });
  });

  it('la liste blanche ne peut tolérer que clock_timestamp()', () => {
    expect(scanSql('select clock_timestamp()', { allow: ['clock_timestamp()'] })).toEqual([]);
    expect(scanSql('select now()', { allow: ['now()'] })).toHaveLength(1);
  });
});

describe('lint des fichiers .sql sur fixtures', () => {
  it('échoue sur un arbre contenant now() et les variantes interdites', () => {
    const result = lintSqlTree(join(sqlFixtures, 'bad-tree'));
    const byFile = (file: string) =>
      result.findings.filter((f) => f.file.endsWith(file)).map((f) => `${f.line}:${f.token}`);
    expect(byFile('0001_bad_now.sql')).toEqual(['2:now()']);
    expect(byFile('0002_bad_variants.sql')).toEqual([
      '2:current_timestamp',
      '3:localtimestamp',
      '4:transaction_timestamp()',
      '5:statement_timestamp()',
      '6:now()',
      "7:'now'",
      '8:clock_timestamp()',
      '10:current_timestamp',
      '12:current_date',
      '12:current_time',
      '12:localtime',
    ]);
  });

  it('passe sur un arbre propre (commentaires, chaînes, platform.now(), liste blanche)', () => {
    const result = lintSqlTree(join(sqlFixtures, 'clean-tree'));
    expect(result.allowlistErrors).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.filesScanned).toBe(2);
  });

  it('refuse une liste blanche qui tolère now() ou sans justification', () => {
    const result = lintSqlTree(join(sqlFixtures, 'bad-allowlist-tree'));
    expect(result.allowlistErrors).toHaveLength(2);
    expect(result.findings.map((f) => f.token)).toEqual(['now()']);
  });

  it('la commande (étape SQL de pnpm lint) sort en erreur sur le mauvais arbre', () => {
    const run = runCli(join(sqlFixtures, 'bad-tree'));
    expect(run.status).toBe(1);
    expect(run.output).toContain('0001_bad_now.sql:2:');
  });

  it('la commande passe sur l’arbre propre', () => {
    expect(runCli(join(sqlFixtures, 'clean-tree')).status).toBe(0);
  });

  it('le dépôt lui-même est propre', () => {
    expect(runCli(repoRoot)).toMatchObject({ status: 0 });
  });
});

describe('rueda/no-sql-clock (SQL dans le TypeScript, configuration réelle)', () => {
  async function lint(file: string): Promise<ESLint.LintResult> {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: join(repoRoot, 'eslint.config.mjs'),
      ignore: false,
    });
    const [result] = await eslint.lintFiles([join(fixturesDir, 'sql-in-ts', file)]);
    if (!result) throw new Error('aucun résultat');
    return result;
  }

  it('échoue sur sql`… now() …` et sur une chaîne SQL avec CURRENT_TIMESTAMP', async () => {
    const result = await lint('bad.ts');
    const messages = result.messages.filter((m) => m.ruleId === 'rueda/no-sql-clock');
    expect(messages.map((m) => m.line)).toEqual([4, 5]);
  });

  it('passe avec platform.now()', async () => {
    expect((await lint('clean.ts')).messages).toEqual([]);
  });
});
