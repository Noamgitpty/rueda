/**
 * Le harnais `@rueda/money/golden-vectors` (US-016) est réservé aux tests : un import de
 * production (statique, de type, réexport, `import()` littéral, en gabarit ou par variable,
 * `require()`, `createRequire`, `globalThis.require`, chemin relatif) fait échouer `pnpm lint` ;
 * un fichier de test peut l'importer (revues US-016 architecture 2 et qa 5 ; revues US-017).
 * Le lint tourne avec la **vraie** configuration racine (eslint.config.mjs).
 */
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { fixturesDir, repoRoot } from './paths.ts';

const RULES = new Set(['no-restricted-imports', 'no-restricted-syntax']);

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: join(repoRoot, 'eslint.config.mjs'),
  ignore: false,
});

function restrictedLines(result: ESLint.LintResult | undefined): number[] {
  if (!result) throw new Error('aucun résultat');
  const lines = result.messages
    .filter((m) => m.ruleId !== null && RULES.has(m.ruleId))
    .map((m) => {
      expect(m.message).toContain('réservé aux tests');
      return m.line;
    });
  return [...new Set(lines)].sort((a, b) => a - b);
}

async function fixture(relativePath: string): Promise<number[]> {
  const [result] = await eslint.lintFiles([join(fixturesDir, 'golden-vectors', relativePath)]);
  return restrictedLines(result);
}

/** Même code, linté comme s'il était à `path` (dans le dépôt) : seule l'exemption par chemin varie. */
async function atPath(path: string): Promise<number[]> {
  const code =
    "import { loadGoldenVectors } from '@rueda/money/golden-vectors';\nexport const x = loadGoldenVectors;\n";
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, path) });
  return restrictedLines(result);
}

describe('import du harnais des vecteurs dorés (configuration réelle)', () => {
  it('échoue en production : import, import de type, réexport relatif, import(), require()', async () => {
    expect(await fixture('src/bad.ts')).toEqual([2, 3, 4, 6, 8]);
  });

  it('échoue en production : import() en gabarit ou par variable, createRequire, globalThis.require', async () => {
    expect(await fixture('src/bad-dynamic.ts')).toEqual([4, 5, 7, 9]);
  });

  it('passe en production : le point d’entrée public @rueda/money', async () => {
    expect(await fixture('src/clean.ts')).toEqual([]);
  });

  it('passe dans un fichier de test', async () => {
    expect(await fixture('test/harness.test.ts')).toEqual([]);
  });

  it.each([
    'apps/api/src/test/helper.ts',
    'apps/api/src/modules/stl/internal/test/helper.ts',
    'packages/money/src/settlement/test/helper.ts',
    'packages/money/src/settlement/engine.ts',
  ])(
    'exemption par la nature du fichier, pas par un dossier test/ quelconque : %s refusé',
    async (path) => {
      expect(await atPath(path)).toEqual([1]);
    },
  );

  it.each([
    'packages/money/test/settlement/adapter.ts',
    'apps/api/test/helper.ts',
    'apps/api/src/modules/stl/internal/settlement.test.ts',
  ])('fichier de test autorisé : %s', async (path) => {
    expect(await atPath(path)).toEqual([]);
  });
});
