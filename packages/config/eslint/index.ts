/**
 * Configuration ESLint partagée (flat config) du monorepo.
 * Utilisée par `eslint.config.mjs` à la racine ; voir CONTRIBUTING.md § « Lint ».
 */
import js from '@eslint/js';
import type { ESLint, Linter } from 'eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import moduleBoundaries from './rules/module-boundaries.ts';
import type { ModuleBoundariesOptions } from './rules/module-boundaries.ts';
import noSqlClock from './rules/no-sql-clock.ts';

export type { ModuleBoundariesOptions } from './rules/module-boundaries.ts';

export const plugin: ESLint.Plugin = {
  meta: { name: '@rueda/eslint-plugin' },
  rules: {
    'module-boundaries': moduleBoundaries,
    'no-sql-clock': noSqlClock,
  },
};

export interface RuedaConfigOptions {
  readonly moduleBoundaries: ModuleBoundariesOptions;
}

export const GLOBAL_IGNORES: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/next-env.d.ts',
  'docs/specs/**',
  // Fixtures volontairement fautives : lintées seulement par les tests de packages/config.
  'packages/config/test/fixtures/**',
];

export function createConfig(options: RuedaConfigOptions): Linter.Config[] {
  return [
    { ignores: [...GLOBAL_IGNORES] },
    js.configs.recommended,
    ...(tseslint.configs.recommended as Linter.Config[]),
    {
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: { ...globals.node },
      },
    },
    {
      files: ['apps/web/**/*.{ts,tsx}', 'apps/backoffice/**/*.{ts,tsx}'],
      languageOptions: { globals: { ...globals.browser } },
    },
    {
      files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
      plugins: { rueda: plugin },
      rules: {
        'rueda/module-boundaries': ['error', options.moduleBoundaries],
        'rueda/no-sql-clock': 'error',
      },
    },
    {
      // Les règles d'horloge SQL se décrivent elles-mêmes (messages, motifs) : on les exempte.
      // Les tests eux-mêmes contiennent des exemples fautifs ; leurs fixtures restent lintées.
      files: [
        'packages/config/sql-clock/**',
        'packages/config/eslint/rules/no-sql-clock.ts',
        'packages/config/test/*.test.ts',
      ],
      rules: { 'rueda/no-sql-clock': 'off' },
    },
  ];
}
