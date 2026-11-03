/**
 * US-018 — forme persistée du règlement : versions, supersession, jambes (08 E4, E7 ; 17 §2.9,
 * §3.2.8 ; ADR-057). Attendus tirés de l'export des oracles (`@rueda/money/golden-vectors`,
 * US-016) : TJ01, TJ02a/b (T03), TJ08a/b (T27, PYG), TJ18a, TJ18c, TJ13a à d, contrôle T36 de
 * `independent_settlement_check.py`, clés de T49 / T50 de `check_t49plus.py`. Aucun attendu n'est
 * recalculé par le code testé.
 */
import { describe, expect, it } from 'vitest';
import {
  checksFor,
  legVector,
  loadGoldenVectors,
  settlementVector,
  type GoldenLegVector,
} from '../../src/golden-vectors/index.ts';
import {
  LEGS,
  buildSettlementRecord,
  computeCancellationSettlement,
  isSettlementError,
  pspIdempotencyValue,
  settlementDelta,
  settlementInputsHash,
  settlementOperationKey,
  settlementParamsHash,
  settlementRecordPayload,
  signedLegs,
  type CancellationEvent,
  type Leg,
  type SettlementRecord,
} from '../../src/index.ts';
import { N, NP, NP_MAX, N_MAX, at, testParams, toEvent, toTrip } from './adapter.ts';

const set = loadGoldenVectors();

/** Record d'un vecteur de règlement de l'export (paramètres de test de 08). */
function recordOf(id: string, previous?: SettlementRecord): SettlementRecord {
  const v = settlementVector(set, id);
  const trip = toTrip(v.trip);
  return buildSettlementRecord(trip, toEvent(v.event), testParams(trip.currency), previous);
}

const legsOf = (r: SettlementRecord, field: 'keptMinor' | 'basisMinor' | 'variationMinor') =>
  Object.fromEntries(LEGS.map((l) => [l, r.legs.find((x) => x.leg === l)?.[field]]));
const tj = (id: string): GoldenLegVector => legVector(set, id);
const sumOf = (a: GoldenLegVector, b: GoldenLegVector): Record<Leg, bigint> =>
  Object.fromEntries(LEGS.map((l) => [l, a.legsMinor[l] + b.legsMinor[l]])) as Record<Leg, bigint>;
const negated = (a: GoldenLegVector): Record<Leg, bigint> =>
  Object.fromEntries(LEGS.map((l) => [l, -a.legsMinor[l]])) as Record<Leg, bigint>;

/** Invariants de 08 E7 ; Σ variations = − remboursement (v1) ou − delta de remboursement (v n+1). */
function invariants(r: SettlementRecord, previous?: SettlementRecord): void {
  const s = signedLegs(r);
  const sigma = (f: (l: Leg) => bigint): bigint => LEGS.reduce((acc, l) => acc + f(l), 0n);
  expect(sigma((l) => s[l])).toBe(r.retainedMinor + r.retainedTaxMinor);
  expect(sigma((l) => r.legs.find((x) => x.leg === l)?.variationMinor ?? 0n)).toBe(
    -(r.guestRefundMinor - (previous?.guestRefundMinor ?? 0n)),
  );
  expect(r.guestRefundMinor + r.retainedMinor + r.retainedTaxMinor).toBe(r.totalPaidMinor);
  for (const l of r.legs) {
    expect(l.keptMinor, l.leg).toBeGreaterThanOrEqual(0n);
    expect(l.advanceMinor, l.leg).toBeGreaterThanOrEqual(0n);
    if (l.leg !== 'PLATFORM') expect(l.advanceMinor, l.leg).toBe(0n);
    expect(l.variationMinor, l.leg).toBe(l.keptMinor - l.advanceMinor - l.basisMinor);
  }
}

