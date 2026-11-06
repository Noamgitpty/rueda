/**
 * US-049 — red team « concurrence », C19 côté base et démarrage (17 §6.5 points 1 et 3 ; migrations
 * 0028, 0048, 0050) sur PostgreSQL réel, sous les rôles de production (assertion L0-05 par
 * `connectAs`). Complète `concurrence-c19-static.test.ts` (contenu de l'image).
 *
 * Attaques jouées :
 * - compte PSP FAKE créé, ou compte réel converti en FAKE, quand la base est en production ;
 * - garde de démarrage trompée par une valeur de `RUEDA_ENV` inventée (casse, espaces, alias) ou par
 *   une variable `*_ADAPTER=FAKE` ;
 * - registre de production sondé par chaque nom de PSP : webhook FAKE posté sur l'URL de production ;
 * - base de production (migrations seules) : aucune trace du banc de test (schéma `test_fixture`).
 * Chaque test affirme que l'attaque est BLOQUÉE ; rouge = faille.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { connectAs, releaseClient } from '@rueda/db/testing';
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPaymentStartup, postgresPayAdapters, PRODUCTION_PROVIDERS } from '../../index.js';
import type { SqlExecutor } from '../../index.js';
import { WebhookIngestService } from '../../index.js';
import { countryCases } from '../../../../../test/support/countries.js';

const CASES = countryCases();
const LONG = 120_000;
const enc = new TextEncoder();
const opened: pg.Client[] = [];
afterEach(async () => {
  for (const c of opened.splice(0)) await releaseClient(c);
});

async function open(
  role: 'app_api' | 'app_worker',
  database: 'main' | 'production' = 'main',
): Promise<pg.Client> {
  const client = await connectAs(role, { database });
  opened.push(client);
  return client;
}

const asExecutor = (client: pg.Client): SqlExecutor => ({
  query: async <R extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
    const r = await client.query<R>(text, values as unknown[] | undefined);
    return { rows: r.rows };
  },
});

const hook = (): string => `wh_${randomBytes(12).toString('hex')}`;
const code = (error: unknown): string => (error as { code?: string }).code ?? 'SANS_CODE';

describe.each(CASES)('US-049 red team concurrence — C19 base et démarrage ($country)', (c) => {
  it(
    'RT-CONC-70 : base déclarée en production — création d’un compte FAKE, conversion d’un compte réel en FAKE, FAKE en LIVE ⇒ refusées ; aucune ligne FAKE ne subsiste',
    async () => {
      const worker = await open('app_worker');
      await worker.query('BEGIN');
      try {
        // la base « passe en production » pour cette transaction seulement (test-migrations/9500)
        await worker.query(
          `SELECT pg_catalog.set_config('app.test_deployment_env', 'production', true)`,
        );
        const attempts: [string, string, unknown[]][] = [
          [
            'INSERT FAKE SANDBOX',
            `INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id)
             VALUES ($1, 'FAKE', $2, 'SANDBOX', 'PENDING_VALIDATION', $3)`,
            [randomUUID(), c.country, hook()],
          ],
          [
            'INSERT FAKE ACTIVE',
            `INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id,
                                                   webhook_secret_ref)
             VALUES ($1, 'FAKE', $2, 'SANDBOX', 'ACTIVE', $3, 'vault:psp/fake/webhook')`,
            [randomUUID(), c.country, hook()],
          ],
          [
            'INSERT FAKE LIVE',
            `INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id,
                                                   gate_decision_ref)
             VALUES ($1, 'FAKE', $2, 'LIVE', 'ACTIVE', $3, 'porte-pay-041')`,
            [randomUUID(), c.country, hook()],
          ],
        ];
        for (const [label, sql, args] of attempts) {
          await worker.query('SAVEPOINT attempt');
          let outcome = 'ÉCRIT';
          try {
            await worker.query(sql, args);
          } catch (error) {
            outcome = code(error);
          }
          await worker.query('ROLLBACK TO SAVEPOINT attempt');
          expect(['23000', '23514'], `${label} : ${outcome}`).toContain(outcome);
        }
        // compte réel (SANDBOX) créé, puis converti en FAKE
        const real = randomUUID();
        await worker.query(
          `INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id)
           VALUES ($1, 'TILOPAY', $2, 'SANDBOX', 'PENDING_VALIDATION', $3)`,
          [real, c.country, hook()],
        );
        await worker.query('SAVEPOINT convert');
        let outcome = 'CONVERTI';
        try {
          await worker.query(
            `UPDATE core.payment_psp_account SET provider = 'FAKE' WHERE id = $1`,
            [real],
          );
        } catch (error) {
          outcome = code(error);
        }
        await worker.query('ROLLBACK TO SAVEPOINT convert');
        expect(['23000', '23514'], `conversion en FAKE : ${outcome}`).toContain(outcome);
        const guard = await worker.query<{ deployment_env: string; fake_accounts: number }>(
          'SELECT deployment_env, fake_accounts FROM core.payment_startup_guard()',
        );
        expect(guard.rows[0]).toMatchObject({
          deployment_env: 'production',
          fake_accounts: expect.any(Number),
        });
      } finally {
        await worker.query('ROLLBACK');
      }
    },
    LONG,
  );

  it(
    'RT-CONC-71 : garde de démarrage sur la base de production — toute valeur inventée de RUEDA_ENV retombe en production (jamais un autre environnement) ; *_ADAPTER=FAKE refusé ; développement / test refusés (base discordante)',
    async () => {
      const prod = await open('app_api', 'production');
      const db = asExecutor(prod);
      const invented: (string | undefined)[] = [
        undefined,
        '',
        ' ',
        'production',
        'Production',
        'PRODUCTION',
        ' production',
        'production ',
        'prod',
        'live',
        'staging',
        'preprod',
        'dev',
        'Development',
        'TEST',
        'testing',
        'development\n',
        '0',
        'false',
      ];
      for (const value of invented) {
        let environment: string | undefined;
        let refusal: string | undefined;
        try {
          environment = (
            await assertPaymentStartup({
              env: value === undefined ? {} : { RUEDA_ENV: value },
              db,
            })
          ).environment;
        } catch (error) {
          refusal = (error as { code?: string }).code;
        }
        // soit refus (discordance), soit production : jamais un environnement non production accepté
        // sur une base de production
        expect(
          refusal === 'FAKE_FORBIDDEN_IN_PRODUCTION' || environment === 'production',
          `RUEDA_ENV=${JSON.stringify(value)} → environnement ${String(environment)} / refus ${String(refusal)}`,
        ).toBe(true);
      }
      for (const [name, value] of [
        ['PSP_ADAPTER', 'FAKE'],
        ['psp_adapter', ' fake '],
        ['PAYMENT_ADAPTER', 'Fake'],
        ['KYC_ADAPTER', 'FAKE'],
      ] as const) {
        await expect(
          assertPaymentStartup({ env: { RUEDA_ENV: 'production', [name]: value }, db }),
          `${name}=${value}`,
        ).rejects.toMatchObject({ code: 'FAKE_FORBIDDEN_IN_PRODUCTION' });
        // variable absente de l'environnement explicite : pas de repli sur process.env pour contourner
        // (le démarrage ne lit que l'environnement qu'on lui donne)
      }
    },
    LONG,
  );

  it(
    'RT-CONC-72 : base de production (migrations seules) — aucun schéma ni fonction du banc de test, aucun compte FAKE ; registre de production vide : un webhook FAKE (ou de tout PSP) posté sur l’URL de production ⇒ 404 sans écriture',
    async () => {
      const prod = await open('app_api', 'production');
      const traces = await prod.query<{ nspname: string }>(
        `SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname IN ('test_fixture', 'test_support')`,
      );
      expect(traces.rows).toEqual([]);
      const fixtures = await prod.query<{ proname: string }>(
        `SELECT proname FROM pg_catalog.pg_proc WHERE proname ~ '^(l0_|us0[0-9]{2}_|hold_force_write|rls_insert|register_vehicle|place_hold)'`,
      );
      expect(fixtures.rows).toEqual([]);
      const guard = await prod.query<{ deployment_env: string; fake_accounts: number }>(
        'SELECT deployment_env, fake_accounts FROM core.payment_startup_guard()',
      );
      expect(guard.rows[0]).toEqual({ deployment_env: 'production', fake_accounts: 0 });

      expect(PRODUCTION_PROVIDERS).toEqual([]);
      const adapters = await postgresPayAdapters(asExecutor(prod), { RUEDA_ENV: 'production' });
      for (const provider of [
        'FAKE',
        'fake',
        'Fake',
        'TILOPAY',
        'DLOCAL',
        'BAC',
        'PAGUELOFACIL',
        'BANCARD_VPOS',
        'UPAY',
        'EBANX',
      ]) {
        expect(adapters.webhooks.registry.get(provider.toUpperCase()), provider).toBeUndefined();
      }
      expect(await adapters.webhooks.secrets.resolve('vault:psp/fake/webhook')).toBeNull();
      const ingest = new WebhookIngestService(
        adapters.webhooks.registry,
        adapters.webhooks.store,
        adapters.webhooks.secrets,
        adapters.webhooks.log,
      );
      for (const provider of ['FAKE', 'fake', 'TILOPAY']) {
        const r = await ingest.receive({
          provider,
          publicWebhookId: hook(),
          headers: { 'fake-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` },
          rawBody: enc.encode(
            '{"id":"evt-prod-1","type":"order.paid","reference":"x","status":"SUCCEEDED"}',
          ),
        });
        expect(r, provider).toEqual({ status: 404, outcome: 'UNKNOWN_PROVIDER' });
      }
      const inbox = await prod
        .query<{ n: number }>(`SELECT count(*)::int AS n FROM core.payment_webhook_inbox`)
        .then(
          (r) => r.rows[0]?.n,
          (e: unknown) => code(e),
        );
      // soit 0 ligne, soit la table n'est pas lisible par app_api : aucune trace dans les deux cas
      expect(inbox === 0 || inbox === '42501').toBe(true);
    },
    LONG,
  );

  it(
    'RT-CONC-73 : démarrage refusé si un compte FAKE existe alors que la base est (ou paraît) en production',
    async () => {
      const worker = await open('app_worker');
      await worker.query('BEGIN');
      try {
        // compte FAKE créé hors production (environnement de test) …
        await worker.query(
          `INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id)
           VALUES ($1, 'FAKE', $2, 'SANDBOX', 'PENDING_VALIDATION', $3)`,
          [randomUUID(), c.country, hook()],
        );
        // … puis la base est déclarée en production : le démarrage de l'API et du travailleur échoue
        await worker.query(
          `SELECT pg_catalog.set_config('app.test_deployment_env', 'production', true)`,
        );
        await expect(
          assertPaymentStartup({ env: { RUEDA_ENV: 'production' }, db: asExecutor(worker) }),
        ).rejects.toMatchObject({ code: 'FAKE_FORBIDDEN_IN_PRODUCTION' });
        // application de test branchée sur cette base de production : discordance refusée
        await expect(
          assertPaymentStartup({ env: { RUEDA_ENV: 'test' }, db: asExecutor(worker) }),
        ).rejects.toMatchObject({ code: 'FAKE_FORBIDDEN_IN_PRODUCTION' });
      } finally {
        await worker.query('ROLLBACK');
      }
    },
    LONG,
  );
});
