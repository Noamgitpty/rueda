/**
 * Règlement des annulations demandées par l'ops (US-215, ADR-148) : plan du moteur unique, ordres
 * par jambe, paramètres lus en base, classement des refus et enchaînement des commandes.
 *
 * Attendus : vecteurs de l'export des oracles Python (`docs/specs/tools/golden_vectors.json`, via
 * `@rueda/money/golden-vectors`) — T03 / TJ02b (critère 1), T14 / TJ06 et T15 (critère 2), T07 /
 * T08 (critère 4), T27 / TJ08b (variante PYG, critère 5) — jamais le code testé. Les entrées des
 * vecteurs (trip, événement, paramètres de test de 08) viennent de l'adaptateur de test du moteur
 * (`@rueda/money/testing`). Pays fictif `XA` (aucune constante de pays).
 */
import {
  SettlementError,
  buildSettlementRecord,
  canonicalJson,
  type SettlementTrip,
} from '@rueda/money';
import { legVector, loadGoldenVectors, settlementVector } from '@rueda/money/golden-vectors';
import { testParams, toEvent, toTrip } from '@rueda/money/testing';
import { describe, expect, it } from 'vitest';
import { BusRegistry, assertSafeAlert } from '../../bus/index.js';
import type {
  AlertChannel,
  OpsAlert,
  SqlClient,
  SqlResult,
  WorkerTransactions,
} from '../../bus/index.js';
import {
  CancellationPlanError,
  TRIP_CANCELLATION_MAX_RETRIES,
  TripCancellationProcessor,
  UNEXPECTED_CODE,
  cancellationEvent,
  cancellationParams,
  classify,
  orderKey,
  ordersByTender,
  planCancellation,
  registerTripCancellations,
  tenderKindOf,
  type CancellationFacts,
  type CancellationPlan,
  type CaptureTender,
} from './trip-cancellation.js';

const golden = loadGoldenVectors();
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const SEGMENT_ID = '22222222-2222-4222-8222-222222222222';
const CANCELLATION_ID = '33333333-3333-4333-8333-333333333333';

/** Faits d'une demande rejouant le vecteur `id` (instants et paramètres de test de 08). */
function factsOf(
  id: string,
  over: Partial<CancellationFacts> = {},
): { facts: CancellationFacts; trip: SettlementTrip } {
  const v = settlementVector(golden, id);
  const trip = toTrip(v.trip);
  const event = toEvent(v.event);
  const facts: CancellationFacts = {
    cancellationId: CANCELLATION_ID,
    tripId: TRIP_ID,
    segmentId: SEGMENT_ID,
    country: 'XA',
    currency: trip.currency.code,
    tripRowVersion: 3,
    startAtMs: trip.startAtMs,
    bookedAtMs: trip.bookedAtMs,
    requestedReason: event.reason,
    subReason: event.subReason ?? null,
    evidenceValidated: event.evidenceValidated === true,
    checkinValidated: false,
    requestedAtMs: event.requestedAtMs,
    frozen: null,
    // forme canonique que rend la base (0124, core.booking_cancellation_params)
    params: JSON.parse(canonicalJson(testParams(trip.currency))) as unknown,
    ...over,
  };
  return { facts, trip };
}

const legsOf = (id: string): Record<string, bigint> => ({ ...legVector(golden, id).legsMinor });
const negate = (l: Record<string, bigint>): Record<string, bigint> =>
  Object.fromEntries(LEGS.map((k) => [k, -(l[k] ?? 0n)]));
const expected = (id: string) => settlementVector(golden, id).expected;

