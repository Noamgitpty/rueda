/**
 * US-049 — red team « concurrence », webhooks FAKE sur PostgreSQL réel (19 US-049 critère 4 ;
 * 17 §4.4 points 1 à 8 ; C6, C13, C19) : webhook rejoué, concurrent, dans le désordre, tardif et
 * falsifié (signature fausse, signature valide d'un autre événement, corps modifié après
 * signature, horodatage hors fenêtre de ± 5 min contrôlé à l'heure de la base).
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée.
 * Sous les rôles de production (`connectAs` : assertion L0-05 en tête) : réception par `app_api`,
 * traitement par `app_worker` / `webhook_ingest`. En USD (PA) et en PYG (PY) ; montants et jambes
 * des vecteurs TJ de docs/specs/08 (`@rueda/money/golden-vectors`), jamais du code testé.
 * Placé dans le module PAY (dossier `testing/redteam/`, hors de l'image de production) pour
 * respecter la règle `rueda/module-boundaries`.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { FAKE_SIGNATURE_HEADER, fakeSignature } from '@rueda/fake-adapters';
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
} from '../../index.js';
import type { SqlPool } from '../../index.js';
import { countryCases } from '../../../../../test/support/countries.js';
import { FAKE_WEBHOOK_SECRET, fakeStack } from '../fake-stack.js';
import type { FakeStack } from '../fake-stack.js';

const CASES = countryCases();
/**
 * Nom du PSP de ces scènes. Un seul compte `ACTIVE` par (PSP, pays, environnement) peut exister
 * (`psp_account_one_active`) et `pg-stores.int.test.ts` laisse définitivement un compte FAKE actif :
 * ces scènes utilisent donc le nom `EBANX` (jamais utilisé ailleurs), servi par le même PSP simulé,
 * et suspendent leur compte à la fin de chaque test.
 */
const PSP_NAME = 'EBANX';
/** Second nom, pour les scènes qui ont besoin de deux comptes actifs du même pays (RT-CONC-56). */
const PSP_NAME_2 = 'BAC';
const accountsToSuspend: string[] = [];

/** Suspend le compte d'une scène terminée (libère l'unicité `psp_account_one_active`). */
async function retire(s: {
  readonly worker: pg.Client;
  readonly accountId: string;
}): Promise<void> {
  await s.worker.query(`UPDATE core.payment_psp_account SET status = 'SUSPENDED' WHERE id = $1`, [
    s.accountId,
  ]);
  const i = accountsToSuspend.indexOf(s.accountId);
  if (i >= 0) accountsToSuspend.splice(i, 1);
}
const set = loadGoldenVectors();
const LONG = 120_000;
const enc = new TextEncoder();

const opened: pg.Client[] = [];
afterEach(async () => {
  // d'abord suspendre les comptes ACTIVE créés (sinon une scène en échec bloquerait toutes les suivantes)
  if (accountsToSuspend.length > 0) {
    const cleaner = await connectAs('app_worker');
    try {
      for (const id of accountsToSuspend.splice(0)) {
        await cleaner.query(
          `UPDATE core.payment_psp_account SET status = 'SUSPENDED' WHERE id = $1`,
          [id],
        );
      }
    } finally {
      await releaseClient(cleaner);
    }
  }
  for (const c of opened.splice(0)) await releaseClient(c).catch(() => undefined);
});

