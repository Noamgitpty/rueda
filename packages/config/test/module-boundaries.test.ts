/**
 * Critère d'acceptation 1 de US-001 : un import de l'intérieur d'un autre module, ou une
 * dépendance absente du graphe de 17 §2.2, fait échouer `pnpm lint`.
 * Les fixtures sont lintées avec la **vraie** configuration racine (eslint.config.mjs).
 */
import { join } from 'node:path';
import { ESLint, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import rule from '../eslint/rules/module-boundaries.ts';
import { fixturesDir, repoRoot } from './paths.ts';

const modulesFixtures = join(fixturesDir, 'boundaries', 'apps', 'api', 'src');

async function lintFixture(relativePath: string): Promise<ESLint.LintResult> {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: join(repoRoot, 'eslint.config.mjs'),
    ignore: false,
  });
  const [result] = await eslint.lintFiles([join(modulesFixtures, relativePath)]);
  if (!result) throw new Error(`aucun résultat pour ${relativePath}`);
  return result;
}

function boundaryMessages(result: ESLint.LintResult): string[] {
  return result.messages
    .filter((m) => m.ruleId === 'rueda/module-boundaries')
    .map((m) => m.message);
}

describe('rueda/module-boundaries sur fixtures (configuration réelle)', () => {
  it("échoue : AVL importe l'intérieur de PRC", async () => {
    const result = await lintFixture('modules/avl/internal/bad-internal-import.ts');
    expect(result.errorCount).toBeGreaterThan(0);
    expect(boundaryMessages(result)).toEqual([
      expect.stringContaining("l'intérieur du module PRC"),
    ]);
  });

  it('échoue : AVL importe pay.module.ts au lieu de index.ts', async () => {
    const result = await lintFixture('modules/avl/internal/bad-module-file-import.ts');
    expect(boundaryMessages(result)).toEqual([
      expect.stringContaining("l'intérieur du module PAY"),
    ]);
  });

  it('échoue : IAM dépend d’AVL, dépendance absente du graphe', async () => {
    const result = await lintFixture('modules/iam/internal/bad-forbidden-dependency.ts');
    expect(boundaryMessages(result)).toEqual([
      expect.stringContaining('IAM ne peut pas dépendre de AVL'),
    ]);
  });

  it('échoue : module absent du graphe', async () => {
    const result = await lintFixture('modules/zzz/index.ts');
    expect(boundaryMessages(result)).toEqual([expect.stringContaining('Module inconnu « zzz »')]);
  });

  it("échoue : un fichier hors module importe l'intérieur d'un module", async () => {
    const result = await lintFixture('bad-shell-import.ts');
    expect(boundaryMessages(result)).toEqual([
      expect.stringContaining("l'intérieur du module KYC"),
    ]);
  });

  it('passe : imports par index, socle implicite et imports internes au module', async () => {
    const result = await lintFixture('modules/avl/internal/clean.ts');
    expect(result.messages).toEqual([]);
  });

  it('passe : le shell applicatif importe les index', async () => {
    const result = await lintFixture('clean-shell-import.ts');
    expect(result.messages).toEqual([]);
  });
});

describe('rueda/module-boundaries (RuleTester : formes d’import)', () => {
  const options = [
    {
      modulesPath: 'apps/api/src/modules',
      modules: {
        avl: { code: 'AVL', allowed: ['prc', 'cfg'] },
        prc: { code: 'PRC', allowed: ['cfg'] },
        cfg: { code: 'CFG', allowed: [] },
      },
    },
  ];
  const file = '/repo/apps/api/src/modules/avl/internal/x.ts';
  const tester = new RuleTester({
    languageOptions: { parser: tseslint.parser as never, sourceType: 'module' },
  });

  it('couvre import dynamique, require, export * et import de type', () => {
    tester.run('module-boundaries', rule, {
      valid: [
        { filename: file, options, code: "import { a } from '../../prc';" },
        { filename: file, options, code: "import { a } from '../../prc/index.ts';" },
        { filename: file, options, code: "import x from 'node:path';" },
        { filename: file, options, code: "import { y } from './sibling.js';" },
        {
          filename: '/repo/apps/api/src/modules/cfg/index.ts',
          options,
          code: "export * from './internal/params.js';",
        },
      ],
      invalid: [
        {
          filename: file,
          options,
          code: "const m = await import('../../prc/internal/q.js');",
          errors: [{ messageId: 'internalImport' }],
        },
        {
          filename: file,
          options,
          code: "const m = require('../../prc/internal/q.js');",
          errors: [{ messageId: 'internalImport' }],
        },
        {
          filename: file,
          options,
          code: "export * from '../../prc/internal/q.js';",
          errors: [{ messageId: 'internalImport' }],
        },
        {
          filename: file,
          options,
          code: "import type { Q } from '../../prc/internal/q.js';",
          errors: [{ messageId: 'internalImport' }],
        },
        {
          filename: '/repo/apps/api/src/modules/prc/internal/x.ts',
          options,
          code: "import { a } from '../../avl/index.js';",
          errors: [{ messageId: 'forbiddenDependency' }],
        },
        {
          filename: 'C:\\repo\\apps\\api\\src\\modules\\cfg\\internal\\x.ts',
          options,
          code: "import { a } from '../../prc/index.js';",
          errors: [{ messageId: 'forbiddenDependency' }],
        },
      ],
    });
  });
});