describe('plan du règlement d’une demande (moteur unique, vecteurs de l’export)', () => {
  it('critère 1 — T03 : remboursement 187,44 ventilé par jambe (TJ02b), un seul ordre REFUND, sans saisie', () => {
    const { facts, trip } = factsOf('T03');
    const plan = planCancellation(facts, trip);
    expect(plan.record.guestRefundMinor).toBe(expected('T03').guestRefundMinor);
    expect(plan.record.hostPenaltyMinor).toBe(0n);
    expect(plan.orders).toHaveLength(1);
    const refund = plan.orders[0];
    expect(refund?.kind).toBe('REFUND');
    expect(refund?.amountMinor).toBe(expected('T03').guestRefundMinor);
    // jambes explicites = − variation de TJ02b (jamais un prorata)
    expect({ ...refund?.legs }).toEqual(negate(legsOf('TJ02b')));
  });

  it('critère 2 — T14 (T−30 h) : remboursement intégral (TJ06), pénalité de 25,00 hors jambes ; T15 (T−24 h pile) : palier « ≤ 24 h »', () => {
    const t14 = factsOf('T14');
    const p14 = planCancellation(t14.facts, t14.trip);
    expect(p14.record.guestRefundMinor).toBe(expected('T14').guestRefundMinor);
    expect(p14.record.hostPenaltyMinor).toBe(expected('T14').hostPenaltyMinor);
    expect({ ...p14.orders[0]?.legs }).toEqual(negate(legsOf('TJ06')));
    // la pénalité n'est sur aucune jambe : Σ jambes de l'ordre = remboursement du voyageur
    expect(LEGS.reduce((s, k) => s + (p14.orders[0]?.legs[k] ?? 0n), 0n)).toBe(
      p14.record.guestRefundMinor,
    );
    const t15 = factsOf('T15');
    const p15 = planCancellation(t15.facts, t15.trip);
    expect(p15.record.hostPenaltyMinor).toBe(expected('T15').hostPenaltyMinor);
  });

  it('critère 4 — T07 / T08 : la qualification dépend de la preuve validée', () => {
    const t07 = factsOf('T07');
    expect(t07.facts.evidenceValidated).toBe(true);
    const p07 = planCancellation(t07.facts, t07.trip);
    expect(p07.record.reason).toBe(expected('T07').qualifiedReason);
    expect(p07.record.guestRefundMinor).toBe(expected('T07').guestRefundMinor);
    // même demande sans preuve : requalifiée HOST_CANCELLED (T08)
    const t08 = factsOf('T07', { evidenceValidated: false });
    const p08 = planCancellation(t08.facts, t08.trip);
    expect(p08.record.reason).toBe(expected('T08').qualifiedReason);
    expect(p08.record.origin).toBe('REQUALIFIED_NO_EVIDENCE');
    expect(p08.record.guestRefundMinor).toBe(expected('T08').guestRefundMinor);
    expect(p08.record.hostPenaltyMinor).toBe(expected('T08').hostPenaltyMinor);
  });

  it('critère 5 — variante sans décimale : T27 (TJ08b) à l’unité près', () => {
    const { facts, trip } = factsOf('T27');
    expect(trip.currency.exponent).toBe(0);
    const plan = planCancellation(facts, trip);
    expect(plan.record.guestRefundMinor).toBe(expected('T27').guestRefundMinor);
    expect({ ...plan.orders[0]?.legs }).toEqual(negate(legsOf('TJ08b')));
  });

  it('événement : seulement les faits de la base, dans la forme contrôlée par la base', () => {
    const { facts } = factsOf('T03');
    expect(cancellationEvent(facts)).toEqual({
      reason: 'GUEST_CANCELLED',
      requestedAtMs: facts.requestedAtMs,
      checkinValidated: false,
    });
    const host = cancellationEvent({
      ...facts,
      requestedReason: 'HOST_CANCELLED_DUE_TO_GUEST',
      subReason: 'INVALID_LICENSE',
      evidenceValidated: true,
    });
    expect(host).toEqual({
      reason: 'HOST_CANCELLED_DUE_TO_GUEST',
      requestedAtMs: facts.requestedAtMs,
      subReason: 'INVALID_LICENSE',
      evidenceValidated: true,
      checkinValidated: false,
    });
  });

  it('paramètres : aucun défaut ; absents ou mal formés ⇒ PARAM_MISSING (BLOCK)', () => {
    const { trip, facts } = factsOf('T03');
    const ok = cancellationParams(facts.params, trip.currency);
    expect(canonicalJson(ok)).toBe(canonicalJson(testParams(trip.currency)));
    const base = facts.params as Record<string, unknown>;
    for (const bad of [
      null,
      [],
      { ...base, noShowGraceMinutes: '60' },
      { ...base, freeCancelLeadHours: 1.5 },
      { ...base, lastMinuteThresholdHours: undefined },
      { ...base, hostPenalty: 'x' },
      { ...base, hostPenalty: { cxlEarly: { amountMinor: { $bigint: '-1' }, currency: 'x' } } },
    ]) {
      expect(() => cancellationParams(bad, trip.currency), JSON.stringify(bad)).toThrow(
        CancellationPlanError,
      );
    }
    // compensation de l'hôte (DEC-FONDATEUR-01) : recopiée telle quelle, absente ⇒ absente
    expect('platformFundedHostCompensation' in ok).toBe(false);
    const withFlag = cancellationParams(
      { ...base, platformFundedHostCompensation: false },
      trip.currency,
    );
    expect(withFlag.platformFundedHostCompensation).toBe(false);
  });

  it('clé d’idempotence d’un remboursement : forme de 08 E4, moyen = capture d’origine', () => {
    const { facts, trip } = factsOf('T03');
    const order = planCancellation(facts, trip).orders[0];
    if (order === undefined) throw new Error('ordre attendu');
    expect(orderKey(facts, order, 'cap-1')).toBe(`${TRIP_ID}:${SEGMENT_ID}:v1:REFUND:cap-1:i1:a1`);
  });
});

/**
 * US-224f (ADR-166) — ordres par moyen d'origine (08 E2 puis E7 règle 10). Attendus : export des
 * oracles (TJ16a à TJ16d, TJ02b, TJ08b) ; montants par moyen de `check_legs.py` (`e2_refunds` :
 * T33 → [150,00 ; 37,44 ; 0 ; 0], T07 → [138,22 ; 0 ; 0 ; 0]) et de `check_t49plus.py` (`allocate`,
 * deux cartes : la plus récente absorbe d'abord : PYG {c2: 367, c1: 1 000 000}, USD {c2: 37,44,
 * c1: 150,00}).
 */
