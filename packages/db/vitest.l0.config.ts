import { configDefaults, defineConfig } from 'vitest/config';
import { databaseTestOptions } from './vitest.shared.ts';

// pnpm test:l0 — preuves L0 (17 §11) sous les rôles de production.
//
// Budget de connexions (ADR-056, « Budget de connexions du banc ») : L0-02 ouvre une connexion
// directe par pose concurrente (100 en CI). Il tourne donc **seul**, dans un second groupe
// (`sequence.groupOrder: 1`, un seul fichier à la fois), après la fin de tous les autres fichiers
// L0, au lieu de partager `max_connections` avec eux. Le banc reste unique : le `globalSetup` est
// celui de la racine, exécuté une fois ; les projets héritent de ce qu'il fournit.
// US-024 : la conversion gardée lance la tâche d'expiration et les balayages, qui portent sur toute la
// base ; ses preuves tournent donc aussi seules, après les autres fichiers (aucun hold d'un fichier en
// cours n'est touché).
// US-025 : le fuzz C11 (et l'oracle C12) a sa propre configuration (`vitest.c11.config.ts`,
// `pnpm --filter @rueda/db test:c11`) et son propre job de CI, en parallèle de celui-ci (ADR-068).
const ISOLATED = ['test/l0/l0-02-concurrency.test.ts', 'test/l0/l0-us024-conversion.test.ts'];
const C11 = ['test/l0/l0-c11-fuzz.test.ts'];
// US-049 : les attaques de la red team (test/redteam/<axe>/) tournent seules, après tous les autres
// fichiers (le hold et la conversion lancent des balayages sur toute la base), un fichier à la fois.
const REDTEAM = ['test/redteam/**/*.test.ts'];

export default defineConfig({
  test: {
    ...databaseTestOptions,
    projects: [
      {
        extends: true,
        test: {
          name: 'l0',
          include: ['test/l0/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...ISOLATED, ...C11],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'l0-concurrence',
          include: ISOLATED,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: 'l0-redteam',
          include: REDTEAM,
          fileParallelism: false,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
