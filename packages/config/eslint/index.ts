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
import noDynamicSql from './rules/no-dynamic-sql.ts';
import noSqlClock from './rules/no-sql-clock.ts';

export type { ModuleBoundariesOptions } from './rules/module-boundaries.ts';
export type { NoCountryConstantsOptions } from './rules/no-country-constants.ts';

export const plugin: ESLint.Plugin = {
  meta: { name: '@rueda/eslint-plugin' },
  rules: {
    'module-boundaries': moduleBoundaries,
    'no-country-constants': noCountryConstants,
    'no-dynamic-sql': noDynamicSql,
    'no-sql-clock': noSqlClock,
  },
};

/**
 * Code exécuté sous un rôle applicatif (`app_api`, `app_worker`, `app_anon`) : sources des
 * applications et des paquets, hors tests. `rueda/no-dynamic-sql` (US-049, 17 §2.3 RLS-18) s'y
 * applique. Exclus : les outils d'administration de `@rueda/db` exécutés sous `migrator` ou le rôle
 * d'administration, jamais par l'application (amorçage, base de développement, déploiement,
 * rotation, vérification de restauration, harnais de test), qui composent des identifiants issus de
 * listes fermées ou du catalogue.
 */
export const APP_RUNTIME_GLOBS: readonly string[] = ['apps/*/src/**', 'packages/*/src/**'];
export const DYNAMIC_SQL_ADMIN_TOOLS: readonly string[] = [
  'packages/db/src/bootstrap.ts',
  'packages/db/src/dev/**',
  'packages/db/src/deploy/**',
  'packages/db/src/rotation/**',
  'packages/db/src/restore/**',
  'packages/db/src/testing/**',
  '**/testing/**',
];

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

/**
 * Harnais des vecteurs dorés (`@rueda/money/golden-vectors`, US-016) : réservé aux tests. Il lit
 * l'export des oracles avec `node:fs` ; un import de production ferait des attendus une donnée du
 * code produit (CLAUDE.md, « le code testé n'est jamais l'oracle »). Revues US-016 (architecture 2,
 * qa 5) ; règle posée par US-017, premier consommateur.
 */
const GOLDEN_VECTORS_MESSAGE =
  '@rueda/money/golden-vectors est réservé aux tests (US-016) : aucun code de production ne l’importe.';
export const GOLDEN_VECTORS_IMPORT_PATTERNS: readonly string[] = [
  '@rueda/money/golden-vectors',
  '@rueda/money/golden-vectors/*',
  '**/golden-vectors',
  '**/golden-vectors/**',
];
/**
 * Fichiers de test, et eux seuls, autorisés à importer le harnais (revue sécurité US-017 n° 3) :
 * fichiers `*.test.*` / `*.spec.*` et dossier `test/` **à la racine d'un paquet ou d'une
 * application** (`packages/<p>/test/`, `apps/<a>/test/`). Un dossier `test/` niché dans les sources
 * (`apps/api/src/test/`) n'est pas exempté. S'y ajoutent le harnais lui-même et ce fichier, qui
 * décrit la règle (ses chaînes nomment le harnais).
 */
export const TEST_FILE_GLOBS: readonly string[] = [
  '**/*.test.{ts,tsx,mts,cts,js,mjs,cjs}',
  '**/*.spec.{ts,tsx,mts,cts,js,mjs,cjs}',
  'packages/*/test/**',
  'apps/*/test/**',
  'packages/money/src/golden-vectors/**',
  'packages/config/eslint/index.ts',
];
/** Fixture « production » du test de la règle : jamais exemptée, bien qu'elle soit sous `test/`. */
const GOLDEN_VECTORS_PROD_FIXTURES = 'packages/config/test/fixtures/golden-vectors/src/**';
const GOLDEN_VECTORS_SOURCE = '/golden-vectors/';

/**
 * Adaptateur de test du moteur de règlement (`@rueda/money/testing` = `test/settlement/adapter.ts`,
 * US-018) : réservé aux tests, comme le harnais des vecteurs dorés, sous les mêmes exemptions
 * (`TEST_FILE_GLOBS`). Mineur de la revue sécurité US-018 (2e tour, constat 7), tracé par US-061
 * vers US-035.
 */
const MONEY_TESTING_MESSAGE =
  '@rueda/money/testing est réservé aux tests (US-018) : aucun code de production ne l’importe.';
// Chaînes assemblées : un littéral qui finit par « /testing » ferait de ce fichier une entrée dans
// un dossier testing/ pour le contrôle C19 de packages/fake-adapters (production-isolation).
const MONEY_TESTING = ['@rueda/money', 'testing'].join('/');
export const MONEY_TESTING_IMPORT_PATTERNS: readonly string[] = [
  MONEY_TESTING,
  `${MONEY_TESTING}/*`,
];
/** Sélecteur esquery : toute chaîne qui contient le sous-chemin, où qu'elle soit. */
const MONEY_TESTING_SOURCE = String.raw`/@rueda\/money\/testin[g]/`;

function goldenVectorsRules(): Linter.RulesRecord {
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: [...GOLDEN_VECTORS_IMPORT_PATTERNS], message: GOLDEN_VECTORS_MESSAGE },
          { group: [...MONEY_TESTING_IMPORT_PATTERNS], message: MONEY_TESTING_MESSAGE },
        ],
      },
    ],
    // Toute chaîne ou partie de gabarit qui nomme le harnais, où qu'elle soit : `import()` littéral,
    // en gabarit ou par variable, `require()`, `createRequire(…)(…)`, `globalThis.require(…)`,
    // `require.resolve(…)`. Limite (documentée, comme rueda/module-boundaries) : un nom fabriqué
    // sans que « golden-vectors » figure en entier dans un littéral (concaténation de fragments,
    // valeur lue à l'exécution) échappe au lint ; la revue de code reste le contrôle.
    'no-restricted-syntax': [
      'error',
      { selector: `Literal[value=${GOLDEN_VECTORS_SOURCE}]`, message: GOLDEN_VECTORS_MESSAGE },
      {
        selector: `TemplateElement[value.raw=${GOLDEN_VECTORS_SOURCE}]`,
        message: GOLDEN_VECTORS_MESSAGE,
      },
      { selector: `Literal[value=${MONEY_TESTING_SOURCE}]`, message: MONEY_TESTING_MESSAGE },
      {
        selector: `TemplateElement[value.raw=${MONEY_TESTING_SOURCE}]`,
        message: MONEY_TESTING_MESSAGE,
      },
    ],
  };
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
      files: [...APP_RUNTIME_GLOBS],
      ignores: [...TEST_FILE_GLOBS, ...DYNAMIC_SQL_ADMIN_TOOLS],
      plugins: { rueda: plugin },
      rules: { 'rueda/no-dynamic-sql': 'error' },
    },
    {
      files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
      rules: goldenVectorsRules(),
    },
    {
      files: [...TEST_FILE_GLOBS],
      // La fixture « production » reste soumise au bloc général ci-dessus, malgré `test/`.
      ignores: [GOLDEN_VECTORS_PROD_FIXTURES],
      rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
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