const card = (
  id: string,
  amountMinor: bigint,
  committedMinor = 0n,
  method = 'CARD',
): CaptureTender => ({
  operationId: id,
  accountId: `acc-${id}`,
  method,
  amountMinor,
  committedMinor,
});
const refundsOf = (orders: ReturnType<typeof ordersByTender>) =>
  orders.filter((o) => o.kind === 'REFUND');

describe('US-224f — remboursement réparti sur les moyens d’origine (08 E2, E7 règle 10)', () => {
  it('devise sans décimale (critère 6) : D payé par deux cartes 1 000 000 et 438 050, T27 ⇒ ordres TJ16c puis TJ16d, natifs, rang 1 chacun ; Σ = TJ08b à l’unité', () => {
    const { facts, trip } = factsOf('T27');
    const plan = planCancellation(facts, trip);
    const orders = ordersByTender(plan, [card('c1', 1_000_000n), card('c2', 438_050n)]);
    expect(orders.map((o) => [o.kind, o.tender.operationId, o.rail, o.instanceSeq])).toEqual([
      ['REFUND', 'c1', 'NATIVE_PARTIAL', 1],
      ['REFUND', 'c2', 'NATIVE_PARTIAL', 1],
    ]);
    expect({ ...orders[0]?.legs }).toEqual(negate(legsOf('TJ16c')));
    expect({ ...orders[1]?.legs }).toEqual(negate(legsOf('TJ16d')));
    const sum = Object.fromEntries(
      LEGS.map((k) => [k, (orders[0]?.legs[k] ?? 0n) + (orders[1]?.legs[k] ?? 0n)]),
    );
    expect(sum).toEqual(negate(legsOf('TJ08b')));
    expect(orders.reduce((s, o) => s + o.amountMinor, 0n)).toBe(expected('T27').guestRefundMinor);
  });

  it('devise à deux décimales : A payé par deux cartes 150,00 et 106,66, T03 ⇒ ordres TJ16a puis TJ16b ; clé de chaque ordre sur son moyen', () => {
    const { facts, trip } = factsOf('T03');
    const orders = ordersByTender(planCancellation(facts, trip), [
      card('c1', 15_000n),
      card('c2', 10_666n),
    ]);
    expect({ ...orders[0]?.legs }).toEqual(negate(legsOf('TJ16a')));
    expect({ ...orders[1]?.legs }).toEqual(negate(legsOf('TJ16b')));
    expect(orders.map((o) => orderKey(facts, o, o.tender.operationId))).toEqual([
      `${TRIP_ID}:${SEGMENT_ID}:v1:REFUND:c1:i1:a1`,
      `${TRIP_ID}:${SEGMENT_ID}:v1:REFUND:c2:i1:a1`,
    ]);
  });

  it('moyens non natifs ENTIÈREMENT absorbés (T07 payé comme T33, E2 : [138,22 ; 0 ; 0 ; 0]) : un seul remboursement, sur la carte, du remboursement de T07', () => {
    const { facts, trip } = factsOf('T07');
    const orders = ordersByTender(planCancellation(facts, trip), [
      card('card', 15_000n),
      card('yappy', 5_666n, 0n, 'YAPPY'),
      card('cash', 3_000n, 0n, 'CREDIT_CASH'),
      card('promo', 2_000n, 0n, 'CREDIT_PROMO'),
    ]);
    expect(refundsOf(orders).map((o) => [o.tender.operationId, o.rail])).toEqual([
      ['card', 'NATIVE_PARTIAL'],
    ]);
    const refund = refundsOf(orders)[0];
    expect(refund?.amountMinor).toBe(expected('T07').guestRefundMinor);
    expect(LEGS.reduce((s, k) => s + (refund?.legs[k] ?? 0n), 0n)).toBe(refund?.amountMinor);
  });

  it('fail-closed (bêta) : un moyen non natif ou un crédit cash qui doit rembourser ⇒ REFUND_RAIL_UNAVAILABLE (TJ16b Yappy, TJ16d crédit cash recréé)', () => {
    const t03 = factsOf('T03');
    expect(() =>
      ordersByTender(planCancellation(t03.facts, t03.trip), [
        card('card', 15_000n),
        card('yappy', 5_666n, 0n, 'YAPPY'),
        card('cash', 3_000n, 0n, 'CREDIT_CASH'),
        card('promo', 2_000n, 0n, 'CREDIT_PROMO'),
      ]),
    ).toThrow(new CancellationPlanError('REFUND_RAIL_UNAVAILABLE'));
    const t27 = factsOf('T27');
    expect(() =>
      ordersByTender(planCancellation(t27.facts, t27.trip), [
        card('card', 1_000_000n),
        card('cash', 438_050n, 0n, 'CREDIT_CASH'),
      ]),
    ).toThrow(new CancellationPlanError('REFUND_RAIL_UNAVAILABLE'));
  });

  it('aucun moyen ⇒ TRIP_NOT_CAPTURED ; moyen déjà engagé : jamais au-delà de son reliquat (REFUND_OUT_OF_RANGE)', () => {
    const { facts, trip } = factsOf('T27');
    const plan = planCancellation(facts, trip);
    expect(() => ordersByTender(plan, [])).toThrow(new CancellationPlanError('TRIP_NOT_CAPTURED'));
    expect(() =>
      ordersByTender(plan, [card('c1', 1_000_000n, 1_000_000n), card('c2', 438_050n)]),
    ).toThrow(SettlementError);
  });

  it('catégorie d’un moyen : la carte seule est native ; un moyen inconnu n’est jamais natif', () => {
    expect(tenderKindOf('CARD')).toBe('NATIVE');
    expect(tenderKindOf('CREDIT_CASH')).toBe('CASH_CREDIT');
    expect(tenderKindOf('CREDIT_PROMO')).toBe('PROMO_CREDIT');
    for (const m of ['YAPPY', 'QR', 'CLAVE', 'PIX', 'BANK_TRANSFER', 'card', null]) {
      expect(tenderKindOf(m)).toBe('NON_NATIVE');
    }
  });
});

