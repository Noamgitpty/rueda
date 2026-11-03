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
const ISOLATED = ['test/l0/l0-02-concurrency.test.ts', 'test/l0/l0-us024-conversion.test.ts'];

export default defineConfig({
  test: {
    ...databaseTestOptions,
    projects: [
      {
        extends: true,
        test: {
          name: 'l0',
          include: ['test/l0/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...ISOLATED],
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
    ],
  },
});
