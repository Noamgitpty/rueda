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
import noCountryConstants from './rules/no-country-constants.ts';
import noSqlClock from './rules/no-sql-clock.ts';

export type { ModuleBoundariesOptions } from './rules/module-boundaries.ts';
export type { NoCountryConstantsOptions } from './rules/no-country-constants.ts';

export const plugin: ESLint.Plugin = {
  meta: { name: '@rueda/eslint-plugin' },
  rules: {
    'module-boundaries': moduleBoundaries,
    'no-country-constants': noCountryConstants,
    'no-sql-clock': noSqlClock,
  },
};

export interface RuedaConfigOptions {
  readonly moduleBoundaries: ModuleBoundariesOptions;
  /** Jetons propres à un pays, tirés des données CFG (`country-constants/tokens.ts`, US-013). */
  readonly countryTokens: readonly string[];
  /**
   * Fichiers exemptés de `rueda/no-country-constants`, **déclarés** un à un avec justification
   * dans `country-constants/exemptions.json` (revue code US-013) : aucun dossier `test` n'est
   * exempté d'office.
   */
  readonly countryExemptions: readonly string[];
}

/** Fixtures du lint : la règle y reste active (tests de packages/config, US-013). */
const COUNTRY_CONSTANTS_FIXTURES = 'packages/config/test/fixtures/country-in-ts/**';

export const GLOBAL_IGNORES: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/next-env.d.ts',
  'docs/specs/**',
  // Worktrees des agents Claude Code (autres branches).
  '.claude/**',
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
        'rueda/no-country-constants': ['error', { tokens: [...options.countryTokens] }],
      },
    },
    {
      files: [...options.countryExemptions],
      rules: { 'rueda/no-country-constants': 'off' },
    },
    {
      files: [COUNTRY_CONSTANTS_FIXTURES],
      rules: { 'rueda/no-country-constants': ['error', { tokens: [...options.countryTokens] }] },
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