describe('classement des refus', () => {
  it('moteur, plan et base : FAILED ou FIN_REVIEW ; interblocage : RETRY ; erreur inconnue relancée', () => {
    expect(classify(new CancellationPlanError('QUOTE_UNAVAILABLE'))).toEqual({
      outcome: 'FAILED',
      code: 'QUOTE_UNAVAILABLE',
    });
    expect(classify({ code: '55000', constraint: 'operation_settlement_fin_review' })).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'OPERATION_SETTLEMENT_FIN_REVIEW',
    });
    // US-227 (ADR-165) : jambe INSURER déjà portée par un bordereau émis ⇒ revue FIN
    expect(classify({ code: '55000', constraint: 'insurer_leg_on_bordereau' })).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'INSURER_LEG_ON_BORDEREAU',
    });
    expect(classify({ code: '55000', constraint: 'trip_transition_forbidden' })).toEqual({
      outcome: 'FAILED',
      code: 'TRIP_TRANSITION_FORBIDDEN',
    });
    expect(classify({ code: '40P01' })).toEqual({ outcome: 'RETRY', code: 'RETRY' });
    expect(() => classify(new Error('réseau'))).toThrow('réseau');
  });

  it('N-365 (ADR-090 décision 2, ADR-166 n° 8) : REFUND_OUT_OF_RANGE, où qu’il soit levé, va à la revue FIN ; les autres refus du moteur restent FAILED', () => {
    expect(classify(new SettlementError('REFUND_OUT_OF_RANGE', 'hors bornes'))).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'REFUND_OUT_OF_RANGE',
    });
    expect(classify(new SettlementError('TOTAL_PAID_NOT_POSITIVE', 'total nul'))).toEqual({
      outcome: 'FAILED',
      code: 'TOTAL_PAID_NOT_POSITIVE',
    });
  });
});

describe('N-365 — preuves de 224f : rattachement de la réaffectation (ADR-166 n° 2)', () => {
  // T39 (USD) : variation TJ05b, PLATFORM en hausse ⇒ réaffectation passée avant le remboursement
  // (08 E7 règle 3) ; remboursement de chaque moyen : `allocate` de `check_t49plus.py` et `e2_refunds`
  // de `check_legs.py` (`python -I -X utf8`, 2026-11-18) : deux cartes [150,00 ; 106,66] ⇒
  // {c1 : 138,22, c2 : 0} ; Yappy capturé d'abord puis carte ⇒ {carte : 138,22, Yappy : 0}
  it('réaffectation sur le premier moyen de la cascade : catégorie native d’abord, puis la capture la plus ancienne (clé et compte du moyen)', () => {
    // T39 est un no-show du voyageur (motif hors de la console) : règlement du moteur unique sur le
    // vecteur, comme `recordOfVector` des preuves L0 ; seuls le règlement et la devise sont lus
    const { facts } = factsOf('T39');
    const v = settlementVector(golden, 'T39');
    const trip = toTrip(v.trip);
    const plan: CancellationPlan = {
      record: buildSettlementRecord(trip, toEvent(v.event), testParams(trip.currency)),
      currency: trip.currency,
      orders: [],
    };
    const realloc = (o: ReturnType<typeof ordersByTender>) =>
      o.filter((x) => x.kind === 'LEG_REALLOCATION');
    const platformGain = legsOf('TJ05b')['PLATFORM'] ?? 0n;
    expect(platformGain > 0n).toBe(true);

    const cards = ordersByTender(plan, [card('c1', 15_000n), card('c2', 10_666n)]);
    expect(cards.map((o) => o.kind)).toEqual(['LEG_REALLOCATION', 'REFUND']);
    expect(realloc(cards).map((o) => [o.tender.operationId, o.tender.accountId])).toEqual([
      ['c1', 'acc-c1'],
    ]);
    const moved = realloc(cards)[0];
    if (moved === undefined) throw new Error('réaffectation attendue');
    expect(moved.amountMinor).toBe(platformGain);
    expect(moved.legs['PLATFORM']).toBe(platformGain);
    expect(orderKey(facts, moved, moved.tender.operationId)).toBe(
      `${TRIP_ID}:${SEGMENT_ID}:v1:LEG_REALLOCATION:c1:i1:a1`,
    );
    expect(refundsOf(cards).map((o) => [o.tender.operationId, o.amountMinor])).toEqual([
      ['c1', 13_822n],
    ]);

    // le moyen capturé en premier n'est pas natif : la réaffectation suit la cascade (carte)
    const mixed = ordersByTender(plan, [
      card('yappy', 10_666n, 0n, 'YAPPY'),
      card('card', 15_000n),
    ]);
    expect(realloc(mixed).map((o) => [o.tender.operationId, o.tender.accountId])).toEqual([
      ['card', 'acc-card'],
    ]);
    expect(refundsOf(mixed).map((o) => [o.tender.operationId, o.rail, o.amountMinor])).toEqual([
      ['card', 'NATIVE_PARTIAL', 13_822n],
    ]);
    expect(refundsOf(mixed)[0]?.amountMinor).toBe(expected('T39').guestRefundMinor);
  });
});