describe('US-018 — version 1 : jambes retenues et variation signée, jambe par jambe', () => {
  it('T03 (USD, PA) : basis = TJ01, kept = TJ02a, variation = TJ02b ; montants de T03', () => {
    const r = recordOf('T03');
    const v = settlementVector(set, 'T03');
    expect(r.engineVersion).toBe('cxl-beta/1');
    expect(legsOf(r, 'basisMinor')).toEqual(tj('TJ01').legsMinor);
    expect(legsOf(r, 'keptMinor')).toEqual(tj('TJ02a').legsMinor);
    expect(legsOf(r, 'variationMinor')).toEqual(tj('TJ02b').legsMinor);
    expect(r.guestRefundMinor).toBe(v.expected.guestRefundMinor);
    expect(r.guestRefundMinor).toBe(-tj('TJ02b').totalMinor);
    expect(r.hostEarningsMinor).toBe(v.expected.hostEarningsMinor);
    expect(r.platformNetMinor).toBe(v.expected.platformNetMinor);
    expect(r.retainedTaxMinor).toBe(v.expected.retainedTaxMinor);
    expect(r.negativeLeg).toBe(false);
    invariants(r);
  });

  it('T27 (PYG sans décimale, PY) : basis = TJ08a, variation = TJ08b, kept = TJ08a + TJ08b', () => {
    const r = recordOf('T27');
    const v = settlementVector(set, 'T27');
    expect(r.currency).toBe('PYG');
    expect(legsOf(r, 'basisMinor')).toEqual(tj('TJ08a').legsMinor);
    expect(legsOf(r, 'variationMinor')).toEqual(tj('TJ08b').legsMinor);
    expect(legsOf(r, 'keptMinor')).toEqual(sumOf(tj('TJ08a'), tj('TJ08b')));
    expect(r.guestRefundMinor).toBe(v.expected.guestRefundMinor);
    expect(r.hostFromGuestMinor).toBe(v.expected.hostFromGuestMinor);
    invariants(r);
  });
});

describe('US-018 — supersession : version n+1, delta et variation depuis la version n', () => {
  it('T36 (USD) : v1 = T08, v2 = T07 ⇒ delta −118,44 / −6,44 / +75,00 / +37,00 / pénalité −50 ; v1 intacte', () => {
    const v1 = recordOf('T08');
    const before = JSON.stringify(settlementRecordPayload(v1));
    const v2 = recordOf('T07', v1);
    const check = checksFor(set, 'T36').find((c) => c.label === 'T36');
    expect(check?.normative).toBe(true);
    const [refund, tax, host, platform, penaltyMajor] = check?.expected as readonly bigint[];
    const d = settlementDelta(v1, v2);
    expect(d.guestRefundMinor).toBe(refund);
    expect(d.taxRefundMinor).toBe(tax);
    expect(d.hostEarningsMinor).toBe(host);
    expect(d.platformNetMinor).toBe(platform);
    const exponent = set.currencies.get('USD')?.exponent ?? Number.NaN;
    expect(d.hostPenaltyMinor).toBe((penaltyMajor ?? 0n) * 10n ** BigInt(exponent));
    // la variation de v2 est relative à v1 (base = jambes signées de v1) : inverse de TJ18a
    expect(legsOf(v2, 'basisMinor')).toEqual(signedLegs(v1));
    expect(legsOf(v2, 'variationMinor')).toEqual(negated(tj('TJ18a')));
    expect(LEGS.reduce((a, l) => a + d.legs[l], 0n)).toBe(-d.guestRefundMinor);
    // la version 1 n'est pas modifiée par le calcul de la version 2
    expect(JSON.stringify(settlementRecordPayload(v1))).toBe(before);
    invariants(v2, v1);
  });

  it('TJ18a (USD) : v1 = T05, v2 = T08 (FULL) ⇒ variation v1 → v2 = TJ18a', () => {
    const v1 = recordOf('T05');
    const v2 = recordOf('T08', v1);
    expect(legsOf(v2, 'variationMinor')).toEqual(tj('TJ18a').legsMinor);
    expect(v2.hostPenaltyMinor).toBe(settlementVector(set, 'T08').expected.hostPenaltyMinor);
    invariants(v2, v1);
  });

  it('TJ18c (PYG) : v1 = T41, v2 = requalification FULL sur D ⇒ variation = TJ18c', () => {
    const v1 = recordOf('T41');
    const t41 = settlementVector(set, 'T41');
    const trip = toTrip(t41.trip);
    // même événement que T08 (HOST_CANCELLED_DUE_TO_GUEST sans preuve), sur le trip D de T41
    const full = toEvent(settlementVector(set, 'T08').event);
    const v2 = buildSettlementRecord(trip, full, testParams(trip.currency), v1);
    expect(legsOf(v2, 'variationMinor')).toEqual(tj('TJ18c').legsMinor);
    expect(v2.guestRefundMinor - v1.guestRefundMinor).toBe(-tj('TJ18c').totalMinor);
    invariants(v2, v1);
  });

  it('refus : version n+1 sur un autre total payé ou une autre devise', () => {
    const v1 = recordOf('T03');
    const t27 = settlementVector(set, 'T27');
    const trip = toTrip(t27.trip);
    expect(() =>
      buildSettlementRecord(trip, toEvent(t27.event), testParams(trip.currency), v1),
    ).toThrow(/SETTLEMENT_INPUT_INVALID/);
  });
});

