/**
 * Fichier `setupFiles` des suites `test:int` et `test:l0` : chaque test doit avoir exécuté au
 * moins une assertion L0-05 (`connectAs`, `withRole` ou `assertProductionRole`), sinon il échoue.
 * Garde-fou contre un test qui oublierait de tourner sous un rôle de production.
 */
import { afterEach, beforeEach } from 'vitest';
import { resetRoleAssertionCount, roleAssertionCount } from './connections.ts';

beforeEach(() => {
  resetRoleAssertionCount();
});

afterEach((context) => {
  if (context.task.result?.state === 'fail') return;
  if (roleAssertionCount() === 0) {
    throw new Error(
      `L0-05 : le test « ${context.task.name} » n'a exécuté aucune assertion de rôle ` +
        '(utiliser withRole / connectAs de @rueda/db/testing)',
    );
  }
});
