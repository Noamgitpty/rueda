/**
 * US-013, critère « Given le code source, When le test « aucune constante pays » tourne, Then
 * aucune devise, taux, fuseau ou pièce propre à PA ou PY n'est codé en dur » (19 US-013 ;
 * ADR-024, ADR-033). Deux contrôles : la règle ESLint `rueda/no-country-constants` (TypeScript,
 * JSX) et le contrôle SQL des migrations (`country-constants/cli.ts`), tous deux dans `pnpm lint`.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { lintSqlCountryConstants, scanSqlCountryConstants } from '../country-constants/sql.ts';
import { findCountryDirectives, lintCountryDirectives } from '../country-constants/directives.ts';
import {
  countryTokensFromData,
  findCountryConstants,
  isCountryRuleDirective,
  loadCountryExemptions,
  loadCountryTokens,
} from '../country-constants/tokens.ts';
import { fixturesDir, repoRoot } from './paths.ts';

const tokens = loadCountryTokens(repoRoot);

describe('jetons tirés des données CFG', () => {
  it('couvrent codes pays, devises, fuseaux, locales régionales, taxes et pièces de PA et PY', () => {
    // Attentes : 17 §1.1–§1.4, §7.2 (ITBMS 7 %, IVA 10 %, cédula / RUC).
    for (const t of [
      'PA',
      'PY',
      'USD',
      'PYG',
      'America/Panama',
      'America/Asuncion',
      'es-PA',
      'es-PY',
      'ITBMS',
      'IVA',
      'RUC',
      'CEDULA',
    ]) {
      expect(tokens).toContain(t);
    }
    // `en` et `fr` sont communes à plusieurs pays : pas des constantes pays.
    expect(tokens).not.toContain('en');
    expect(tokens).not.toContain('fr');
  });

  it('un pays ajouté aux données est aussitôt protégé', () => {
    const extra = countryTokensFromData(
      { currencies: [{ code: 'ZZZ' }] },
      {
        countries: [
          {
            code: 'ZZ',
            timeZone: 'Etc/GMT+12',
            locales: ['xx-ZZ', 'en'],
            taxLines: [{ rateGroup: 'ZTAX' }],
          },
        ],
      },
    );
    expect(extra).toEqual(['Etc/GMT+12', 'ZTAX', 'ZZ', 'ZZZ', 'xx-ZZ']);
  });

  it('mot entier, sans tenir compte de la casse ; jeton rendu tel que dans les données', () => {
    expect(findCountryConstants("code === 'PA'", tokens).map((f) => f.token)).toEqual(['PA']);
    expect(
      findCountryConstants('pa usd america/asuncion Es-Py', tokens).map((f) => f.token),
    ).toEqual(['PA', 'USD', 'America/Asuncion', 'es-PY']);
    expect(findCountryConstants('PAYMENT PAYOUT PYGMY usdt oracle.py', tokens)).toEqual([]);
    expect(findCountryConstants('es-PY', tokens).map((f) => f.token)).toEqual(['es-PY']);
  });
});

async function lintFixture(name: string): Promise<string[]> {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: join(repoRoot, 'eslint.config.mjs'),
    ignore: false,
  });
  const [result] = await eslint.lintFiles([join(fixturesDir, 'country-in-ts', name)]);
  if (!result) throw new Error(`aucun résultat pour ${name}`);
  return result.messages
    .filter((m) => m.ruleId === 'rueda/no-country-constants')
    .map((m) => `${m.line}:${m.message}`);
}

describe('rueda/no-country-constants (configuration réelle)', () => {
  it('signale devise, fuseau, locale, code pays, taxe et pièce en dur', async () => {
    const messages = await lintFixture('bad.ts');
    const found = messages.map((m) => /« (.+?) »/.exec(m)?.[1]);
    expect(found).toEqual([
      'PYG',
      'America/Asuncion',
      'es-PA',
      'PA',
      'USD',
      'ITBMS',
      'RUC',
      // clés nues d'objet, membres d'enum (casse ignorée), motif d'expression régulière
      'PYG',
      'USD',
      'PA',
      'PY',
      'PY',
      // casse, champ et méthode de classe
      'America/Panama',
      'IVA',
      'ITBMS',
    ]);
    expect(messages[0]).toMatch(/configuration pays \(module CFG\)/);
    // Limite documentée (ADR-049) : le nombre 0.07 de la dernière ligne n'est pas détecté.
    expect(messages.some((m) => m.startsWith('22:'))).toBe(false);
  });

  it('ne signale rien dans un fichier propre (commentaires, mots voisins, minuscules)', async () => {
    expect(await lintFixture('clean.ts')).toEqual([]);
  });

  it('le code du dépôt passe (aucune constante pays)', async () => {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: join(repoRoot, 'eslint.config.mjs'),
    });
    const results = await eslint.lintFiles(['apps', 'packages']);
    const hits = results.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId === 'rueda/no-country-constants')
        .map((m) => `${r.filePath}:${m.line} ${m.message}`),
    );
    expect(hits).toEqual([]);
  });
});

describe('exemptions déclarées et directives interdites', () => {
  it('aucun dossier test exempté d’office : chaque exemption est un glob déclaré et justifié', () => {
    const { files, directives } = loadCountryExemptions(repoRoot);
    expect(files).not.toContain('**/test/**');
    expect(files.some((g) => g.startsWith('**/'))).toBe(false);
    expect(directives).toEqual([]);
  });

  it.each([
    ['eslint-disable-next-line rueda/no-country-constants', true],
    [' eslint-disable ', true],
    ['eslint-disable-line -- raison', true],
    ['eslint rueda/no-country-constants: off', true],
    ['eslint-disable-next-line no-console', false],
    ['eslint-enable', false],
    ['eslint-env node', false],
    ['texte qui cite eslint-disable', false],
  ])('directive « %s » ⇒ %s', (comment, expected) => {
    expect(isCountryRuleDirective(comment)).toBe(expected);
  });

  it('commentaires seulement : une chaîne qui contient « // eslint-disable » ne compte pas', () => {
    const src = [
      "const s = 'a // eslint-disable';",
      'const t = `/* eslint-disable */`;',
      '// eslint-disable',
    ].join(String.fromCharCode(10));
    expect(findCountryDirectives(src)).toEqual([{ line: 3, comment: 'eslint-disable' }]);
  });

  it('échoue sur un arbre qui coupe la règle ; passe sur le dépôt', () => {
    const tree = join(fixturesDir, 'country-directives');
    expect(lintCountryDirectives(tree, []).findings.map((f) => `${f.file}:${f.line}`)).toEqual([
      'apps/x/bad.ts:1',
      'apps/x/bad.ts:3',
      'apps/x/bad.ts:4',
      'apps/x/bad.ts:5',
    ]);
    expect(lintCountryDirectives(tree, ['apps/x/bad.ts']).findings).toEqual([]);
    expect(
      lintCountryDirectives(repoRoot, loadCountryExemptions(repoRoot).directives).findings,
    ).toEqual([]);
  });
});