describe('US-018 — drapeau negativeLeg (08 E7 règles 3 bis et 5) : avance de Kmino, jamais de jambe négative', () => {
  const late: CancellationEvent = { reason: 'GUEST_CANCELLED', requestedAtMs: at(-600) };
  const free: CancellationEvent = { reason: 'GUEST_CANCELLED', requestedAtMs: at(-3 * 24 * 60) };

  it.each([
    ['N_MAX (USD)', N_MAX, 'TJ13b'],
    ['NP_MAX (PYG)', NP_MAX, 'TJ13d'],
  ] as const)(
    '%s, promo maximale admise, annulation tardive : PLATFORM retenue 0 + avance, revue FIN, remboursement intact',
    (_, trip, capture) => {
      const params = testParams(trip.currency);
      const r = buildSettlementRecord(trip, late, params);
      expect(legsOf(r, 'basisMinor')).toEqual(tj(capture).legsMinor);
      const platform = r.legs.find((l) => l.leg === 'PLATFORM');
      expect(platform?.keptMinor).toBe(0n);
      expect(platform?.advanceMinor).toBeGreaterThan(0n);
      expect(r.negativeLeg).toBe(true);
      // le remboursement est celui du moteur, jamais réduit de l'avance
      expect(r.guestRefundMinor).toBe(
        computeCancellationSettlement(trip, late, params).guestRefund.amountMinor,
      );
      invariants(r);
    },
  );

  it.each([
    ['N_MAX (USD)', N_MAX],
    ['NP_MAX (PYG)', NP_MAX],
  ] as const)('%s, annulation gratuite : aucune avance, drapeau baissé', (_, trip) => {
    const r = buildSettlementRecord(trip, free, testParams(trip.currency));
    expect(r.negativeLeg).toBe(false);
    expect(r.legs.every((l) => l.advanceMinor === 0n)).toBe(true);
    invariants(r);
  });

  it.each([
    ['N (USD), TJ13a', N, 'TJ13a'],
    ['NP (PYG), TJ13c', NP, 'TJ13c'],
  ] as const)(
    '%s : capture refusée ⇒ aucun règlement (LEG_AMOUNT_NEGATIVE)',
    (_, trip, refused) => {
      expect(tj(refused).kind).toBe('REFUSED_CAPTURE');
      let code: string | undefined;
      try {
        buildSettlementRecord(trip, late, testParams(trip.currency));
      } catch (e) {
        if (isSettlementError(e)) code = e.code;
      }
      expect(code).toBe('LEG_AMOUNT_NEGATIVE');
    },
  );
});

