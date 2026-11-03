/**
 * US-019 — module PAY de bout en bout sur PostgreSQL réel, sous les rôles de production
 * (CLAUDE.md point 6 : `connectAs` exécute l'assertion L0-05 en tête de chaque test) :
 * opération enregistrée par le travailleur `money_command` (jambes des vecteurs TJ), paiement sur
 * le PSP simulé, webhooks hostiles (doublons, ordre inversé) reçus par l'API (`app_api`), traités
 * par le travailleur `webhook_ingest` ; statut final SUCCEEDED quel que soit l'ordre ; C19 : un
 * webhook FAKE quand la base est en production ne laisse aucune trace.
 * Chaque cas tourne dans chaque pays configuré (USD, PYG sans décimale).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { legVectors, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { connectAs, releaseClient } from '@rueda/db/testing';
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PgOperationRecorder,
  PgWebhookInboxStore,
  PgWebhookWorkStore,
  WebhookIngestService,
  WebhookProcessor,
  withPaymentWorker,
} from '../index.js';
import type { SqlPool } from '../index.js';
import { countryCases } from '../../../../test/support/countries.js';
import { FAKE_PROVIDER } from './fake-payment-provider.js';
import { FAKE_WEBHOOK_SECRET, fakeStack } from './fake-stack.js';

const CASES = countryCases();
const set = loadGoldenVectors();

const opened: pg.Client[] = [];
afterEach(async () => {
  for (const c of opened.splice(0)) await releaseClient(c);
});

async function open(role: 'app_api' | 'app_worker'): Promise<pg.Client> {
  const client = await connectAs(role); // assertion L0-05
  opened.push(client);
  return client;
}

/** Une connexion présentée comme un pool (une transaction à la fois). */
const asPool = (client: pg.Client): SqlPool => ({
  connect: () =>
    Promise.resolve({
      query: async <R extends Record<string, unknown>>(
        text: string,
        values?: readonly unknown[],
      ) => {
        const result = await client.query<R>(text, values as unknown[] | undefined);
        return { rows: result.rows };
      },
      release: () => undefined,
    }),
});

const publicId = (): string => `wh_${randomBytes(12).toString('hex')}`;

