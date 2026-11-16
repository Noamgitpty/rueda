/**
 * US-223 (partie 223a) — preuve d'un paiement par webhook (S-02 ; migration 0114 ; ADR-139 ;
 * 17 §4.4 points 2 à 8 ; ADR-088 « Limites »), en PA (USD) et en PY (PYG), sous les rôles de
 * production (assertion L0-05 par withRole). Webhooks reçus par la VRAIE commande
 * `core.payment_cmd_receive_webhook` (fixture 9950), dans une transaction ANNULÉE.
 *
 * Attendus : 19 US-223 (« 120,00 reçus pour un devis de 128,40 ⇒ MISMATCH », « webhook à signature
 * falsifiée rejeté », « aucune capture d'écran ni déclaration ne vaut preuve »), ligne S-02 du BOARD
 * (horodatage signé NULL hors fenêtre, rattachement par une référence fournie par l'appelant
 * refusé, POLL / API_RESPONSE sans preuve, proof_type exigé avant tout mouvement de jambe), N-18
 * (L0-08 : deux lignes de la même jambe). Montants : TA01 de 16 A.8.1 en PA (128,40 ; HOST 90,00 ;
 * 08 BR-PRICE-13, E7 : PLATFORM = complément) et TJ09c de l'export des oracles en PY ; les montants
 * « reçus » (120,00 et 1 200 000) sont des ENTRÉES du scénario, pas des attendus.
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  applyStatus,
  caught,
  insertAccount,
  insertTrip,
  payTx,
  recordOperation,
  signedWebhook,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';

const set = loadGoldenVectors();
const tj09c = legVector(set, 'TJ09c');

interface Order {
  readonly amountMinor: bigint;
  readonly legs: Legs;
  /** Montant « reçu » du scénario MISMATCH (entrée, 19 US-223). */
  readonly receivedMinor: bigint;
}

/** TA01 (16 A.8.1) en PA ; TJ09c (export des oracles, checkout PY d'US-208) en PY. */
const ORDERS: Readonly<Record<string, Order>> = {
  PA: {
    amountMinor: 12_840n,
    legs: { HOST: 9_000n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 3_840n },
    receivedMinor: 12_000n,
  },
  PY: {
    amountMinor: tj09c.totalMinor,
    legs: { ...tj09c.legsMinor } as Legs,
    receivedMinor: 1_200_000n,
  },
};

type Tx = pg.ClientBase;

const asWorker = (tx: Tx, name: string) =>
  tx.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', $1, true)`,
    [name],
  );

interface Event {
  readonly providerReference: string;
  readonly merchantReference: string | null;
  readonly status: string;
  readonly amountMinor?: string;
  readonly currency?: string;
}

/** Réception par la commande de production (fixture 9950) ; `signedAt` absent : heure de la BASE. */
async function receive(
  tx: Tx,
  account: string,
  events: readonly Event[],
  signedAt?: string | null,
): Promise<{ outcome: string; inboxId: string | null }> {
  const { rows } = await tx.query<{ outcome: string; inbox_id: string | null }>(
    `SELECT outcome, inbox_id
       FROM test_fixture.us049_receive_custom($1, $2::jsonb, true,
              CASE WHEN $4::boolean THEN platform.now() ELSE $3::timestamptz END)`,
    [
      account,
      JSON.stringify(
        events.map((e) => ({
          type: 'payment.captured',
          providerReference: e.providerReference,
          merchantReference: e.merchantReference,
          status: e.status,
          ...(e.amountMinor === undefined ? {} : { amountMinor: e.amountMinor }),
          ...(e.currency === undefined ? {} : { currency: e.currency }),
          occurredAt: '2031-08-01T10:00:00Z',
        })),
      ),
      signedAt ?? null,
      signedAt === undefined,
    ],
  );
  const r = rows[0];
  if (r === undefined) throw new Error('réception sans résultat');
  return { outcome: r.outcome, inboxId: r.inbox_id };
}

interface OpRow {
  readonly status: string;
  readonly provider_reference: string | null;
  readonly proof_type: string | null;
}

