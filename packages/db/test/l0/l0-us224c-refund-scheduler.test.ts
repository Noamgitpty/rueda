/**
 * US-224 (partie 224c, migration 0127, ADR-150) — ordonnancement des remboursements planifiés :
 * file de l'ordonnanceur, ordre relu sous les verrous avant l'appel au PSP, états SM-8 après
 * l'envoi (SENT, CONFIRMED, FAILED, FAILED → SUPERSEDED), alerte FIN posée une fois. Sous
 * app_worker (rôle de PRODUCTION, assertion L0-05 en tête : withRole), en USD (PA) et en PYG sans
 * décimale (PY), transactions annulées.
 *
 * Attendus : vecteurs de l'export des oracles (`docs/specs/tools`, `@rueda/money/golden-vectors`) :
 * TJ01 / TJ02b / T03 et TJ08a / TJ08b / T27 (remboursement du règlement = −variation, 08 E7
 * règle 1), T08 (version 2 qui remplace la version 1) ; états de 08 SM-8. Aucun attendu n'est
 * calculé ici ni lu du code testé.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  applySignedStatus,
  applyStatus,
  caught,
  insertAccount,
  insertTrip,
  legsJson,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs, SettlementRef } from '../support/pay.ts';
import {
  eventOfVector,
  golden,
  recordAsSettlementWorker,
  recordOf,
  recordOfVector,
  tripOfVector,
} from '../support/settlement.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
const legsOf = (v: GoldenLegVector): Legs => ({ ...v.legsMinor });
const tj = (id: string): GoldenLegVector => legVector(golden, id);
const negate = (l: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);

/** Vecteurs par devise (jamais par pays). */
const REF: Readonly<Record<string, { capture: string; settlement: string; variation: string }>> = {
  USD: { capture: 'TJ01', settlement: 'T03', variation: 'TJ02b' },
  PYG: { capture: 'TJ08a', settlement: 'T27', variation: 'TJ08b' },
};
const refOf = (c: CountryCase) => {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  expect(tj(r.capture).currency).toBe(c.currency);
  return r;
};

const asPayments = (fn: (tx: Tx) => Promise<void>): Promise<void> =>
  withRole('app_worker', (client) => payTx(client, { worker: 'payment_command' }, fn));

const asWorker = (tx: Tx, workerName: string): Promise<void> =>
  setSessionContext(tx, { kind: 'WORKER', workerName });

interface World {
  readonly trip: string;
  readonly capture: string;
  readonly account: string;
}

async function applyMovement(tx: Tx, operationId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS outcome',
    [operationId],
  );
  return rows[0]?.outcome ?? '';
}

/** Trip capturé (jambes du vecteur) par la vraie commande, prouvé et reporté. */
async function captured(
  tx: Tx,
  c: CountryCase,
  capture: Legs,
  existingAccount?: string,
): Promise<World> {
  const trip = await insertTrip(tx, c);
  // un seul compte PSP ACTIVE par pays (psp_account_one_active) : réutilisé dans la transaction
  const account = existingAccount ?? (await insertAccount(tx, { country: c.country }));
  const { operation_id: op } = await recordOperation(tx, {
    tripId: trip,
    accountId: account,
    kind: 'CAPTURE',
    amountMinor: sum(capture),
    currency: c.currency,
    idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
    legs: capture,
  });
  expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
  expect(await applyMovement(tx, op)).toBe('APPLIED');
  return { trip, capture: op, account };
}

/** Version enregistrée par le travailleur `settlement`, puis retour à payment_command. */
async function settle(
  tx: Tx,
  trip: string,
  version: number,
  record: ReturnType<typeof recordOfVector>,
  supersedesId?: string,
): Promise<SettlementRef> {
  const id = await recordAsSettlementWorker(
    tx,
    { tripId: trip, version, ...(supersedesId === undefined ? {} : { supersedesId }) },
    record,
  );
  await asWorker(tx, 'payment_command');
  return { id, version };
}

interface Planned {
  readonly instance_id: string;
  readonly operation_id: string;
}

