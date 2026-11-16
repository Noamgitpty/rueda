/**
 * US-224 (partie 224a, migration 0120, ADR-145) — ordres de règlement rattachés à la version en
 * tête et bornés dès l'enregistrement ; rejeu d'un règlement ; preuve signée d'un remboursement
 * avec son montant. Sous app_worker (rôle de PRODUCTION, assertion L0-05 en tête : withRole), en
 * USD (PA) et en PYG sans décimale (PY).
 *
 * Attendus : vecteurs de l'export des oracles (`docs/specs/tools`, `@rueda/money/golden-vectors`) :
 * TJ01 / TJ02b / T03 (A, USD), TJ08a / TJ08b / T27 (D, PYG), TJ10a / TJ10b / TJ10c (J, PYG), T08
 * (requalification FULL), TJ13b / TJ13d (promo maximale, jambe PLATFORM retenue négative) ; codes de
 * 16 PAY-021 (`REFUND_EXCEEDS_COLLECTED`) et d'ADR-145 (PROPOSÉS). Jamais le code testé.
 *
 * Suites : S-02 (phrases 1 et 2), N-196 (preuve sans montant), L2-PM-04, L2-PM-05.
 */
import { settlementRecordPayload } from '@rueda/money';
import { legVector } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import { J } from '@rueda/money/testing';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  applySignedStatus,
  applyStatus,
  caught,
  insertAccount,
  insertTrip,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs, SettlementRef } from '../support/pay.ts';
import {
  NP_MAX,
  N_MAX,
  at,
  callRecord,
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
const negate = (l: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
const minus = (a: Legs, b: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, a[k] - b[k]])) as unknown as Legs;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);

/** Vecteurs par pays : capture, règlement v1 de l'export et sa variation (remboursement). */
const REF: Readonly<Record<string, { capture: string; settlement: string; variation: string }>> = {
  USD: { capture: 'TJ01', settlement: 'T03', variation: 'TJ02b' },
  PYG: { capture: 'TJ08a', settlement: 'T27', variation: 'TJ08b' },
};
const refOf = (c: CountryCase) => {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  // les vecteurs sont bien dans la devise du pays (aucune constante de pays ici)
  expect(legVector(golden, r.capture).currency).toBe(c.currency);
  return r;
};

const asPayments = (fn: (tx: Tx) => Promise<void>): Promise<void> =>
  withRole('app_worker', (client) => payTx(client, { worker: 'payment_command' }, fn));

/** Ordre enregistré par la commande de production (15 arguments si `settlement` est fourni). */
interface World {
  readonly trip: string;
  readonly account: string;
  readonly currency: string;
}

async function order(
  tx: Tx,
  w: World,
  kind: 'CAPTURE' | 'REFUND' | 'LEG_REALLOCATION',
  legs: Legs,
  settlement?: SettlementRef | null,
  idemPlain = `trip:${w.trip}:${kind}:${uuid()}`,
): Promise<{ operation_id: string; replayed: boolean }> {
  const amount =
    kind === 'LEG_REALLOCATION'
      ? LEGS.reduce((s, k) => (legs[k] > 0n ? s + legs[k] : s), 0n)
      : sum(legs);
  return recordOperation(tx, {
    tripId: w.trip,
    accountId: w.account,
    kind,
    amountMinor: amount,
    currency: w.currency,
    idemPlain,
    legs,
    ...(settlement === undefined ? {} : { settlement }),
  });
}

async function applyMovement(tx: Tx, operationId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS outcome',
    [operationId],
  );
  return rows[0]?.outcome ?? '';
}

/** Ordre réussi (vrai webhook signé, montant compris) puis reporté sur les soldes. */
async function settleOrder(tx: Tx, operationId: string): Promise<void> {
  expect(await applySignedStatus(tx, operationId, 'SUCCEEDED')).toBe('APPLIED');
  expect(await applyMovement(tx, operationId)).toBe('APPLIED');
}