describe('US-018 — inputs_hash (08 E4) et charge utile', () => {
  const v = settlementVector(set, 'T03');
  const trip = toTrip(v.trip);
  const event = toEvent(v.event);
  const params = testParams(trip.currency);

  it('même entrée ⇒ même hachage, quel que soit l’ordre des clés ; une unité change le hachage', () => {
    const h = settlementInputsHash('cxl-beta/1', trip, event, params);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    const reordered = Object.fromEntries(Object.entries(event).reverse()) as CancellationEvent;
    expect(settlementInputsHash('cxl-beta/1', trip, reordered, params)).toBe(h);
    expect(
      settlementInputsHash(
        'cxl-beta/1',
        trip,
        { ...event, requestedAtMs: event.requestedAtMs + 1 },
        params,
      ),
    ).not.toBe(h);
    expect(settlementInputsHash('cxl-beta/2', trip, event, params)).not.toBe(h);
    expect(
      settlementInputsHash('cxl-beta/1', trip, event, { ...params, freeCancelLeadHours: 25 }),
    ).not.toBe(h);
    expect(settlementParamsHash(params)).not.toBe(
      settlementParamsHash({ ...params, noShowGraceMinutes: 61 }),
    );
    expect(recordOf('T03').inputsHash).toBe(h);
  });

  it('charge utile : format 1, montants en chaînes d’entiers, 4 jambes, 10 lignes', () => {
    const p = settlementRecordPayload(recordOf('T03'));
    expect(p.format).toBe(1);
    expect(p.guestRefundMinor).toBe(v.expected.guestRefundMinor.toString());
    expect(p.legs).toHaveLength(4);
    expect(p.lines).toHaveLength(10);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});

describe('US-018 — clés d’idempotence `…:v{version}:{opération}:{moyen}:i{n}:a{n}` (08 E4)', () => {
  const expectedKeys = (id: string): string[] =>
    checksFor(set, id)
      .flatMap((c) => (Array.isArray(c.expected) ? c.expected : [c.expected]))
      .filter((x): x is string => typeof x === 'string' && x.includes(':v'));

  it('T49 et T50 : clés de check_t49plus.py', () => {
    expect(
      settlementOperationKey({
        tripRef: 'A',
        segmentNo: 1,
        version: 2,
        operation: 'REFUND',
        tenderId: 'yappy',
        instanceSeq: 1,
        attemptNo: 1,
      }),
    ).toBe(expectedKeys('T49')[0]);
    expect(
      settlementOperationKey({
        tripRef: 'A',
        segmentNo: 1,
        version: 2,
        operation: 'MIT_CHARGE',
        tenderId: 'card',
        instanceSeq: 1,
        attemptNo: 1,
      }),
    ).toBe(expectedKeys('T50')[0]);
  });

  it('refus : séparateur dans un identifiant, version 0, rang 0, opération inconnue', () => {
    const base = {
      tripRef: 'A',
      segmentNo: 1,
      version: 1,
      operation: 'REFUND',
      tenderId: 'card',
      instanceSeq: 1,
      attemptNo: 1,
    } as const;
    expect(() => settlementOperationKey({ ...base, tenderId: 'card:x' })).toThrow();
    expect(() => settlementOperationKey({ ...base, version: 0 })).toThrow();
    expect(() => settlementOperationKey({ ...base, instanceSeq: 0 })).toThrow();
    expect(() =>
      settlementOperationKey({ ...base, operation: 'PAYOUT' as unknown as 'REFUND' }),
    ).toThrow();
  });

  it('valeur PSP : la clé en clair si elle tient, sinon son SHA-256 (64 caractères)', () => {
    const key = 'trp_8f3a:1:v2:REFUND:tnd_card_01:i1:a1';
    expect(pspIdempotencyValue(key, 64)).toBe(key);
    expect(pspIdempotencyValue(key, 10)).toMatch(/^[0-9a-f]{64}$/);
  });
});