async function plan(
  tx: Tx,
  w: World,
  s: SettlementRef,
  legs: Legs,
): Promise<Planned & { idem: string }> {
  const idem = `trip:${w.trip}:REFUND:card:i1:a1:${uuid()}`;
  const { rows } = await tx.query<Planned>(
    `SELECT instance_id, operation_id
       FROM core.payment_cmd_plan_refund($1, $2, $3, $4, 1, 'NATIVE_PARTIAL', $5::jsonb, $6, $6)`,
    [uuid(), uuid(), s.id, w.capture, legsJson(legs), idem],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('plan_refund sans résultat');
  return { ...row, idem };
}

async function submit(tx: Tx, instanceId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT outcome FROM core.payment_cmd_submit_refund($1)',
    [instanceId],
  );
  return rows[0]?.outcome ?? '';
}

async function instance(tx: Tx, id: string) {
  const { rows } = await tx.query<{ status: string; issued: boolean; fin_alert: string | null }>(
    `SELECT status, issued_at IS NOT NULL AS issued, fin_alert
       FROM core.payment_refund_instance WHERE id = $1`,
    [id],
  );
  return rows[0];
}

interface DueRow {
  readonly instance_id: string;
  readonly country_code: string;
  readonly status: string;
  readonly operation_status: string;
  readonly provider: string;
  readonly blocked_reason: string | null;
  readonly fin_alert: string | null;
  readonly target_known: boolean;
}

/** File de l'ordonnanceur restreinte à une instance (la base de test est partagée). */
async function dueOf(tx: Tx, id: string): Promise<DueRow | undefined> {
  const { rows } = await tx.query<DueRow>('SELECT * FROM core.payment_refunds_due(500)');
  return rows.find((r) => r.instance_id === id);
}

interface SendRow {
  readonly operation_id: string;
  readonly operation_status: string;
  readonly idem_sent: string;
  readonly amount_minor: string;
  readonly currency: string;
  readonly legs: Record<string, string>;
  readonly target_reference: string | null;
  readonly provider_reference: string | null;
  readonly provider: string;
  readonly sendable: boolean;
  readonly reason: string | null;
}

async function forSend(tx: Tx, id: string): Promise<SendRow | undefined> {
  const { rows } = await tx.query<SendRow>(
    `SELECT operation_id, operation_status, idem_sent, amount_minor::text AS amount_minor,
            currency, legs, target_reference, provider_reference, provider, sendable, reason
       FROM core.payment_cmd_refund_order_for_send($1)`,
    [id],
  );
  return rows[0];
}

async function markAlerted(tx: Tx, id: string, key: string): Promise<boolean> {
  const { rows } = await tx.query<{ changed: boolean }>(
    'SELECT core.payment_cmd_refund_mark_alerted($1, $2) AS changed',
    [id, key],
  );
  return rows[0]?.changed === true;
}

async function refunded(tx: Tx, trip: string): Promise<Legs> {
  const { rows } = await tx.query<{ leg: string; v: string }>(
    `SELECT leg, refunded_minor::text AS v FROM core.settlement_trip_leg_balance
      WHERE trip_id = $1 AND segment_no = 1`,
    [trip],
  );
  const out: Record<string, bigint> = { ...ZERO };
  for (const r of rows) out[r.leg] = BigInt(r.v);
  return out as unknown as Legs;
}

async function captureReference(tx: Tx, operationId: string): Promise<string | null> {
  const { rows } = await tx.query<{ provider_reference: string | null }>(
    'SELECT provider_reference FROM core.payment_payment_operation WHERE id = $1',
    [operationId],
  );
  return rows[0]?.provider_reference ?? null;
}

const textLegs = (l: Legs): Record<string, string> =>
  Object.fromEntries(LEGS.map((k) => [k, l[k].toString()]));

