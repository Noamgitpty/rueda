/**
 * Composition de PRODUCTION du module PAY (revue qa US-019, 2e tour, n° 3) : `postgresPayAdapters`
 * est appelée comme dans main.ts, avec un exécuteur SQL qui enregistre chaque requête.
 * - registre des PSP : aucun fournisseur, FAKE compris (lot C : connecteurs réels seulement) ;
 * - coffre des secrets : absent avant US-003 (`null`) ;
 * - un POST de webhook FAKE sur l'application Nest de production répond 404 sans AUCUNE requête
 *   SQL (seule la garde de démarrage a été lue).
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import { PayWebhookModule } from './pay-webhook.module.js';
import type { SqlExecutor } from './pg-stores.js';
import { postgresPayAdapters, PRODUCTION_PROVIDERS } from './production.js';

const opened: INestApplication[] = [];
afterEach(async () => {
  for (const app of opened.splice(0)) await app.close();
});

function recordingDb(): { db: SqlExecutor; queries: string[] } {
  const queries: string[] = [];
  const db: SqlExecutor = {
    query: <R extends Record<string, unknown>>(text: string) => {
      queries.push(text);
      return Promise.resolve({
        rows: (/payment_startup_guard/.test(text)
          ? [{ deployment_env: 'production', fake_accounts: 0 }]
          : []) as unknown as R[],
      });
    },
  };
  return { db, queries };
}

describe('postgresPayAdapters (composition de production)', () => {
  it('registre sans aucun fournisseur (FAKE compris) ; coffre absent ⇒ null', async () => {
    const { db, queries } = recordingDb();
    const adapters = await postgresPayAdapters(db, { RUEDA_ENV: 'production' });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/core\.payment_startup_guard\(\)/);
    expect(PRODUCTION_PROVIDERS).toEqual([]);
    for (const p of ['FAKE', 'fake', 'TILOPAY', 'DLOCAL', 'BANCARD_VPOS']) {
      expect(adapters.webhooks.registry.get(p), p).toBeUndefined();
    }
    expect(await adapters.webhooks.secrets.resolve('vault:psp/fake/webhook')).toBeNull();
  });

  it('POST /webhooks/FAKE/… sur l’application de production ⇒ 404, aucune requête SQL', async () => {
    const { db, queries } = recordingDb();
    const adapters = await postgresPayAdapters(db, { RUEDA_ENV: 'production' });
    const startup = queries.length;
    const app = await NestFactory.create(PayWebhookModule.register(adapters.webhooks), {
      rawBody: true,
      logger: false,
    });
    opened.push(app);
    await app.listen(0, '127.0.0.1');
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    for (const provider of ['FAKE', 'fake']) {
      const res = await fetch(`${url}/webhooks/${provider}/wh_fake_0123456789abcdef`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'fake-signature': `t=1,v1=${'0'.repeat(64)}`,
        },
        body: '{"id":"evt_1","type":"payment.captured","reference":"fk_tx_000001","status":"SUCCEEDED"}',
      });
      expect(res.status, provider).toBe(404);
    }
    expect(queries).toHaveLength(startup);
  });

  it('garde de démarrage : compte FAKE en base de production ⇒ refus', async () => {
    const db: SqlExecutor = {
      query: <R extends Record<string, unknown>>() =>
        Promise.resolve({
          rows: [{ deployment_env: 'production', fake_accounts: 1 }] as unknown as R[],
        }),
    };
    await expect(postgresPayAdapters(db, { RUEDA_ENV: 'production' })).rejects.toMatchObject({
      code: 'FAKE_FORBIDDEN_IN_PRODUCTION',
    });
  });
});
