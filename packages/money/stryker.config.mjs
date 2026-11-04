// @ts-check
/**
 * Mutation de `@rueda/money` (US-042, ADR-076) : README.md, section « Tests de mutation ».
 * `pnpm --filter @rueda/money test:mutation` (Python 3 requis : la suite rejouée compare aussi le
 * moteur aux oracles de docs/specs/tools/).
 */
export default {
  testRunner: 'vitest',
  // `related: false` : chaque mutant rejoue les tests qui le couvrent (perTest), sans graphe Vite.
  vitest: { configFile: 'vitest.mutation.config.ts', related: false },
  plugins: ['@stryker-mutator/vitest-runner'],
  // Code de production du paquet : primitives et moteur de règlement. Le harnais des vecteurs
  // dorés (src/golden-vectors/, réservé aux tests) est hors périmètre (ADR-076).
  mutate: ['src/*.ts', 'src/settlement/*.ts', '!src/index.ts', '!src/settlement/index.ts'],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'json'],
  // coverage/ est ignoré par git, ESLint et Prettier.
  jsonReporter: { fileName: 'coverage/mutation/mutation.json' },
  // Le bac à sable doit être à deux niveaux de la racine : les tests lisent
  // docs/specs/tools/golden_vectors.json par un chemin relatif (../../../../).
  tempDirName: '../../coverage',
  concurrency: 4,
  // Seuil bloquant 80 % (19 US-042, PROPOSÉ) ; ADR-076 justifie les valeurs.
  thresholds: { high: 95, low: 90, break: 80 },
};