// ------------------------------------------------------------------ enchaînement des commandes

interface Call {
  readonly worker: string;
  readonly sql: string;
}

class FakeDb implements SqlClient {
  worker = '';
  readonly calls: Call[] = [];
  constructor(private readonly answer: (sql: string) => unknown[] | Error) {}
  async query<R>(text: string, params?: readonly unknown[]): Promise<SqlResult<R>> {
    if (text.includes("set_config('app.worker_name'")) {
      this.worker = String(params?.[0]);
      return { rows: [], rowCount: 0 };
    }
    this.calls.push({ worker: this.worker, sql: text.replace(/\s+/g, ' ').trim() });
    const out = this.answer(text);
    if (out instanceof Error) throw out;
    return { rows: out as R[], rowCount: out.length };
  }
}

function transactionsOf(db: FakeDb): WorkerTransactions & { runs: string[] } {
  const runs: string[] = [];
  return {
    runs,
    async run<T>(workerName: string, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      runs.push(workerName);
      db.worker = workerName;
      return fn(db);
    },
  };
}

class Alerts implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  async send(alert: OpsAlert): Promise<void> {
    assertSafeAlert(alert);
    this.sent.push(alert);
  }
}

function beginRow(f: CancellationFacts): Record<string, unknown> {
  return {
    cancellation_id: f.cancellationId,
    trip_id: f.tripId,
    segment_id: f.segmentId,
    country_code: f.country,
    currency: f.currency,
    trip_row_version: f.tripRowVersion,
    start_at_ms: String(f.startAtMs),
    booked_at_ms: String(f.bookedAtMs),
    requested_reason: f.requestedReason,
    sub_reason: f.subReason,
    evidence_validated: f.evidenceValidated,
    checkin_validated: f.checkinValidated,
    requested_at_ms: String(f.requestedAtMs),
    quote_engine_version: null,
    quote_inputs: null,
    quote_inputs_hash: null,
    quote_outputs: null,
    quote_outputs_hash: null,
    quote_total_minor: null,
    quote_currency: null,
    params: f.params,
  };
}