describe.each(COUNTRIES)(
  'US-224c — ordonnanceur des remboursements (SM-8) — $country ($currency)',
  (c) => {
    const r = refOf(c);
    const capture = legsOf(tj(r.capture));
    const refund = negate(legsOf(tj(r.variation))); // jambes de TJ02b / TJ08b

    it('critère 1 : PLANNED en file ; envoi autorisé ; ordre STOCKÉ relu (jambes du règlement, clé, encaissement visé) ; PSP « en cours » ⇒ SENT ; preuve signée reçue par webhook_ingest ⇒ CONFIRMED ; report ; hors de la file', async () => {
      await asPayments(async (tx) => {
        const w = await captured(tx, c, capture);
        const v1 = await settle(tx, w.trip, 1, recordOfVector(r.settlement));
        const p = await plan(tx, w, v1, refund);
        expect(await dueOf(tx, p.instance_id)).toEqual({
          instance_id: p.instance_id,
          country_code: c.country,
          status: 'PLANNED',
          operation_status: 'PENDING',
          provider: 'FAKE',
          blocked_reason: null,
          fin_alert: null,
          target_known: true,
        });
        // ordre d'une instance non autorisée : jamais envoyable
        expect(await forSend(tx, p.instance_id)).toMatchObject({
          sendable: false,
          reason: 'NOT_SUBMITTED',
        });
        expect(await submit(tx, p.instance_id)).toBe('SUBMITTED');
        expect(await forSend(tx, p.instance_id)).toEqual({
          operation_id: p.operation_id,
          operation_status: 'PENDING',
          idem_sent: p.idem,
          amount_minor: sum(refund).toString(),
          currency: c.currency,
          legs: textLegs(refund),
          target_reference: await captureReference(tx, w.capture),
          provider_reference: null,
          provider: 'FAKE',
          sendable: true,
          reason: null,
        });
        expect(await dueOf(tx, p.instance_id)).toMatchObject({
          status: 'SUBMITTED',
          operation_status: 'PENDING',
        });
        // le PSP a pris l'ordre sans le traiter (réponse de l'API, statut non terminal) : SENT
        const reference = `psp-refund-${uuid()}`;
        expect(await applyStatus(tx, p.operation_id, 'SUBMITTED', 'API_RESPONSE', reference)).toBe(
          'APPLIED',
        );
        expect(await instance(tx, p.instance_id)).toEqual({
          status: 'SENT',
          issued: true,
          fin_alert: null,
        });
        expect(await forSend(tx, p.instance_id)).toMatchObject({
          sendable: true,
          operation_status: 'SUBMITTED',
          provider_reference: reference,
        });
        // preuve signée appliquée par le travailleur webhook_ingest (rôle de production du webhook)
        await asWorker(tx, 'webhook_ingest');
        expect(await applySignedStatus(tx, p.operation_id, 'SUCCEEDED')).toBe('APPLIED');
        await asWorker(tx, 'payment_command');
        expect(await instance(tx, p.instance_id)).toEqual({
          status: 'CONFIRMED',
          issued: true,
          fin_alert: null,
        });
        expect(await forSend(tx, p.instance_id)).toMatchObject({
          sendable: false,
          reason: 'FINAL',
        });
        expect(await dueOf(tx, p.instance_id)).toMatchObject({
          status: 'CONFIRMED',
          operation_status: 'SUCCEEDED',
        });
        expect(await applyMovement(tx, p.operation_id)).toBe('APPLIED');
        expect(await refunded(tx, w.trip)).toEqual(refund);
        expect(await dueOf(tx, p.instance_id)).toBeUndefined();
      });
    });

    it('succès directement prouvé (SUBMITTED → SENT → CONFIRMED, jamais de saut) ; issue inconnue (UNKNOWN) : l’instance reste SUBMITTED et en file', async () => {
      await asPayments(async (tx) => {
        const w = await captured(tx, c, capture);
        const v1 = await settle(tx, w.trip, 1, recordOfVector(r.settlement));
        const p = await plan(tx, w, v1, refund);
        expect(await submit(tx, p.instance_id)).toBe('SUBMITTED');
        expect(await applyStatus(tx, p.operation_id, 'UNKNOWN', 'API_RESPONSE')).toBe('APPLIED');
        expect((await instance(tx, p.instance_id))?.status).toBe('SUBMITTED');
        expect(await dueOf(tx, p.instance_id)).toMatchObject({
          status: 'SUBMITTED',
          operation_status: 'UNKNOWN',
        });
        expect(await applySignedStatus(tx, p.operation_id, 'SUCCEEDED')).toBe('APPLIED');
        expect((await instance(tx, p.instance_id))?.status).toBe('CONFIRMED');
      });
    });

    it('échec : FAILED (date d’émission gardée), en file jusqu’à l’alerte posée une fois ; la version n+1 le remplace (FAILED → SUPERSEDED)', async () => {
      await asPayments(async (tx) => {
        const w = await captured(tx, c, capture);
        const r1 = recordOfVector(r.settlement);
        const v1 = await settle(tx, w.trip, 1, r1);
        const p = await plan(tx, w, v1, refund);
        expect(await submit(tx, p.instance_id)).toBe('SUBMITTED');
        expect(await applySignedStatus(tx, p.operation_id, 'FAILED')).toBe('APPLIED');
        expect(await instance(tx, p.instance_id)).toEqual({
          status: 'FAILED',
          issued: true,
          fin_alert: null,
        });
        expect(await dueOf(tx, p.instance_id)).toMatchObject({
          status: 'FAILED',
          operation_status: 'FAILED',
          fin_alert: null,
        });
        expect(await markAlerted(tx, p.instance_id, 'FAILED')).toBe(true);
        expect(await markAlerted(tx, p.instance_id, 'FAILED')).toBe(false);
        expect(await dueOf(tx, p.instance_id)).toBeUndefined();
        await settle(
          tx,
          w.trip,
          2,
          recordOf(tripOfVector(r.settlement), eventOfVector('T08'), r1),
          v1.id,
        );
        expect(await instance(tx, p.instance_id)).toEqual({
          status: 'SUPERSEDED',
          issued: true,
          fin_alert: 'FAILED',
        });
      });
    });

    it('version remplacée APRÈS l’envoi autorisé, ordre jamais envoyé : SUBMITTED reste engagée (08 SM-8) mais son ordre ne part pas (SUPERSEDED_UNSENT, revue FIN)', async () => {
      await asPayments(async (tx) => {
        const w = await captured(tx, c, capture);
        const r1 = recordOfVector(r.settlement);
        const v1 = await settle(tx, w.trip, 1, r1);
        const p = await plan(tx, w, v1, refund);
        expect(await submit(tx, p.instance_id)).toBe('SUBMITTED');
        await settle(
          tx,
          w.trip,
          2,
          recordOf(tripOfVector(r.settlement), eventOfVector('T08'), r1),
          v1.id,
        );
        expect((await instance(tx, p.instance_id))?.status).toBe('SUBMITTED');
        expect(await forSend(tx, p.instance_id)).toMatchObject({
          sendable: false,
          reason: 'SUPERSEDED_UNSENT',
        });
      });
    });

    it('politique cmd_money_sync : webhook_ingest fait suivre l’instance (SUBMITTED → SENT, SUBMITTED → FAILED) ; un travailleur sans politique ne la change pas', async () => {
      await asPayments(async (tx) => {
        const w = await captured(tx, c, capture);
        const v1 = await settle(tx, w.trip, 1, recordOfVector(r.settlement));
        const sent = await plan(tx, w, v1, refund);
        expect(await submit(tx, sent.instance_id)).toBe('SUBMITTED');
        await asWorker(tx, 'webhook_ingest');
        expect(
          await applyStatus(tx, sent.operation_id, 'SUBMITTED', 'WEBHOOK', `psp-${uuid()}`),
        ).toBe('APPLIED');
        await asWorker(tx, 'payment_command');
        expect((await instance(tx, sent.instance_id))?.status).toBe('SENT');

        const w2 = await captured(tx, c, capture, w.account);
        const v2 = await settle(tx, w2.trip, 1, recordOfVector(r.settlement));
        const failed = await plan(tx, w2, v2, refund);
        expect(await submit(tx, failed.instance_id)).toBe('SUBMITTED');
        await asWorker(tx, 'webhook_ingest');
        expect(await applySignedStatus(tx, failed.operation_id, 'FAILED')).toBe('APPLIED');
        await asWorker(tx, 'payment_command');
        expect((await instance(tx, failed.instance_id))?.status).toBe('FAILED');

        // un travailleur sans politique sur l'instance (booking_conversion) : l'écriture directe du
        // statut de l'ordre est refusée ou sans effet sur l'instance, qui reste SUBMITTED
        const w3 = await captured(tx, c, capture, w.account);
        const v3 = await settle(tx, w3.trip, 1, recordOfVector(r.settlement));
        const other = await plan(tx, w3, v3, refund);
        expect(await submit(tx, other.instance_id)).toBe('SUBMITTED');
        await asWorker(tx, 'booking_conversion');
        await caught(tx, () =>
          tx.query(`UPDATE core.payment_payment_operation SET status = 'SUBMITTED' WHERE id = $1`, [
            other.operation_id,
          ]),
        );
        await asWorker(tx, 'payment_command');
        expect((await instance(tx, other.instance_id))?.status).toBe('SUBMITTED');
      });
    });

    it('file : une instance déjà signalée passe après les autres (un lot d’instances coincées n’affame pas les suivantes) ; encaissement visé connu', async () => {
      await asPayments(async (tx) => {
        const w1 = await captured(tx, c, capture);
        const v1 = await settle(tx, w1.trip, 1, recordOfVector(r.settlement));
        const stuck = await plan(tx, w1, v1, refund);
        const w2 = await captured(tx, c, capture, w1.account);
        const v2 = await settle(tx, w2.trip, 1, recordOfVector(r.settlement));
        const fresh = await plan(tx, w2, v2, refund);
        expect(await markAlerted(tx, stuck.instance_id, 'SEND:NO_LOOKUP_POSSIBLE')).toBe(true);
        const { rows } = await tx.query<{ instance_id: string; target_known: boolean }>(
          'SELECT instance_id, target_known FROM core.payment_refunds_due(500)',
        );
        const ids = rows.map((x) => x.instance_id);
        expect(ids.indexOf(fresh.instance_id)).toBeGreaterThanOrEqual(0);
        expect(ids.indexOf(stuck.instance_id)).toBeGreaterThan(ids.indexOf(fresh.instance_id));
        expect(rows.find((x) => x.instance_id === fresh.instance_id)?.target_known).toBe(true);
      });
    });

    it('commandes réservées au travailleur payment_command ; clé d’alerte au format fermé ; instance inconnue refusée', async () => {
      await asPayments(async (tx) => {
        const w = await captured(tx, c, capture);
        const v1 = await settle(tx, w.trip, 1, recordOfVector(r.settlement));
        const p = await plan(tx, w, v1, refund);
        for (const other of ['settlement', 'webhook_ingest', 'reconciliation']) {
          await asWorker(tx, other);
          for (const sql of [
            'SELECT * FROM core.payment_refunds_due(10)',
            `SELECT * FROM core.payment_cmd_refund_order_for_send('${p.instance_id}')`,
            `SELECT core.payment_cmd_refund_mark_alerted('${p.instance_id}', 'FAILED')`,
          ]) {
            expect(await caught(tx, () => tx.query(sql))).toMatchObject({ code: '42501' });
          }
        }
        await asWorker(tx, 'payment_command');
        for (const key of ['failed', 'FAILED alert', 'X'.repeat(81), '1FAILED']) {
          expect(await caught(tx, () => markAlerted(tx, p.instance_id, key))).toMatchObject({
            code: '22023',
          });
        }
        expect(
          await caught(tx, () => tx.query('SELECT * FROM core.payment_refunds_due(0)')),
        ).toMatchObject({
          code: '22023',
        });
        expect(await caught(tx, () => forSend(tx, uuid()))).toMatchObject({
          code: '55000',
          constraint: 'refund_instance_unknown',
        });
      });
    });
  },
);

describe('US-224c — commandes de l’ordonnanceur fermées à app_api', () => {
  it('app_api n’a EXECUTE sur aucune des trois commandes (42501)', async () => {
    await withRole('app_api', async (client) => {
      for (const sql of [
        'SELECT * FROM core.payment_refunds_due(10)',
        `SELECT * FROM core.payment_cmd_refund_order_for_send('${uuid()}')`,
        `SELECT core.payment_cmd_refund_mark_alerted('${uuid()}', 'FAILED')`,
      ]) {
        await expect(client.query(sql)).rejects.toMatchObject({ code: '42501' });
      }
    });
  });
});