async function opRow(tx: Tx, op: string): Promise<OpRow> {
  const { rows } = await tx.query<OpRow>(
    'SELECT status, provider_reference, proof_type FROM core.payment_payment_operation WHERE id = $1',
    [op],
  );
  if (!rows[0]) throw new Error('opération invisible');
  return rows[0];
}

async function events(tx: Tx, op: string): Promise<[string, string, string][]> {
  const { rows } = await tx.query<{ status: string; source: string; outcome: string }>(
    `SELECT status, source, outcome FROM core.payment_payment_operation_event
      WHERE operation_id = $1`,
    [op],
  );
  // même instant de transaction : l'ordre d'écriture n'est pas lisible, on compare des multiensembles
  return rows.map((r): [string, string, string] => [r.status, r.source, r.outcome]).sort();
}

describe.each(COUNTRIES)('US-223 — preuve du paiement par webhook ($country, $currency)', (c) => {
  const order = ORDERS[c.country]!;
  const paid = { amountMinor: order.amountMinor.toString(), currency: c.currency };

  async function inWorld(
    fn: (tx: Tx, w: { account: string; trip: string; c: CountryCase }) => Promise<void>,
  ): Promise<void> {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command' }, async (tx) => {
        const account = await insertAccount(tx, { country: c.country });
        const trip = await insertTrip(tx, c);
        await fn(tx, { account, trip, c });
      }),
    );
  }

  async function op(
    tx: Tx,
    w: { account: string; trip: string },
    n: number,
    account = w.account,
  ): Promise<{ id: string; idem: string }> {
    const idem = `${w.trip}:1:v1:CAPTURE:card:i${n}:a1`;
    const { operation_id } = await recordOperation(tx, {
      tripId: w.trip,
      accountId: account,
      currency: c.currency,
      idemPlain: idem,
      amountMinor: order.amountMinor,
      legs: order.legs,
    });
    return { id: operation_id, idem };
  }

  it('horodatage signé ABSENT (NULL) ⇒ hors fenêtre : QUARANTINED, indicateur posé, jamais une preuve ; refus journalisé', async () => {
    await inWorld(async (tx, w) => {
      const a = await op(tx, w, 1);
      const r = await receive(
        tx,
        w.account,
        [
          {
            providerReference: `ref-${uuid()}`,
            merchantReference: a.idem,
            status: 'SUCCEEDED',
            ...paid,
          },
        ],
        null,
      );
      expect(r.outcome).toBe('QUARANTINED');
      await asWorker(tx, 'webhook_ingest');
      const inbox = await tx.query<{ out: boolean; error: string | null }>(
        `SELECT signed_at_out_of_tolerance AS out, error FROM core.payment_webhook_inbox WHERE id = $1`,
        [r.inboxId],
      );
      expect(inbox.rows[0]).toEqual({ out: true, error: 'SIGNED_TIMESTAMP_OUT_OF_TOLERANCE' });
      expect(await applyStatus(tx, a.id, 'SUCCEEDED', 'WEBHOOK', null, r.inboxId)).toBe('UNPROVEN');
      expect(await opRow(tx, a.id)).toMatchObject({ status: 'PENDING', proof_type: null });
      expect(await events(tx, a.id)).toEqual([['SUCCEEDED', 'WEBHOOK', 'UNPROVEN']]);
    });
  });

  it('S-02 : le vrai webhook de A rattaché à B (même compte) avant que A porte sa référence ⇒ refusé, B intacte ; A le reçoit', async () => {
    await inWorld(async (tx, w) => {
      const a = await op(tx, w, 1);
      const b = await op(tx, w, 2);
      const refA = `ref-${uuid()}`;
      const r = await receive(tx, w.account, [
        { providerReference: refA, merchantReference: a.idem, status: 'SUCCEEDED', ...paid },
      ]);
      expect(r.outcome).toBe('RECEIVED');
      await asWorker(tx, 'webhook_ingest');
      // l'appelant fournit la référence de A : elle n'est plus un critère de rattachement
      expect(await applyStatus(tx, b.id, 'SUCCEEDED', 'WEBHOOK', refA, r.inboxId)).toBe('UNPROVEN');
      expect(await applyStatus(tx, b.id, 'SUCCEEDED', 'WEBHOOK', null, r.inboxId)).toBe('UNPROVEN');
      expect(await opRow(tx, b.id)).toEqual({
        status: 'PENDING',
        provider_reference: null,
        proof_type: null,
      });
      // A : rattachée par NOTRE clé ; la référence enregistrée est celle de l'événement signé
      expect(await applyStatus(tx, a.id, 'SUCCEEDED', 'WEBHOOK', null, r.inboxId)).toBe('APPLIED');
      expect(await opRow(tx, a.id)).toEqual({
        status: 'SUCCEEDED',
        provider_reference: refA,
        proof_type: 'WEBHOOK_SIGNED',
      });
    });
  });

  it('S-02 : opération sans référence et webhook sans notre clé (référence seule) ⇒ aucune preuve', async () => {
    await inWorld(async (tx, w) => {
      const a = await op(tx, w, 1);
      const r = await receive(tx, w.account, [
        {
          providerReference: `ref-${uuid()}`,
          merchantReference: null,
          status: 'SUCCEEDED',
          ...paid,
        },
      ]);
      await asWorker(tx, 'webhook_ingest');
      expect(await applyStatus(tx, a.id, 'SUCCEEDED', 'WEBHOOK', null, r.inboxId)).toBe('UNPROVEN');
    });
  });

  it('19 US-223 : montant reçu inférieur à l’ordre ⇒ MISMATCH, rien d’appliqué ; devise différente ⇒ MISMATCH ; montant absent ⇒ UNPROVEN ; montant exact ⇒ APPLIED', async () => {
    await inWorld(async (tx, w) => {
      const a = await op(tx, w, 1);
      await asWorker(tx, 'webhook_ingest');
      const ev = (extra: Partial<Event>): Event => ({
        providerReference: `ref-${a.id}`,
        merchantReference: a.idem,
        status: 'SUCCEEDED',
        ...extra,
      });
      const short = await receive(tx, w.account, [
        ev({ amountMinor: order.receivedMinor.toString(), currency: c.currency }),
      ]);
      expect(await applyStatus(tx, a.id, 'SUCCEEDED', 'WEBHOOK', null, short.inboxId)).toBe(
        'MISMATCH',
      );
      const other = COUNTRIES.find((x) => x.currency !== c.currency)!.currency;
      const wrongCurrency = await receive(tx, w.account, [
        ev({ amountMinor: order.amountMinor.toString(), currency: other }),
      ]);
      expect(await applyStatus(tx, a.id, 'SUCCEEDED', 'WEBHOOK', null, wrongCurrency.inboxId)).toBe(
        'MISMATCH',
      );
      const bare = await receive(tx, w.account, [ev({})]);
      expect(await applyStatus(tx, a.id, 'SUCCEEDED', 'WEBHOOK', null, bare.inboxId)).toBe(
        'UNPROVEN',
      );
      expect(await opRow(tx, a.id)).toMatchObject({ status: 'PENDING', proof_type: null });
      const exact = await receive(tx, w.account, [ev(paid)]);
      expect(await applyStatus(tx, a.id, 'SUCCEEDED', 'WEBHOOK', null, exact.inboxId)).toBe(
        'APPLIED',
      );
      // rejeu du même webhook : DUPLICATE, aucun second statut appliqué
      expect(await applyStatus(tx, a.id, 'SUCCEEDED', 'WEBHOOK', null, exact.inboxId)).toBe(
        'DUPLICATE',
      );
      expect(await events(tx, a.id)).toEqual([
        ['SUCCEEDED', 'WEBHOOK', 'APPLIED'],
        ['SUCCEEDED', 'WEBHOOK', 'DUPLICATE'],
        ['SUCCEEDED', 'WEBHOOK', 'MISMATCH'],
        ['SUCCEEDED', 'WEBHOOK', 'MISMATCH'],
        ['SUCCEEDED', 'WEBHOOK', 'UNPROVEN'],
      ]);
    });
  });

  it('S-02 (ADR-088 « Limites ») : compte LIVE ⇒ POLL et API_RESPONSE terminaux sans preuve (UNPROVEN) ; seul le webhook signé prouve', async () => {
    await inWorld(async (tx, w) => {
      const live = await insertAccount(tx, {
        provider: 'TILOPAY',
        country: c.country,
        environment: 'LIVE',
        status: 'PENDING_VALIDATION',
      });
      const a = await op(tx, w, 1, live);
      expect(await applyStatus(tx, a.id, 'SUBMITTED', 'API_RESPONSE', `ref-${a.id}`)).toBe(
        'APPLIED',
      );
      for (const [status, source] of [
        ['SUCCEEDED', 'POLL'],
        ['SUCCEEDED', 'API_RESPONSE'],
        ['FAILED', 'POLL'],
        ['FAILED', 'API_RESPONSE'],
      ] as const) {
        expect(await applyStatus(tx, a.id, status, source), `${status} ${source}`).toBe('UNPROVEN');
      }
      expect(await opRow(tx, a.id)).toMatchObject({ status: 'SUBMITTED', proof_type: null });
      await asWorker(tx, 'webhook_ingest');
      const inbox = await signedWebhook(tx, a.id, 'SUCCEEDED');
      expect(await applyStatus(tx, a.id, 'SUCCEEDED', 'WEBHOOK', null, inbox)).toBe('APPLIED');
      expect(await opRow(tx, a.id)).toMatchObject({
        status: 'SUCCEEDED',
        proof_type: 'WEBHOOK_SIGNED',
      });
    });
  });

  it('compte de bac à sable : API_RESPONSE SUCCEEDED sans preuve ⇒ aucun mouvement de jambe (PAYMENT_UNPROVEN) ; le webhook signé pose la preuve (DUPLICATE), puis le mouvement passe ; POLL ⇒ preuve POLL', async () => {
    await inWorld(async (tx, w) => {
      const a = await op(tx, w, 1);
      expect(await applyStatus(tx, a.id, 'SUCCEEDED', 'API_RESPONSE', `ref-${a.id}`)).toBe(
        'APPLIED',
      );
      expect(await opRow(tx, a.id)).toMatchObject({ status: 'SUCCEEDED', proof_type: null });
      const err = await caught(tx, () =>
        tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [a.id]),
      );
      expect(err).toMatchObject({ code: '55000', constraint: 'leg_movement_unproven' });
      expect(translateDbError(err)).toEqual({ code: 'PAYMENT_UNPROVEN', retryable: false });
      await asWorker(tx, 'webhook_ingest');
      const inbox = await signedWebhook(tx, a.id, 'SUCCEEDED');
      expect(await applyStatus(tx, a.id, 'SUCCEEDED', 'WEBHOOK', null, inbox)).toBe('DUPLICATE');
      expect(await opRow(tx, a.id)).toMatchObject({ proof_type: 'WEBHOOK_SIGNED' });
      await asWorker(tx, 'payment_command');
      const moved = await tx.query<{ r: string }>(
        'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
        [a.id],
      );
      expect(moved.rows[0]?.r).toBe('APPLIED');

      const b = await op(tx, w, 2);
      expect(await applyStatus(tx, b.id, 'SUCCEEDED', 'POLL', `ref-${b.id}`)).toBe('APPLIED');
      expect(await opRow(tx, b.id)).toMatchObject({ status: 'SUCCEEDED', proof_type: 'POLL' });
    });
  });

  it('N-18 (L0-08) : seconde ligne de la même jambe ⇒ 23505 payment_operation_leg_pkey, traduite sans détail', async () => {
    await inWorld(async (tx, w) => {
      const a = await op(tx, w, 1);
      const err = await caught(tx, () =>
        tx.query('SELECT test_fixture.us223_duplicate_leg($1, $2)', [a.id, 'HOST']),
      );
      expect(err).toMatchObject({ code: '23505', constraint: 'payment_operation_leg_pkey' });
      const translated = translateDbError(err);
      expect(translated).toEqual({ code: 'INVARIANT_VIOLATION', retryable: false });
      expect(Object.keys(translated).sort()).toEqual(['code', 'retryable']);
    });
  });
});