describe('processeur trip_lifecycle', () => {
  it('une transaction : faits, règlement (settlement), transition (trip_lifecycle), ordre REFUND (payment_command)', async () => {
    const { facts, trip } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
      if (sql.includes('settlement_cmd_record')) return [{ id: 'set-1' }];
      if (sql.includes('booking_cmd_trip_settle_cancellation'))
        return [{ r: { costBearer: 'GUEST' } }];
      if (sql.includes('payment_payment_operation'))
        return [
          {
            id: 'cap-1',
            psp_account_id: 'acc-1',
            method: 'CARD',
            amount_minor: '25666',
            committed_minor: '0',
          },
        ];
      if (sql.includes('payment_cmd_plan_refund'))
        return [
          {
            instance_id: 'ri-1',
            operation_id: 'op-1',
            advance_id: null,
            status: 'PLANNED',
            blocked_reason: null,
            replayed: false,
          },
        ];
      return new Error(`requête inattendue : ${sql}`);
    });
    const tx = transactionsOf(db);
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({ transactions: tx, alerts, tripOf: () => trip });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'SETTLED',
      costBearer: 'GUEST',
      orders: 1,
    });
    expect(tx.runs).toEqual(['trip_lifecycle']);
    expect(db.calls.map((c) => [c.worker, /core\.([a-z_]+)/.exec(c.sql)?.[1]])).toEqual([
      ['trip_lifecycle', 'booking_trip_cancellation_begin'],
      ['settlement', 'settlement_cmd_record'],
      ['trip_lifecycle', 'booking_cmd_trip_settle_cancellation'],
      ['payment_command', 'payment_payment_operation'],
      ['payment_command', 'payment_cmd_plan_refund'],
    ]);
    expect(alerts.sent).toEqual([]);
  });

  it('demande déjà traitée : rien d’écrit', async () => {
    const db = new FakeDb((sql) =>
      sql.includes('booking_trip_cancellation_begin') ? [] : new Error(sql),
    );
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts: new Alerts(),
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({ outcome: 'SKIPPED' });
  });

  it('refus déterministe (devis introuvable) : transaction annulée, demande garée FAILED, alerte P1 sans identifiant', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
      if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
      return new Error(sql);
    });
    const tx = transactionsOf(db);
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({ transactions: tx, alerts });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'FAILED',
      code: 'QUOTE_UNAVAILABLE',
    });
    expect(tx.runs).toEqual(['trip_lifecycle', 'trip_lifecycle']);
    expect(db.calls.some((c) => c.sql.includes('settlement_cmd_record'))).toBe(false);
    expect(alerts.sent).toEqual([
      {
        code: 'TRIP_CANCELLATION_FAILED',
        severity: 'P1',
        counts: { cancellations: 1 },
        labels: { country: 'XA', error_code: 'QUOTE_UNAVAILABLE' },
      },
    ]);
  });

  it('ordre refusé pour décision FINANCE (jambe négative, US-224b) : FIN_REVIEW et alerte FIN', async () => {
    const { facts, trip } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
      if (sql.includes('settlement_cmd_record')) return [{ id: 'set-1' }];
      if (sql.includes('booking_cmd_trip_settle_cancellation'))
        return [{ r: { costBearer: 'GUEST' } }];
      if (sql.includes('payment_payment_operation'))
        return [
          {
            id: 'cap-1',
            psp_account_id: 'acc-1',
            method: 'CARD',
            amount_minor: '25666',
            committed_minor: '0',
          },
        ];
      if (sql.includes('payment_cmd_plan_refund'))
        return Object.assign(new Error('fin'), {
          code: '55000',
          constraint: 'operation_settlement_fin_review',
        });
      if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
      return new Error(sql);
    });
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts,
      tripOf: () => trip,
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'OPERATION_SETTLEMENT_FIN_REVIEW',
    });
    expect(alerts.sent.map((a) => a.code)).toEqual(['FIN_SETTLEMENT_REVIEW']);
  });

  it('trip sans encaissement du loyer : FAILED (TRIP_NOT_CAPTURED), jamais un moyen deviné', async () => {
    const { facts, trip } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
      if (sql.includes('settlement_cmd_record')) return [{ id: 'set-1' }];
      if (sql.includes('booking_cmd_trip_settle_cancellation'))
        return [{ r: { costBearer: 'GUEST' } }];
      if (sql.includes('payment_payment_operation')) return [];
      if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
      return new Error(sql);
    });
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts: new Alerts(),
      tripOf: () => trip,
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'FAILED',
      code: 'TRIP_NOT_CAPTURED',
    });
  });

  it('interblocage : demande laissée en attente (aucune mise en garde, aucune alerte)', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) {
        return Object.assign(new Error('deadlock'), { code: '40P01' });
      }
      return new Error(sql);
    });
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({ transactions: transactionsOf(db), alerts });
    expect(await p.process(facts.cancellationId)).toEqual({ outcome: 'RETRY', code: 'RETRY' });
    expect(db.calls.some((c) => c.sql.includes('park'))).toBe(false);
    expect(alerts.sent).toEqual([]);
  });
});