async function balance(tx: Tx, trip: string, field: string): Promise<Legs> {
  const { rows } = await tx.query<{ leg: string; v: string }>(
    `SELECT leg, ${field}::text AS v FROM core.settlement_trip_leg_balance
      WHERE trip_id = $1 AND segment_no = 1`,
    [trip],
  );
  const out: Record<string, bigint> = { ...ZERO };
  for (const r of rows) out[r.leg] = BigInt(r.v);
  return out as unknown as Legs;
}

async function refundCount(tx: Tx, trip: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM core.payment_payment_operation
      WHERE trip_id = $1 AND kind IN ('REFUND', 'LEG_REALLOCATION')`,
    [trip],
  );
  return rows[0]?.n ?? -1;
}

/** Trip capturé (jambes du vecteur), sans règlement. Contexte : payment_command. */
async function bareTrip(tx: Tx, c: CountryCase): Promise<World> {
  const trip = await insertTrip(tx, c);
  const account = await insertAccount(tx, { country: c.country });
  return { trip, account, currency: c.currency };
}

async function captured(tx: Tx, c: CountryCase, capture: Legs): Promise<World> {
  const w = await bareTrip(tx, c);
  await settleOrder(tx, (await order(tx, w, 'CAPTURE', capture)).operation_id);
  return w;
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
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
  return { id, version };
}

describe.each(COUNTRIES)('US-224 — ordres de règlement — $country ($currency)', (c) => {
  const r = refOf(c);
  const capture = legsOf(legVector(golden, r.capture));
  const refund = negate(legsOf(legVector(golden, r.variation))); // jambes de TJ02b / TJ08b
  const total = -legVector(golden, r.variation).totalMinor; // 187,44 / 1 000 367

  it('critère 1 : le remboursement du règlement porte les jambes de la variation, le règlement et sa version ; reporté tel quel', async () => {
    await asPayments(async (tx) => {
      const w = await captured(tx, c, capture);
      const v1 = await settle(tx, w.trip, 1, recordOfVector(r.settlement));
      const { operation_id: op, replayed } = await order(tx, w, 'REFUND', refund, v1);
      expect(replayed).toBe(false);
      expect(sum(refund)).toBe(total);
      const { rows } = await tx.query<{ settlement_id: string; settlement_version: number }>(
        `SELECT settlement_id, settlement_version FROM core.payment_payment_operation WHERE id = $1`,
        [op],
      );
      expect(rows[0]).toEqual({ settlement_id: v1.id, settlement_version: 1 });
      const legs = await tx.query<{ leg: string; v: string }>(
        `SELECT leg, amount_minor::text AS v FROM core.payment_payment_operation_leg
          WHERE operation_id = $1`,
        [op],
      );
      expect(Object.fromEntries(legs.rows.map((x) => [x.leg, BigInt(x.v)]))).toEqual(refund);
      await settleOrder(tx, op);
      expect(await balance(tx, w.trip, 'refunded_minor')).toEqual(refund);
    });
  });

  it('S-02 : ordre d’une version remplacée ⇒ SETTLEMENT_SUPERSEDED, rien d’écrit ; la version en tête est acceptée', async () => {
    await asPayments(async (tx) => {
      const w = await captured(tx, c, capture);
      const r1 = recordOfVector(r.settlement);
      const v1 = await settle(tx, w.trip, 1, r1);
      // requalification FULL (T08) : la v2 remplace la v1
      const v2 = await settle(
        tx,
        w.trip,
        2,
        recordOf(tripOfVector(r.settlement), eventOfVector('T08'), r1),
        v1.id,
      );
      const err = await caught(tx, () => order(tx, w, 'REFUND', refund, v1));
      expect(err).toMatchObject({ code: '55000', constraint: 'operation_settlement_superseded' });
      expect(translateDbError(err).code).toBe('SETTLEMENT_SUPERSEDED');
      expect(await refundCount(tx, w.trip)).toBe(0);
      // FULL : toute la capture est remboursable, sous la v2
      const ok = await order(tx, w, 'REFUND', capture, v2);
      await settleOrder(tx, ok.operation_id);
      expect(await balance(tx, w.trip, 'refunded_minor')).toEqual(capture);
    });
  });

  it('S-02 : un ordre de trip REFUND / LEG_REALLOCATION sans règlement (commande à 13 arguments) est refusé, même quand un règlement existe', async () => {
    await asPayments(async (tx) => {
      const w = await captured(tx, c, capture);
      await settle(tx, w.trip, 1, recordOfVector(r.settlement));
      const noRef = await caught(tx, () => order(tx, w, 'REFUND', refund));
      expect(noRef).toMatchObject({ code: '55000', constraint: 'leg_refund_without_settlement' });
      const realloc: Legs = { ...ZERO, HOST: -1n, PLATFORM: 1n };
      const noRealloc = await caught(tx, () => order(tx, w, 'LEG_REALLOCATION', realloc, null));
      expect(noRealloc).toMatchObject({
        code: '55000',
        constraint: 'operation_settlement_required',
      });
      expect(translateDbError(noRealloc).code).toBe('INVARIANT_VIOLATION');
      expect(await refundCount(tx, w.trip)).toBe(0);
    });
  });

  it('rejeu : même clé, même règlement ⇒ même ordre (replayed), aucun second ordre ; même clé, autre version ⇒ IDEMPOTENCY_CONFLICT', async () => {
    await asPayments(async (tx) => {
      const w = await captured(tx, c, capture);
      const r1 = recordOfVector(r.settlement);
      const v1 = await settle(tx, w.trip, 1, r1);
      const key = `trip:${w.trip}:1:v1:REFUND:card:i1:a1`;
      const first = await order(tx, w, 'REFUND', refund, v1, key);
      const again = await order(tx, w, 'REFUND', refund, v1, key);
      expect(again).toEqual({ operation_id: first.operation_id, replayed: true });
      const v2 = await settle(
        tx,
        w.trip,
        2,
        recordOf(tripOfVector(r.settlement), eventOfVector('T08'), r1),
        v1.id,
      );
      const conflict = await caught(tx, () => order(tx, w, 'REFUND', refund, v2, key));
      expect(translateDbError(conflict).code).toBe('IDEMPOTENCY_CONFLICT');
      expect(await refundCount(tx, w.trip)).toBe(1);
    });
  });

  it('16 PAY-021 : remboursement au-delà de l’encaissé ⇒ REFUND_EXCEEDS_COLLECTED (rien encaissé ; capture déjà remboursée) ; le reste exact passe', async () => {
    await asPayments(async (tx) => {
      // règlement sans aucun encaissement reporté : rien n'est remboursable
      const bare = await bareTrip(tx, c);
      const s = await settle(tx, bare.trip, 1, recordOfVector(r.settlement));
      const none = await caught(tx, () => order(tx, bare, 'REFUND', refund, s));
      expect(none).toMatchObject({ code: '55000', constraint: 'refund_exceeds_collected' });
      expect(translateDbError(none).code).toBe('REFUND_EXCEEDS_COLLECTED');
    });
    await asPayments(async (tx) => {
      const w = await captured(tx, c, capture);
      const r1 = recordOfVector(r.settlement);
      const v1 = await settle(tx, w.trip, 1, r1);
      await settleOrder(tx, (await order(tx, w, 'REFUND', refund, v1)).operation_id);
      const v2 = await settle(
        tx,
        w.trip,
        2,
        recordOf(tripOfVector(r.settlement), eventOfVector('T08'), r1),
        v1.id,
      );
      // FULL : reste dû = capture − déjà remboursé ; la capture entière une seconde fois dépasse
      // l'encaissé de chaque jambe
      const twice = await caught(tx, () => order(tx, w, 'REFUND', capture, v2));
      expect(twice).toMatchObject({ code: '55000', constraint: 'refund_exceeds_collected' });
      const rest = minus(capture, refund);
      await settleOrder(tx, (await order(tx, w, 'REFUND', rest, v2)).operation_id);
      expect(await balance(tx, w.trip, 'refunded_minor')).toEqual(capture);
      // plus rien : une unité de plus est refusée
      const extra = await caught(tx, () => order(tx, w, 'REFUND', { ...ZERO, PLATFORM: 1n }, v2));
      expect(extra).toMatchObject({ code: '55000', constraint: 'refund_exceeds_collected' });
    });
  });

  it('jamais au-delà du règlement par jambe : une unité déplacée de PLATFORM vers HOST (Σ conservée) ⇒ refus ; en vol compté', async () => {
    await asPayments(async (tx) => {
      const w = await captured(tx, c, capture);
      const v1 = await settle(tx, w.trip, 1, recordOfVector(r.settlement));
      const shifted: Legs = { ...refund, HOST: refund.HOST + 1n, PLATFORM: refund.PLATFORM - 1n };
      expect(sum(shifted)).toBe(total);
      const err = await caught(tx, () => order(tx, w, 'REFUND', shifted, v1));
      expect(err).toMatchObject({ code: '55000', constraint: 'leg_refund_exceeds_settlement' });
      expect(translateDbError(err).code).toBe('INVARIANT_VIOLATION');
      // fractions EN VOL (enregistrées, jamais reportées sur les soldes) : comptées. Une fraction f
      // de la jambe PLATFORM un peu plus grande que la moitié de sa variation : deux fois f tient
      // dans l'encaissé de PLATFORM (TJ01 / TJ08a) mais dépasse la variation (TJ02b / TJ08b)
      const f = refund.PLATFORM / 2n + 1n;
      expect(2n * f).toBeGreaterThan(refund.PLATFORM);
      expect(2n * f).toBeLessThanOrEqual(capture.PLATFORM);
      const half: Legs = { ...ZERO, PLATFORM: f };
      await order(tx, w, 'REFUND', half, v1); // PENDING, non envoyé
      const again = await caught(tx, () => order(tx, w, 'REFUND', half, v1));
      expect(again).toMatchObject({ code: '55000', constraint: 'leg_refund_exceeds_settlement' });
      // le reste exact de la variation : accepté ; Σ des deux ordres = TJ02b / TJ08b
      await order(tx, w, 'REFUND', { ...refund, PLATFORM: refund.PLATFORM - f }, v1);
      expect(await refundCount(tx, w.trip)).toBe(2);
      const extra = await caught(tx, () => order(tx, w, 'REFUND', { ...ZERO, PLATFORM: 1n }, v1));
      expect(extra?.constraint).toBe('leg_refund_exceeds_settlement');
    });
  });

  it('clé étrangère : règlement d’un autre trip, ou version inexacte ⇒ refus (23503), rien d’écrit', async () => {
    await asPayments(async (tx) => {
      const w = await captured(tx, c, capture);
      const v1 = await settle(tx, w.trip, 1, recordOfVector(r.settlement));
      const other = await insertTrip(tx, c);
      const foreign = await settle(tx, other, 1, recordOfVector(r.settlement));
      for (const ref of [foreign, { id: v1.id, version: 2 }]) {
        const err = await caught(tx, () => order(tx, w, 'REFUND', refund, ref));
        expect(err).toMatchObject({ code: '23503' });
      }
      expect(await refundCount(tx, w.trip)).toBe(0);
    });
  });

  it('08 E7 règle 5 : règlement à jambe PLATFORM retenue négative (promo maximale, annulation tardive) ⇒ FIN_REVIEW_REQUIRED, aucun ordre', async () => {
    const trip = c.currency === 'USD' ? N_MAX : NP_MAX;
    const rec = recordOf(trip, { reason: 'GUEST_CANCELLED', requestedAtMs: at(-600) });
    expect(rec.negativeLeg).toBe(true);
    await asPayments(async (tx) => {
      const w = await bareTrip(tx, c);
      const s = await settle(tx, w.trip, 1, rec);
      const legs: Legs = { ...ZERO, PLATFORM: rec.guestRefundMinor };
      const err = await caught(tx, () => order(tx, w, 'REFUND', legs, s));
      expect(err).toMatchObject({ code: '55000', constraint: 'operation_settlement_fin_review' });
      expect(translateDbError(err).code).toBe('FIN_REVIEW_REQUIRED');
      expect(await refundCount(tx, w.trip)).toBe(0);
    });
  });

  it('S-02 phrase 2 : settlement_cmd_record rejouée (même version, même contenu, autre identifiant) ⇒ le règlement existant ; autre contenu ⇒ SETTLEMENT_EXISTS', async () => {
    await asPayments(async (tx) => {
      const trip = await insertTrip(tx, c);
      const r1 = recordOfVector(r.settlement);
      const first = await settle(tx, trip, 1, r1);
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
      const replay = await callRecord(
        tx,
        { tripId: trip, version: 1 },
        settlementRecordPayload(r1),
      );
      expect(replay).toBe(first.id);
      const { rows } = await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM core.settlement_settlement WHERE trip_id = $1',
        [trip],
      );
      expect(rows[0]?.n).toBe(1);
      // même version, autre événement (FULL) : ce n'est pas un rejeu
      const other = recordOf(tripOfVector(r.settlement), eventOfVector('T08'));
      const err = await caught(tx, () =>
        callRecord(tx, { tripId: trip, version: 1 }, settlementRecordPayload(other)),
      );
      expect(translateDbError(err).code).toBe('SETTLEMENT_EXISTS');
    });
  });

  it('N-196 : webhook signé SUCCEEDED d’un remboursement sans montant ⇒ UNPROVEN, rien d’appliqué ; avec son montant ⇒ APPLIED', async () => {
    await asPayments(async (tx) => {
      const w = await captured(tx, c, capture);
      const v1 = await settle(tx, w.trip, 1, recordOfVector(r.settlement));
      const idem = `trip:${w.trip}:1:v1:REFUND:card:i1:a1`;
      const { operation_id: op } = await order(tx, w, 'REFUND', refund, v1, idem);
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'webhook_ingest' });
      const receive = async (extra: Record<string, string>): Promise<string | null> => {
        const { rows } = await tx.query<{ inbox_id: string | null }>(
          `SELECT inbox_id FROM test_fixture.us049_receive_custom($1, $2::jsonb, true, platform.now())`,
          [
            w.account,
            JSON.stringify([
              {
                type: 'refund.succeeded',
                providerReference: `ref-${op}`,
                merchantReference: idem,
                status: 'SUCCEEDED',
                occurredAt: '2031-08-01T10:00:00Z',
                ...extra,
              },
            ]),
          ],
        );
        return rows[0]?.inbox_id ?? null;
      };
      const bare = await receive({});
      expect(await applyStatus(tx, op, 'SUCCEEDED', 'WEBHOOK', null, bare)).toBe('UNPROVEN');
      const { rows } = await tx.query<{ status: string; proof_type: string | null }>(
        'SELECT status, proof_type FROM core.payment_payment_operation WHERE id = $1',
        [op],
      );
      expect(rows[0]).toEqual({ status: 'PENDING', proof_type: null });
      const paid = await receive({ amountMinor: total.toString(), currency: c.currency });
      expect(await applyStatus(tx, op, 'SUCCEEDED', 'WEBHOOK', null, paid)).toBe('APPLIED');
    });
  });
});

describe('US-224 — critère 2 : ventilation au prorata (TJ10c) refusée, seuls les montants de TJ10b passent (PYG)', () => {
  const py = COUNTRIES.find((x) => x.currency === legVector(golden, 'TJ10b').currency);
  if (py === undefined) throw new Error('aucun pays dans la devise de TJ10b');

  it('TJ10c (même total que TJ10b) ⇒ leg_refund_exceeds_settlement, aucun ordre ; TJ10b ⇒ accepté et reporté', async () => {
    await asPayments(async (tx) => {
      const w = await captured(tx, py, legsOf(legVector(golden, 'TJ10a')));
      const s = await settle(
        tx,
        w.trip,
        1,
        recordOf(J, { reason: 'GUEST_CANCELLED', requestedAtMs: at(-600) }),
      );
      const exact = negate(legsOf(legVector(golden, 'TJ10b')));
      const prorata = negate(legsOf(legVector(golden, 'TJ10c')));
      expect(sum(prorata)).toBe(sum(exact));
      const err = await caught(tx, () => order(tx, w, 'REFUND', prorata, s));
      expect(err).toMatchObject({ code: '55000', constraint: 'leg_refund_exceeds_settlement' });
      expect(await refundCount(tx, w.trip)).toBe(0);
      await settleOrder(tx, (await order(tx, w, 'REFUND', exact, s)).operation_id);
      expect(await balance(tx, w.trip, 'refunded_minor')).toEqual(exact);
    });
  });
});
