/**
 * test:int — adaptateur PostgreSQL du port d'authentification, sur la base jetable du banc de
 * @rueda/db, connexion directe sous app_api (assertion L0-05 par connectAs, à chaque test) :
 * - contrat AuthStore (le même que celui du FAKE) ;
 * - scénarios HTTP de US-010, dont le critère 2 (session révoquée => 401) de bout en bout ;
 * - contrôle de démarrage : refus d'une connexion qui n'est pas app_api.
 */
import { connectAs, connectForNegativeRoleTest, releaseClient } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { authHttpScenarios } from '../testing/auth-http-scenarios.js';
import { authStoreContract } from '../testing/auth-store-contract.js';
import { assertApiDatabaseRole, PgAuthStore } from './pg-auth-store.js';
import { postgresIamAdapters } from './production.js';

const pgHarness = async () => {
  const client: pg.Client = await connectAs('app_api');
  return { store: new PgAuthStore(client), release: () => releaseClient(client) };
};

authStoreContract('PostgreSQL (app_api)', pgHarness);
authHttpScenarios('PostgreSQL (app_api)', pgHarness);

describe('démarrage de l’API (US-010)', () => {
  it('app_api : accepté ; les adaptateurs de production sont PostgreSQL', async () => {
    const client = await connectAs('app_api');
    try {
      await expect(assertApiDatabaseRole(client)).resolves.toBeUndefined();
      const adapters = await postgresIamAdapters(client);
      expect(adapters.store).toBeInstanceOf(PgAuthStore);
    } finally {
      await releaseClient(client);
    }
  });

  it('app_worker ou migrator : refus de démarrer', async () => {
    const worker = await connectAs('app_worker');
    try {
      await expect(assertApiDatabaseRole(worker)).rejects.toThrow(/app_api/);
    } finally {
      await releaseClient(worker);
    }
    const migrator = await connectForNegativeRoleTest('migrator');
    try {
      await expect(assertApiDatabaseRole(migrator)).rejects.toThrow(/app_api/);
    } finally {
      await migrator.end();
    }
  });

  it('une erreur de la base ne transporte ni message du serveur ni paramètre', async () => {
    const client = await connectAs('app_worker'); // sans EXECUTE sur les commandes IAM
    try {
      const store = new PgAuthStore(client);
      const secret = Buffer.alloc(32, 7);
      const error = await store.resolveSession(secret).catch((e: unknown) => e);
      expect(error).toMatchObject({ name: 'AuthStoreError', sqlstate: '42501' });
      expect(String((error as Error).message)).not.toContain(secret.toString('hex'));
      expect((error as Error).message).not.toMatch(/permission|denied|refus/i);
    } finally {
      await releaseClient(client);
    }
  });
});