describe('isolement des demandes, alertes et essais bornés (revue code n° 1 à 4, 7)', () => {
  const ok = (facts: CancellationFacts) => (sql: string) => {
    if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
    if (sql.includes('settlement_cmd_record')) return [{ id: 'set-1' }];
    if (sql.includes('booking_cmd_trip_settle_cancellation'))
      return [{ r: { costBearer: 'GUEST' } }];
    if (sql.includes('payment_payment_operation'))
      return [{ id: 'cap-1', psp_account_id: 'acc-1', method: 'CARD' }];
    if (sql.includes('payment_cmd_plan_refund'))
      return [
        {
          instance_id: 'ri-1',
          operation_id: 'op-1',
          advance_id: null,
          status: 'PLANNED',
          blocked_reason: null,
          replayed: false,
        },
      ];
    if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
    return new Error(sql);
  };

  it('erreur sans SQLSTATE (programme) : garée FAILED UNEXPECTED_ERROR, alerte, journal sans identifiant ; process ne lève pas', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb(ok(facts));
    const alerts = new Alerts();
    const logs: string[] = [];
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts,
      log: (l) => logs.push(l),
      tripOf: () => {
        throw new TypeError('devis illisible');
      },
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({ outcome: 'FAILED', code: UNEXPECTED_CODE });
    expect(db.calls.some((c) => c.sql.includes('booking_cmd_trip_park_cancellation'))).toBe(true);
    expect(alerts.sent.map((a) => [a.code, a.labels?.error_code])).toEqual([
      ['TRIP_CANCELLATION_FAILED', UNEXPECTED_CODE],
    ]);
    expect(logs.map((l) => JSON.parse(l) as unknown)).toEqual([
      { worker: 'trip_lifecycle', level: 'error', event: 'unexpected', error_class: 'TypeError' },
    ]);
    for (const l of logs) expect(l).not.toContain(CANCELLATION_ID);
  });

  it('REFUND_OUT_OF_RANGE du moteur : FIN_REVIEW garé, UNE seule alerte FIN_SETTLEMENT_REVIEW', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb(ok(facts));
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts,
      tripOf: () => {
        throw new SettlementError('REFUND_OUT_OF_RANGE', 'remboursement hors bornes');
      },
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'REFUND_OUT_OF_RANGE',
    });
    expect(alerts.sent.map((a) => a.code)).toEqual(['FIN_SETTLEMENT_REVIEW']);
    expect(db.calls.some((c) => c.sql.includes('booking_cmd_trip_park_cancellation'))).toBe(true);
  });

  it('N-365 : REFUND_OUT_OF_RANGE de 08 E2 (moyen déjà engagé) ⇒ FIN_REVIEW garé, UNE alerte FIN_SETTLEMENT_REVIEW, aucun ordre écrit', async () => {
    const { facts, trip } = factsOf('T27');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
      if (sql.includes('settlement_cmd_record')) return [{ id: 'set-1' }];
      if (sql.includes('booking_cmd_trip_settle_cancellation'))
        return [{ r: { costBearer: 'GUEST' } }];
      if (sql.includes('payment_payment_operation'))
        // première carte déjà entièrement engagée : Σ reliquats (438 050) < remboursement de T27
        return [
          {
            id: 'c1',
            psp_account_id: 'acc-c1',
            method: 'CARD',
            amount_minor: '1000000',
            committed_minor: '1000000',
          },
          {
            id: 'c2',
            psp_account_id: 'acc-c2',
            method: 'CARD',
            amount_minor: '438050',
            committed_minor: '0',
          },
        ];
      if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
      return new Error(sql);
    });
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts,
      tripOf: () => trip,
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'REFUND_OUT_OF_RANGE',
    });
    expect(alerts.sent.map((a) => [a.code, a.labels?.error_code])).toEqual([
      ['FIN_SETTLEMENT_REVIEW', 'REFUND_OUT_OF_RANGE'],
    ]);
    expect(db.calls.some((c) => c.sql.includes('payment_cmd_plan_refund'))).toBe(false);
    const parked = db.calls.filter((c) => c.sql.includes('booking_cmd_trip_park_cancellation'));
    expect(parked).toHaveLength(1);
  });

  it('interblocages répétés : RETRY jusqu’à la borne, puis FAILED RETRY_EXHAUSTED, alerté et garé', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) {
        return Object.assign(new Error('deadlock'), { code: '40P01' });
      }
      if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
      return new Error(sql);
    });
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({ transactions: transactionsOf(db), alerts });
    for (let i = 1; i < TRIP_CANCELLATION_MAX_RETRIES; i++) {
      expect(await p.process(facts.cancellationId)).toEqual({ outcome: 'RETRY', code: 'RETRY' });
    }
    expect(alerts.sent).toEqual([]);
    expect(await p.process(facts.cancellationId)).toEqual({
      outcome: 'FAILED',
      code: 'RETRY_EXHAUSTED',
    });
    expect(alerts.sent.map((a) => [a.code, a.labels?.error_code])).toEqual([
      ['TRIP_CANCELLATION_FAILED', 'RETRY_EXHAUSTED'],
    ]);
  });

  it('alerte impossible : rien n’est garé (la demande reste en attente, DEFERRED), jamais un garage silencieux', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb(ok(facts));
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts: { send: () => Promise.reject(new Error('canal indisponible')) },
      tripOf: () => {
        throw new TypeError('x');
      },
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'DEFERRED',
      code: UNEXPECTED_CODE,
    });
    expect(db.calls.some((c) => c.sql.includes('booking_cmd_trip_park_cancellation'))).toBe(false);
  });

  it('tâche périodique : une demande en échec inattendu ne bloque pas la suivante ; comptes seulement au journal', async () => {
    const { facts } = factsOf('T03');
    const bad = '44444444-4444-4444-8444-444444444444';
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellations_pending'))
        return [{ id: bad }, { id: CANCELLATION_ID }];
      return ok(facts)(sql);
    });
    const registry = new BusRegistry();
    const logs: string[] = [];
    let call = 0;
    const tx = transactionsOf(db);
    const alerts = new Alerts();
    registerTripCancellations(
      registry,
      {
        run: async (worker, fn) => {
          call++;
          // première demande : la lecture des faits rend une ligne illisible (forme inattendue)
          if (call === 1) {
            return tx.run(worker, () => Promise.reject(new TypeError('ligne inattendue')));
          }
          return tx.run(worker, fn);
        },
      },
      alerts,
      (l) => logs.push(l),
    );
    const h = registry.handlerOf('trip_lifecycle');
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    await h.handle({}, db);
    const summary = logs.map((l) => JSON.parse(l) as Record<string, unknown>).at(-1);
    // première : erreur inattendue ⇒ FAILED ; seconde : traitée quand même (sans devis figé dans
    // ce double : QUOTE_UNAVAILABLE ⇒ FAILED) ; les deux garées et alertées
    expect(summary).toMatchObject({ worker: 'trip_lifecycle', failed: 2, settled: 0 });
    expect(
      db.calls.filter((c) => c.sql.includes('booking_cmd_trip_park_cancellation')),
    ).toHaveLength(2);
    expect(alerts.sent.map((a) => a.labels?.error_code)).toEqual([
      UNEXPECTED_CODE,
      'QUOTE_UNAVAILABLE',
    ]);
    for (const l of logs) {
      expect(l).not.toContain(bad);
      expect(l).not.toContain(CANCELLATION_ID);
    }
    expect(db.calls.filter((c) => c.sql.includes('booking_trip_cancellation_begin'))).toHaveLength(
      1,
    );
  });
});