describe('contrôle SQL des migrations', () => {
  const tree = (name: string): string => join(fixturesDir, 'country-sql', name);

  it('littéraux seulement, commentaires ignorés', () => {
    expect(scanSqlCountryConstants("-- PYG\nSELECT 'USD', 'PAYMENT'", tokens)).toEqual([
      { line: 2, token: 'USD' },
    ]);
  });

  it('échoue sur une migration qui nomme une devise ou un fuseau', () => {
    const result = lintSqlCountryConstants(tree('bad-tree'), tokens);
    expect(result.findings.map((f) => `${f.line}:${f.token}`)).toEqual([
      '2:USD',
      '2:PYG',
      '3:America/Panama',
    ]);
  });

  it('passe : commentaires et graine inscrite en liste blanche', () => {
    const result = lintSqlCountryConstants(tree('clean-tree'), tokens);
    expect(result).toMatchObject({ findings: [], allowlistErrors: [], filesScanned: 1 });
  });

  it('les migrations du dépôt passent ; la CLI sort en 0', () => {
    expect(lintSqlCountryConstants(repoRoot, tokens)).toMatchObject({
      findings: [],
      allowlistErrors: [],
    });
    const out = execFileSync(
      process.execPath,
      [join(repoRoot, 'packages', 'config', 'country-constants', 'cli.ts')],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );
    expect(out).toMatch(/country-constants : OK/);
  });

  it('sans jeton, le contrôle échoue (fail-closed)', () => {
    expect(lintSqlCountryConstants(tree('clean-tree'), []).allowlistErrors).not.toEqual([]);
  });
});