describe.each(CASES)('PAY de bout en bout — $country ($currency)', (c) => {
  const capture = legVectors(set, {
    kind: 'ALLOCATION',
    currency: c.currency,
    normativeOnly: true,
  }).find((v) => v.legsMinor.HOST > 0n && v.legsMinor.PLATFORM > 0n);
  if (capture === undefined) throw new Error(`aucun vecteur TJ de capture en ${c.currency}`);

  it('webhooks en double et hors d’ordre : statut SUCCEEDED, doublons écartés, événements journalisés', async () => {
    const worker = await open('app_worker');
    const api = await open('app_api');
    const hook = publicId();
    const accountId = randomUUID();
    const tripId = randomUUID();

    // compte FAKE (droit de TEST de 9400) et trip (fixture d'US-011), validés
    await worker.query('BEGIN');
    await worker.query(
      `INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id,
                                             webhook_secret_ref)
       VALUES ($1, 'FAKE', $2, 'SANDBOX', 'ACTIVE', $3, 'vault:psp/fake/webhook')`,
      [accountId, c.country, hook],
    );
    await worker.query(
      `SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, 'UTC', $7, $8)`,
      [
        tripId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        c.country,
        c.currency,
        '2031-09-01T10:00:00Z',
        '2031-09-03T10:00:00Z',
      ],
    );
    await worker.query('COMMIT');

    const stack = fakeStack({ scenario: { webhooks: { duplicate: true, reverse: true } } });
    stack.clock.now = Date.now(); // horodatage signé proche de l'heure de la base (± 5 min)
    const idem = `${tripId}:1:v1:CAPTURE:card:i1:a1`;
    const legs = { ...capture.legsMinor };

    const pool = asPool(worker);
    const operationId = await withPaymentWorker(pool, 'money_command', async (tx) => {
      const recorder = new PgOperationRecorder(tx);
      const rec = await recorder.record({
        id: randomUUID(),
        holdId: null,
        tripId,
        pspAccountId: accountId,
        method: 'CARD',
        kind: 'CAPTURE',
        purpose: 'RENT',
        amountMinor: capture.totalMinor,
        currency: c.currency,
        attemptNo: 1,
        idemPlain: idem,
        idemSent: idem,
        legs,
      });
      expect(rec.replayed).toBe(false);
      const order = await stack.provider.createHostedPayment({
        idempotencyKey: idem,
        currency: c.currency,
        method: 'CARD',
        capture: 'AUTO',
        amountMinor: capture.totalMinor,
        legs,
      });
      expect(
        await recorder.apply({
          operationId: rec.operationId,
          status: 'SUBMITTED',
          source: 'API_RESPONSE',
          rawRef: null,
          providerReference: order.providerReference,
        }),
      ).toBe('APPLIED');
      stack.psp.customerPays(order.providerReference);
      return rec.operationId;
    });

    // API : réception (app_api, commandes SECURITY DEFINER)
    const ingest = new WebhookIngestService(
      { get: (p) => (p === FAKE_PROVIDER ? stack.provider : undefined) },
      new PgWebhookInboxStore(api),
      { resolve: () => Promise.resolve(new TextEncoder().encode(FAKE_WEBHOOK_SECRET)) },
      { warn: () => undefined },
    );
    const outcomes: string[] = [];
    for (const d of stack.psp.deliverWebhooks()) {
      const r = await ingest.receive({
        provider: 'fake',
        publicWebhookId: hook,
        headers: d.headers,
        rawBody: new TextEncoder().encode(d.body),
      });
      outcomes.push(r.outcome);
      expect(r.status).toBe(200);
    }
    expect(outcomes).toEqual(['RECEIVED', 'RECEIVED', 'DUPLICATE', 'DUPLICATE']);

    // travailleur webhook_ingest : lire puis appliquer
    const report = await withPaymentWorker(pool, 'webhook_ingest', (tx) =>
      new WebhookProcessor(new PgWebhookWorkStore(tx), () => stack.provider, {
        warn: () => undefined,
      }).runOnce(),
    );
    expect(report).toMatchObject({ processed: 2, quarantined: 0, failed: 0, conflicts: 0 });

    await withPaymentWorker(pool, 'money_command', async (tx) => {
      const op = await tx.query<{ status: string; proof_type: string | null }>(
        `SELECT status, proof_type FROM core.payment_payment_operation WHERE id = $1`,
        [operationId],
      );
      expect(op.rows[0]).toEqual({ status: 'SUCCEEDED', proof_type: 'WEBHOOK_SIGNED' });
      const events = await tx.query<{ status: string; source: string; outcome: string }>(
        `SELECT status, source, outcome FROM core.payment_payment_operation_event
          WHERE operation_id = $1 ORDER BY at, id`,
        [operationId],
      );
      expect(events.rows.map((e) => `${e.status}/${e.source}/${e.outcome}`)).toEqual([
        'SUBMITTED/API_RESPONSE/APPLIED',
        'SUCCEEDED/WEBHOOK/APPLIED',
        'SUCCEEDED/POLL/DUPLICATE',
      ]);
      const leg = await tx.query<{ n: number; total: string }>(
        `SELECT count(*)::int AS n, sum(amount_minor)::text AS total
           FROM core.payment_payment_operation_leg WHERE operation_id = $1`,
        [operationId],
      );
      expect(leg.rows[0]).toEqual({ n: 4, total: capture.totalMinor.toString() });
    });
    const inbox = await withPaymentWorker(pool, 'webhook_ingest', (tx) =>
      tx.query<{ processing_status: string }>(
        `SELECT processing_status FROM core.payment_webhook_inbox WHERE psp_account_id = $1`,
        [accountId],
      ),
    );
    expect(inbox.rows.map((r) => r.processing_status)).toEqual(['PROCESSED', 'PROCESSED']);
  });

  it('C19 : base en production ⇒ webhook FAKE 404, aucune ligne', async () => {
    const worker = await open('app_worker');
    const api = await open('app_api');
    const hook = publicId();
    const accountId = randomUUID();
    await worker.query(
      `INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id,
                                             webhook_secret_ref)
       VALUES ($1, 'FAKE', $2, 'SANDBOX', 'PENDING_VALIDATION', $3, 'vault:psp/fake/webhook')`,
      [accountId, c.country, hook],
    );
    const stack = fakeStack();
    stack.clock.now = Date.now();
    const order = await stack.provider.createHostedPayment({
      idempotencyKey: `hold:${randomUUID()}:CAPTURE:a1`,
      currency: c.currency,
      method: 'CARD',
      capture: 'AUTO',
      amountMinor: capture.totalMinor,
      legs: { ...capture.legsMinor },
    });
    stack.psp.customerPays(order.providerReference);
    const ingest = new WebhookIngestService(
      { get: () => stack.provider },
      new PgWebhookInboxStore(api),
      { resolve: () => Promise.resolve(new TextEncoder().encode(FAKE_WEBHOOK_SECRET)) },
      { warn: () => undefined },
    );
    // la base « passe en production » pour cette session (test-migrations/9400)
    await api.query(`SELECT pg_catalog.set_config('app.test_deployment_env', 'production', false)`);
    for (const d of stack.psp.deliverWebhooks()) {
      const r = await ingest.receive({
        provider: 'FAKE',
        publicWebhookId: hook,
        headers: d.headers,
        rawBody: new TextEncoder().encode(d.body),
      });
      expect(r).toEqual({ status: 404, outcome: 'NOT_FOUND' });
    }
    const rows = await withPaymentWorker(asPool(worker), 'webhook_ingest', (tx) =>
      tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM core.payment_webhook_inbox WHERE psp_account_id = $1`,
        [accountId],
      ),
    );
    expect(rows.rows[0]?.n).toBe(0);
  });
});