async function open(role: 'app_api' | 'app_worker' | 'app_anon'): Promise<pg.Client> {
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

interface Scene {
  readonly c: ReturnType<typeof countryCases>[number];
  readonly api: pg.Client;
  readonly worker: pg.Client;
  readonly stack: FakeStack;
  readonly hook: string;
  readonly accountId: string;
  readonly operationId: string;
  readonly reference: string;
  readonly idem: string;
  readonly psp: string;
  /** Service de réception sur la connexion `app_api` donnée. */
  ingestOn(api: pg.Client): WebhookIngestService;
}

const secrets = { resolve: () => Promise.resolve(enc.encode(FAKE_WEBHOOK_SECRET)) };

/** Compte FAKE, trip, opération SUBMITTED (jambes d'un vecteur TJ), ordre chez le PSP simulé. */
async function scene(c: Scene['c'], psp: string = PSP_NAME): Promise<Scene> {
  const capture = legVectors(set, {
    kind: 'ALLOCATION',
    currency: c.currency,
    normativeOnly: true,
  }).find((v) => v.legsMinor.HOST > 0n && v.legsMinor.PLATFORM > 0n);
  if (capture === undefined) throw new Error(`aucun vecteur TJ de capture en ${c.currency}`);
  const worker = await open('app_worker');
  const api = await open('app_api');
  const hook = `wh_${randomBytes(12).toString('hex')}`;
  const accountId = randomUUID();
  const tripId = randomUUID();
  await worker.query('BEGIN');
  await worker.query(
    `INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id,
                                           webhook_secret_ref)
     VALUES ($1, $4, $2, 'SANDBOX', 'ACTIVE', $3, 'vault:psp/fake/webhook')`,
    [accountId, c.country, hook, psp],
  );
  await worker.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, 'UTC', $7, $8)`, [
    tripId,
    randomUUID(),
    randomUUID(),
    randomUUID(),
    c.country,
    c.currency,
    '2031-09-01T10:00:00Z',
    '2031-09-03T10:00:00Z',
  ]);
  await worker.query('COMMIT');
  accountsToSuspend.push(accountId);

  const stack = fakeStack();
  stack.clock.now = Date.now(); // l'horodatage signé suit l'heure de la base (± 5 min)
  const idem = `${tripId}:1:v1:CAPTURE:card:i1:a1`;
  const operationId = await withPaymentWorker(asPool(worker), 'payment_command', async (tx) => {
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
      legs: { ...capture.legsMinor },
    });
    return rec.operationId;
  });
  const order = await stack.provider.createHostedPayment({
    idempotencyKey: idem,
    currency: c.currency,
    method: 'CARD',
    capture: 'AUTO',
    amountMinor: capture.totalMinor,
    legs: { ...capture.legsMinor },
  });
  await withPaymentWorker(asPool(worker), 'payment_command', (tx) =>
    new PgOperationRecorder(tx).apply({
      operationId,
      status: 'SUBMITTED',
      source: 'API_RESPONSE',
      rawRef: null,
      providerReference: order.providerReference,
    }),
  );
  const ingestOn = (client: pg.Client): WebhookIngestService =>
    new WebhookIngestService(
      { get: (p) => (p === PSP_NAME || p === PSP_NAME_2 ? stack.provider : undefined) },
      new PgWebhookInboxStore(client),
      secrets,
      { warn: () => undefined },
    );
  return {
    c,
    api,
    worker,
    stack,
    hook,
    accountId,
    operationId,
    reference: order.providerReference,
    idem,
    psp,
    ingestOn,
  };
}

/** Corps d'un événement du PSP simulé (même forme que `FakePsp`), identifiant et statut choisis. */
const eventBody = (s: Scene, id: string, status: string, type = 'order.paid'): string =>
  JSON.stringify({
    id,
    type,
    reference: s.reference,
    merchant_reference: s.idem,
    status,
    amount_minor: '1',
    currency: s.c.currency,
    method: 'CARD',
    occurred_at: new Date().toISOString(),
  });

/** En-têtes signés (secret du compte) avec un horodatage décalé de `skewS` secondes. */
const signed = (body: string, skewS = 0): Record<string, string> => ({
  'content-type': 'application/json',
  [FAKE_SIGNATURE_HEADER]: fakeSignature(
    FAKE_WEBHOOK_SECRET,
    Math.floor(Date.now() / 1000) + skewS,
    body,
  ),
});

const receive = (
  s: Scene,
  body: string,
  headers: Record<string, string>,
  ingest: WebhookIngestService = s.ingestOn(s.api),
) =>
  ingest.receive({
    provider: s.psp.toLowerCase(),
    publicWebhookId: s.hook,
    headers,
    rawBody: enc.encode(body),
  });

/** Traitement par le travailleur `webhook_ingest`, avec ou sans lecture chez le PSP. */
const runProcessor = (s: Scene, worker: pg.Client = s.worker, readPsp = true) =>
  withPaymentWorker(asPool(worker), 'webhook_ingest', (tx) =>
    new WebhookProcessor(
      new PgWebhookWorkStore(tx),
      () => (readPsp ? s.stack.provider : undefined),
      { warn: () => undefined },
    ).runOnce(),
  );

const operationStatus = (s: Scene) =>
  withPaymentWorker(asPool(s.worker), 'payment_command', async (tx) => {
    const op = await tx.query<{ status: string; proof_type: string | null }>(
      `SELECT status, proof_type FROM core.payment_payment_operation WHERE id = $1`,
      [s.operationId],
    );
    const ev = await tx.query<{ line: string }>(
      `SELECT status || '/' || source || '/' || outcome AS line
         FROM core.payment_payment_operation_event WHERE operation_id = $1 ORDER BY at, id`,
      [s.operationId],
    );
    return {
      status: op.rows[0]?.status,
      proof: op.rows[0]?.proof_type,
      events: ev.rows.map((r) => r.line),
    };
  });

const inboxRows = (s: Scene) =>
  withPaymentWorker(asPool(s.worker), 'webhook_ingest', async (tx) => {
    const r = await tx.query<{
      processing_status: string;
      signature_valid: boolean;
      has_events: boolean;
      error: string | null;
    }>(
      `SELECT processing_status, signature_valid, normalized_events IS NOT NULL AS has_events, error
         FROM core.payment_webhook_inbox WHERE psp_account_id = $1 ORDER BY received_at, id`,
      [s.accountId],
    );
    return r.rows;
  });

/** Livraisons du PSP simulé après un paiement client réel chez lui. */
function paidDeliveries(
  s: Scene,
): { eventId: string; body: string; headers: Record<string, string> }[] {
  s.stack.psp.customerPays(s.reference);
  return s.stack.psp.deliverWebhooks().map((d) => ({
    eventId: d.eventId,
    body: d.body,
    headers: d.headers as Record<string, string>,
  }));
}

describe.each(CASES)('US-049 red team concurrence — webhooks FAKE ($country, $currency)', (c) => {
  it(
    'RT-CONC-50 : signature fausse, signature valide d’un autre événement, corps modifié après signature, horodatage altéré ⇒ 401 REJECTED_SIGNATURE, aucun effet sur l’opération',
    async () => {
      const s = await scene(c);
      // un corps neuf par tentative : un même corps rejeté deux fois renvoie DUPLICATE (voir RT-CONC-58)
      let n = 0;
      const fresh = (status = 'SUCCEEDED'): string =>
        eventBody(s, `evt-forged-${(n += 1)}`, status);
      const mac = (body: string, skew = 0): string =>
        /v1=([0-9a-f]{64})/.exec(signed(body, skew)[FAKE_SIGNATURE_HEADER] ?? '')?.[1] ?? '';
      const ts = (): number => Math.floor(Date.now() / 1000);
      const attempts: [string, string, Record<string, string>][] = [];
      const add = (label: string, body: string, headers: Record<string, string>): void => {
        attempts.push([label, body, headers]);
      };
      add('aucun en-tête de signature', fresh(), { 'content-type': 'application/json' });
      add('signature illisible', fresh(), { [FAKE_SIGNATURE_HEADER]: 'n’importe quoi' });
      const wrongSecret = fresh();
      add('bon format, mauvais secret', wrongSecret, {
        [FAKE_SIGNATURE_HEADER]: fakeSignature('autre-secret', ts(), wrongSecret),
      });
      // signature valide d'un AUTRE événement : corps B, en-tête signé pour A
      const bodyA = fresh();
      add(
        'signature valide d’un AUTRE événement (corps B, en-tête de A)',
        fresh('FAILED'),
        signed(bodyA),
      );
      const tail = fresh();
      add('corps allongé après signature', `${tail} `, signed(tail));
      const flip = fresh();
      add('statut modifié après signature', flip.replace('SUCCEEDED', 'FAILED'), signed(flip));
      const ref = fresh();
      add(
        'référence modifiée après signature',
        ref.replace(s.reference, 'fk_ord_999999'),
        signed(ref),
      );
      const skewed = fresh();
      add('horodatage de l’en-tête altéré, même MAC', skewed, {
        [FAKE_SIGNATURE_HEADER]: `t=${ts() + 1},v1=${mac(skewed)}`,
      });
      const upper = fresh();
      add('MAC en majuscules', upper, {
        [FAKE_SIGNATURE_HEADER]: `t=${ts()},v1=${mac(upper).toUpperCase()}`,
      });
      const cut = fresh();
      add('MAC tronqué', cut, { [FAKE_SIGNATURE_HEADER]: `t=${ts()},v1=${mac(cut).slice(0, 62)}` });
      add('corps vide', '', signed(fresh()));
      for (const [label, body, headers] of attempts) {
        const r = await receive(s, body, headers);
        expect(r, label).toEqual({ status: 401, outcome: 'REJECTED_SIGNATURE' });
      }
      // le traitement ne trouve rien à appliquer : l'opération reste SUBMITTED, aucun événement de statut
      await runProcessor(s);
      const after = await operationStatus(s);
      expect(after.status).toBe('SUBMITTED');
      expect(after.proof).toBeNull();
      expect(after.events).toEqual(['SUBMITTED/API_RESPONSE/APPLIED']);
      // chaque rejet est tracé, sans événement normalisé ni signature valide
      const rows = await inboxRows(s);
      expect(rows.every((r) => r.processing_status === 'REJECTED_SIGNATURE')).toBe(true);
      expect(rows.some((r) => r.signature_valid || r.has_events)).toBe(false);
    },
    LONG,
  );

  it(
    'RT-CONC-51 : un faux envoyé avant l’événement légitime ne le « consomme » pas (pas de DUPLICATE) ; le légitime est accepté une fois, puis ses rejeux sont DUPLICATE',
    async () => {
      const s = await scene(c);
      const [legit] = paidDeliveries(s);
      if (legit === undefined) throw new Error('aucune livraison du PSP simulé');
      const forgedHeaders = {
        [FAKE_SIGNATURE_HEADER]: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
      };
      expect((await receive(s, legit.body, forgedHeaders)).outcome).toBe('REJECTED_SIGNATURE');
      expect((await receive(s, legit.body, legit.headers)).outcome).toBe('RECEIVED');
      expect((await receive(s, legit.body, legit.headers)).outcome).toBe('DUPLICATE');
      await runProcessor(s);
      expect((await operationStatus(s)).status).toBe('SUCCEEDED');
    },
    LONG,
  );

  it(
    'RT-CONC-58 : un webhook falsifié rejoué à l’identique ne reçoit jamais un succès (2xx) : 401 à chaque envoi, sans effet',
    async () => {
      const s = await scene(c);
      const body = eventBody(s, 'evt-forged-replay', 'SUCCEEDED');
      const headers = {
        [FAKE_SIGNATURE_HEADER]: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
      };
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) statuses.push((await receive(s, body, headers)).status);
      expect(statuses, 'statuts HTTP renvoyés au même faux webhook').toEqual([401, 401, 401]);
      await runProcessor(s);
      expect((await operationStatus(s)).status).toBe('SUBMITTED');
    },
    LONG,
  );

  it(
    'RT-CONC-52 : horodatage signé hors de ± 5 min (heure de la base) ⇒ QUARANTINED, jamais cru sur parole : une revendication SUCCEEDED que le PSP dément ne paie rien ; dans la fenêtre ⇒ RECEIVED',
    async () => {
      const s = await scene(c);
      // l'ordre n'est PAS payé chez le PSP : toute revendication SUCCEEDED est fausse
      const plan: [string, number, string][] = [
        ['evt-in-1', -290, 'RECEIVED'],
        ['evt-in-2', 290, 'RECEIVED'],
        ['evt-in-3', 0, 'RECEIVED'],
        ['evt-out-1', -360, 'QUARANTINED'],
        ['evt-out-2', 360, 'QUARANTINED'],
        ['evt-out-3', -86_400, 'QUARANTINED'],
        ['evt-out-4', 31_536_000, 'QUARANTINED'],
      ];
      for (const [id, skew, expected] of plan) {
        const body = eventBody(s, id, 'SUCCEEDED');
        const r = await receive(s, body, signed(body, skew));
        expect(r, `${id} (${skew} s)`).toEqual({ status: 200, outcome: expected });
      }
      const rows = await inboxRows(s);
      expect(rows.filter((r) => r.processing_status === 'QUARANTINED')).toHaveLength(4);
      await runProcessor(s, s.worker, true);
      const after = await operationStatus(s);
      expect(after.status, 'revendication fausse acceptée').not.toBe('SUCCEEDED');
      expect(after.proof).not.toBe('WEBHOOK_SIGNED');
    },
    LONG,
  );

  it(
    'RT-CONC-53 : événement hors fenêtre traité SANS lecture possible chez le PSP ⇒ non appliqué (17 §4.4 point 2 : « QUARANTINED et déclenche getOperation »)',
    async () => {
      const s = await scene(c);
      const body = eventBody(s, 'evt-stale-1', 'SUCCEEDED');
      expect(await receive(s, body, signed(body, -600))).toEqual({
        status: 200,
        outcome: 'QUARANTINED',
      });
      // aucun adaptateur du compte disponible (panne, secret introuvable, lecture refusée)
      await runProcessor(s, s.worker, false);
      const after = await operationStatus(s);
      expect(after.status, 'un horodatage périmé a servi de preuve de paiement').toBe('SUBMITTED');
      expect(after.proof).toBeNull();
    },
    LONG,
  );

  it(
    'RT-CONC-54 : le même webhook légitime livré 8 fois en même temps ⇒ exactement un RECEIVED, 7 DUPLICATE ; deux travailleurs en même temps ⇒ un seul traitement, un seul statut appliqué',
    async () => {
      const s = await scene(c);
      const [legit] = paidDeliveries(s);
      if (legit === undefined) throw new Error('aucune livraison du PSP simulé');
      const clients = await Promise.all(Array.from({ length: 8 }, () => open('app_api')));
      const outcomes = await Promise.all(
        clients.map((client) => receive(s, legit.body, legit.headers, s.ingestOn(client))),
      );
      const tally: Record<string, number> = {};
      for (const o of outcomes) {
        expect(o.status).toBe(200);
        tally[o.outcome] = (tally[o.outcome] ?? 0) + 1;
      }
      expect(tally).toEqual({ RECEIVED: 1, DUPLICATE: 7 });

      const w2 = await open('app_worker');
      const reports = await Promise.all([runProcessor(s, s.worker), runProcessor(s, w2)]);
      expect(reports.reduce((n, r) => n + r.processed, 0)).toBe(1);
      const after = await operationStatus(s);
      expect(after.status).toBe('SUCCEEDED');
      expect(['WEBHOOK_SIGNED', 'POLL']).toContain(after.proof);
      expect(
        after.events.filter((e) => e.endsWith('/APPLIED') && e.startsWith('SUCCEEDED')),
      ).toHaveLength(1);
      // un rejeu tardif, bien après le traitement, reste DUPLICATE et ne change rien
      expect((await receive(s, legit.body, legit.headers)).outcome).toBe('DUPLICATE');
      await runProcessor(s);
      expect(await operationStatus(s)).toEqual(after);
    },
    LONG,
  );

  it(
    'RT-CONC-55 : désordre et tardif — SUCCEEDED, SUBMITTED retardé, FAILED contradictoire, dans les deux ordres ⇒ SUCCEEDED final (le PSP fait foi) ; sans lecture du PSP, un terminal ne régresse jamais',
    async () => {
      for (const order of [
        ['ok', 'late', 'bad'],
        ['bad', 'late', 'ok'],
        ['late', 'bad', 'ok'],
      ] as const) {
        const s = await scene(c);
        paidDeliveries(s); // l'ordre est réellement payé chez le PSP
        const bodies = {
          ok: eventBody(s, `evt-ok-${order.join('')}`, 'SUCCEEDED'),
          late: eventBody(s, `evt-late-${order.join('')}`, 'SUBMITTED', 'order.created'),
          bad: eventBody(s, `evt-bad-${order.join('')}`, 'FAILED', 'order.failed'),
        };
        for (const k of order) {
          expect((await receive(s, bodies[k], signed(bodies[k]))).status, k).toBe(200);
        }
        await runProcessor(s, s.worker, true);
        expect((await operationStatus(s)).status, order.join('>')).toBe('SUCCEEDED');
        await retire(s);
      }
      // sans lecture du PSP : SUCCEEDED puis FAILED ⇒ CONFLICT, jamais de régression
      const s = await scene(c);
      const ok = eventBody(s, 'evt-ok-solo', 'SUCCEEDED');
      const bad = eventBody(s, 'evt-bad-solo', 'FAILED', 'order.failed');
      await receive(s, ok, signed(ok));
      await runProcessor(s, s.worker, false);
      await receive(s, bad, signed(bad));
      const report = await runProcessor(s, s.worker, false);
      expect(report.conflicts).toBe(1);
      expect((await operationStatus(s)).status).toBe('SUCCEEDED');
    },
    LONG,
  );

  it(
    'RT-CONC-56 : webhook inconnu ou d’un autre compte ⇒ aucune opération touchée ; référence de l’opération d’un autre compte ignorée',
    async () => {
      const a = await scene(c);
      const b = await scene(c, PSP_NAME_2);
      // événement signé du compte B qui revendique la référence de l’opération du compte A
      const forged = JSON.stringify({
        id: 'evt-cross-1',
        type: 'order.paid',
        reference: a.reference,
        merchant_reference: a.idem,
        status: 'SUCCEEDED',
        amount_minor: '1',
        currency: c.currency,
        method: 'CARD',
        occurred_at: new Date().toISOString(),
      });
      expect((await receive(b, forged, signed(forged))).status).toBe(200);
      await runProcessor(b, b.worker, false);
      expect((await operationStatus(a)).status).toBe('SUBMITTED');
      // point d'entrée inconnu : 404 sans écriture
      const unknown = await b.ingestOn(b.api).receive({
        provider: b.psp.toLowerCase(),
        publicWebhookId: `wh_${randomBytes(12).toString('hex')}`,
        headers: signed(forged),
        rawBody: enc.encode(forged),
      });
      expect(unknown).toEqual({ status: 404, outcome: 'NOT_FOUND' });
    },
    LONG,
  );

  it(
    'RT-CONC-57 : commandes de paiement hors de leur rôle — app_anon ne reçoit pas de webhook, app_api (contexte de travailleur forgé) n’applique pas de statut ni n’écrit l’opération',
    async () => {
      const s = await scene(c);
      const anon = await open('app_anon');
      await expect(
        anon.query(
          `SELECT core.payment_cmd_receive_webhook($1, 'x', $2, true, NULL, '{}'::jsonb, '[]'::jsonb)`,
          [s.accountId, Buffer.from('0123456789abcdef0123')],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      for (const worker of ['webhook_ingest', 'payment_command']) {
        await s.api.query('BEGIN');
        await s.api.query(
          `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', $1, true)`,
          [worker],
        );
        await expect(
          s.api.query(
            `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'WEBHOOK', NULL, NULL)`,
            [s.operationId],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await s.api.query('ROLLBACK');
        await s.api.query('BEGIN');
        await s.api.query(
          `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', $1, true)`,
          [worker],
        );
        await expect(
          s.api.query(
            `UPDATE core.payment_payment_operation SET status = 'SUCCEEDED' WHERE id = $1`,
            [s.operationId],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await s.api.query('ROLLBACK');
      }
      expect((await operationStatus(s)).status).toBe('SUBMITTED');
    },
    LONG,
  );
});
