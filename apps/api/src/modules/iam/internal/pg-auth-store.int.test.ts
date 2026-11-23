/**
 * test:int — adaptateur PostgreSQL du port d'authentification, sur la base jetable du banc de
 * @rueda/db, connexion directe sous app_api (assertion L0-05 par connectAs, à chaque test) :
 * - contrat AuthStore (le même que celui du FAKE) ;
 * - scénarios HTTP de US-010, dont le critère 2 (session révoquée => 401) de bout en bout ;
 * - contrôle de démarrage : refus d'une connexion qui n'est pas app_api ;
 * - US-410 (ADR-205) : ouverture signée sous la clé de TEST publique installée par la fixture 9901 ;
 *   sans clé, ou sous une autre clé, aucune session n'est ouverte (fail-closed).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  connectAs,
  connectForNegativeRoleTest,
  releaseClient,
  TEST_SESSION_OPEN_KEY,
} from '@rueda/db/testing';
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
  return {
    store: new PgAuthStore(client, { sessionOpenKey: TEST_SESSION_OPEN_KEY }),
    release: () => releaseClient(client),
  };
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
      // clé mal formée : refus de démarrer, sans afficher la valeur (US-410)
      const bad = `${'ab'.repeat(31)}zz`;
      const error = await postgresIamAdapters(client, { RUEDA_SESSION_OPEN_KEY: bad }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(String(error)).toMatch(/RUEDA_SESSION_OPEN_KEY/);
      expect(String(error)).not.toContain(bad);
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

describe('ouverture de session signée (US-410, ADR-205)', () => {
  const account = async (client: pg.Client): Promise<string> => {
    const userId = randomUUID();
    const b64 = (n: number) => randomBytes(n).toString('base64').replace(/=+$/, '');
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Test', 'es', $4, $5, 86400, NULL, NULL, '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]'::jsonb, false) AS ok`,
      [
        userId,
        `us410-${userId}@example.test`,
        `$argon2id$v=19$m=65536,t=3,p=1$${b64(16)}$${b64(32)}`,
        randomUUID(),
        randomBytes(32),
      ],
    );
    expect(rows[0]?.ok).toBe(true);
    return userId;
  };

  const open = (store: PgAuthStore, userId: string, tokenHash: Buffer) =>
    store.openSession({
      sessionId: randomUUID(),
      userId,
      tokenHash,
      ttlS: 3600,
      mfaLevel: 'NONE',
      ip: null,
      userAgent: 'vitest',
    });

  it('clé installée : session ouverte et résolue ; sans clé ou sous une autre clé : refus, aucune session', async () => {
    const client = await connectAs('app_api');
    try {
      const userId = await account(client);
      const good = new PgAuthStore(client, { sessionOpenKey: TEST_SESSION_OPEN_KEY });
      const okHash = randomBytes(32);
      expect(await open(good, userId, okHash)).toBeInstanceOf(Date);
      expect((await good.resolveSession(okHash))?.userId).toBe(userId);

      const keyless = new PgAuthStore(client);
      const noKeyHash = randomBytes(32);
      await expect(open(keyless, userId, noKeyHash)).rejects.toMatchObject({
        name: 'AuthStoreError',
        sqlstate: undefined,
      });
      expect(await good.resolveSession(noKeyHash)).toBeNull();

      const forged = new PgAuthStore(client, {
        sessionOpenKey: createHash('sha256').update('us410 autre clé de test', 'utf8').digest(),
      });
      const forgedHash = randomBytes(32);
      await expect(open(forged, userId, forgedHash)).rejects.toMatchObject({
        name: 'AuthStoreError',
        sqlstate: '42501',
      });
      expect(await good.resolveSession(forgedHash)).toBeNull();
    } finally {
      await releaseClient(client);
    }
  });
});