describe('US-307 (ADR-191) — no-show déclaré : hostMessageTraced lu en base, réaffectation gardée par la capacité', () => {
  const captureRow = {
    id: 'cap-1',
    psp_account_id: 'acc-1',
    method: 'CARD',
    amount_minor: '25666',
    committed_minor: '0',
  };
  const planned = {
    instance_id: 'ri-1',
    operation_id: 'op-1',
    advance_id: null,
    status: 'PLANNED',
    blocked_reason: null,
    replayed: false,
  };

  it('T05 (message tracé) et T39 (aucun message) : événement du moteur = fait de la base ; 138,22 dans les deux cas, gains 75,00 puis 0,00 (oracle)', () => {
    for (const [vector, traced, host] of [
      ['T05', true, 7_500n],
      ['T39', false, 0n],
    ] as const) {
      const { facts, trip } = factsOf(vector, { hostMessageTraced: traced });
      expect(cancellationEvent(facts)).toMatchObject({
        reason: 'GUEST_NO_SHOW',
        hostMessageTraced: traced,
      });
      const plan = planCancellation(facts, trip);
      expect(plan.record.guestRefundMinor).toBe(13_822n);
      expect(plan.record.hostEarningsMinor).toBe(host);
    }
    // autre motif : jamais de fait hostMessageTraced dans l'événement lié par la base (0124)
    const t03 = factsOf('T03', { hostMessageTraced: true }).facts;
    expect(cancellationEvent(t03)).not.toHaveProperty('hostMessageTraced');
  });

  it('no-show du voyageur sans le fait en base ⇒ refus du moteur (fail-closed), jamais une valeur par défaut', () => {
    const { facts, trip } = factsOf('T05', { hostMessageTraced: null });
    expect(() => planCancellation(facts, trip)).toThrow(
      expect.objectContaining({ code: 'SETTLEMENT_INPUT_INVALID' }),
    );
  });

  it('T39 : faits lus (début, drapeaux), garde de la capacité AVANT la réaffectation, puis le remboursement', async () => {
    const { facts, trip } = factsOf('T39', { hostMessageTraced: false });
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
      if (sql.includes('booking_trip_cancellation_flags')) return [{ host_message_traced: false }];
      if (sql.includes('settlement_cmd_record')) return [{ id: 'set-1' }];
      if (sql.includes('booking_cmd_trip_settle_cancellation'))
        return [{ r: { costBearer: 'GUEST' } }];
      if (sql.includes('payment_payment_operation')) return [captureRow];
      if (sql.includes('payment_assert_payout_adjustment')) return [{}];
      if (sql.includes('payment_cmd_record_operation'))
        return [{ operation_id: 'op-r', replayed: false }];
      if (sql.includes('payment_cmd_plan_refund')) return [planned];
      return new Error(`requête inattendue : ${sql}`);
    });
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts: new Alerts(),
      tripOf: () => trip,
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'SETTLED',
      costBearer: 'GUEST',
      orders: 2,
    });
    expect(db.calls.map((c) => [c.worker, /core\.([a-z_]+)/.exec(c.sql)?.[1]])).toEqual([
      ['trip_lifecycle', 'booking_trip_cancellation_begin'],
      ['trip_lifecycle', 'booking_trip_cancellation_flags'],
      ['settlement', 'settlement_cmd_record'],
      ['trip_lifecycle', 'booking_cmd_trip_settle_cancellation'],
      ['payment_command', 'payment_payment_operation'],
      ['payment_command', 'payment_assert_payout_adjustment'],
      ['payment_command', 'payment_cmd_record_operation'],
      ['payment_command', 'payment_cmd_plan_refund'],
    ]);
  });

  it('capacité inconnue (leg_reallocation_unsupported) ⇒ FIN_REVIEW garé, alerte FIN, aucun ordre écrit', async () => {
    const { facts, trip } = factsOf('T39', { hostMessageTraced: false });
    const refused = Object.assign(new Error('payment: payout adjustment not validated'), {
      code: '55000',
      constraint: 'leg_reallocation_unsupported',
    });
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
      if (sql.includes('booking_trip_cancellation_flags')) return [{ host_message_traced: false }];
      if (sql.includes('settlement_cmd_record')) return [{ id: 'set-1' }];
      if (sql.includes('booking_cmd_trip_settle_cancellation'))
        return [{ r: { costBearer: 'GUEST' } }];
      if (sql.includes('payment_payment_operation')) return [captureRow];
      if (sql.includes('payment_assert_payout_adjustment')) return refused;
      if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
      return new Error(`requête inattendue : ${sql}`);
    });
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts,
      tripOf: () => trip,
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'LEG_REALLOCATION_UNSUPPORTED',
    });
    expect(alerts.sent.map((a) => a.code)).toEqual(['FIN_SETTLEMENT_REVIEW']);
    expect(db.calls.some((c) => c.sql.includes('payment_cmd_record_operation'))).toBe(false);
    expect(db.calls.some((c) => c.sql.includes('payment_cmd_plan_refund'))).toBe(false);
    expect(classify(refused)).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'LEG_REALLOCATION_UNSUPPORTED',
    });
  });
});
