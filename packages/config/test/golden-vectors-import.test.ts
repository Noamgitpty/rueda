/**
 * Le harnais `@rueda/money/golden-vectors` (US-016) est réservé aux tests : un import de
 * production (statique, de type, réexport, `import()`, `require()`, chemin relatif) fait échouer
 * `pnpm lint` ; un fichier de test peut l'importer (revues US-016 architecture 2 et qa 5 ; US-017).
 * Les fixtures sont lintées avec la **vraie** configuration racine (eslint.config.mjs).
 */
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { fixturesDir, repoRoot } from './paths.ts';

const RULES = new Set(['no-restricted-imports', 'no-restricted-syntax']);

async function restricted(relativePath: string): Promise<number[]> {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: join(repoRoot, 'eslint.config.mjs'),
    ignore: false,
  });
  const [result] = await eslint.lintFiles([join(fixturesDir, 'golden-vectors', relativePath)]);
  if (!result) throw new Error(`aucun résultat pour ${relativePath}`);
  return result.messages
    .filter((m) => m.ruleId !== null && RULES.has(m.ruleId))
    .map((m) => {
      expect(m.message).toContain('réservé aux tests');
      return m.line;
    });
}

describe('import du harnais des vecteurs dorés (configuration réelle)', () => {
  it('échoue en production : import, import de type, réexport relatif, import(), require()', async () => {
    expect(await restricted('src/bad.ts')).toEqual([2, 3, 4, 6, 8]);
  });

  it('passe en production : le point d’entrée public @rueda/money', async () => {
    expect(await restricted('src/clean.ts')).toEqual([]);
  });

  it('passe dans un fichier de test', async () => {
    expect(await restricted('test/harness.test.ts')).toEqual([]);
  });
});
