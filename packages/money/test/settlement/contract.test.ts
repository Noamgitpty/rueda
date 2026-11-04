/**
 * US-042 — contrat du moteur de règlement, branche par branche (mutants survivants de la première
 * mesure, ADR-076). Attendus tirés de 08 (table de décision, pseudo-code `qualify`, `hostEligible`,
 * `penalty`, BR-CXL-01, BR-PRICE-08, E7) et du contrat d'entrée d'ADR-054 / README (« un fait requis
 * absent ⇒ SETTLEMENT_INPUT_INVALID, un paramètre requis absent ⇒ SETTLEMENT_CONFIG_INVALID ») :
 * aucun montant attendu n'est calculé avec le code testé ; les montants comparés sont des entrées
 * (total payé, barème) ou des identités de 08.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BETA_CANCELLATION_REASONS,
  buildSettlementRecord,
  canonicalJson,
  computeCancellationSettlement,
  computeLegs,
  isSettlementError,
  SettlementError,
  settlementRecordPayload,
  money,
  pspIdempotencyValue,
  ratio,
  settlementDelta,
  settlementOperationKey,
  signedLegs,
  type CancellationEvent,
  type Currency,
  type SettlementLine,
  type SettlementParams,
  type SettlementRecord,
  type SettlementTrip,
} from '../../src/index.ts';
import { COUNTRY_VARIANTS } from '../fixtures.ts';
import { TEST_INSURER_SHARES, T0_MS, at, testParams } from './adapter.ts';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  }
  return undefined;
}

/** Trip remboursable de 3 jours, réservé 5 jours avant le départ (entrées arbitraires). */
function baseTrip(currency: Currency, overrides: Partial<SettlementTrip> = {}): SettlementTrip {
  const m = (x: bigint) => money(x, currency);
  const share = ratio(3n, 4n);
  return {
    currency,
    days: 3,
    rateType: 'REFUNDABLE',
    startAtMs: T0_MS,
    bookedAtMs: at(-5 * 24 * 60),
    lines: { tripPrice: m(12_000n), tripFee: m(1_800n), protection: m(3_000n) },
    taxGroups: [{ id: 'g', lines: ['tripPrice', 'tripFee'], taxPaid: m(966n), thirdParty: false }],
    totalPaid: m(12_000n + 1_800n + 3_000n + 966n),
    hostSharePctFrozen: share,
    deliverySharePct: share,
    extrasSharePct: share,
    ...TEST_INSURER_SHARES,
    ...overrides,
  };
}

const FLAGS = {
  subReason: 'INVALID_LICENSE',
  evidenceValidated: true,
  checkinValidated: false,
  hostMessageTraced: true,
  hostNoShowReportedBefore: false,
  additionalDriverApproved: false,
} as const;

/** 08, table de décision : qualification et état SM-1 des motifs bêta (colonnes 3 et 9). */
const DECISION_TABLE: Readonly<Record<string, readonly [string, string]>> = {
  GUEST_CANCELLED: ['VOLUNTARY', 'CANCELLED_BY_GUEST'],
  GUEST_NO_SHOW: ['NO_SHOW', 'NO_SHOW_GUEST'],
  HOST_CANCELLED_DUE_TO_GUEST: ['NO_SHOW', 'NO_SHOW_GUEST'],
  PLATFORM_INCOMPLETE_STEPS: ['FAULT_PRE_START', 'CANCELLED_BY_PLATFORM'],
  GUEST_FRAUD_PROVEN: ['FAULT_PRE_START', 'CANCELLED_BY_PLATFORM'],
  HOST_CANCELLED: ['FULL', 'CANCELLED_BY_HOST'],
  HOST_NO_SHOW: ['FULL', 'NO_SHOW_HOST'],
  PLATFORM_TRUST_SAFETY: ['FULL', 'CANCELLED_BY_PLATFORM'],
  HOST_ACCOUNT_CLOSED: ['FULL', 'CANCELLED_BY_PLATFORM'],
  PLATFORM_REVIEW_DELAY: ['FULL', 'CANCELLED_BY_PLATFORM'],
  PSP_FAILURE: ['FULL', 'CANCELLED_BY_PLATFORM'],
};

describe.each(COUNTRY_VARIANTS)('contrat du moteur — $country', ({ currency }) => {
  const m = (x: bigint) => money(x, currency);
  // Calculs paresseux : rien n'est évalué à la collecte (sinon Stryker classe les mutants « statiques »).
  let cached: SettlementParams | undefined;
  const paramsOf = (): SettlementParams => (cached ??= testParams(currency));
  const settle = (
    trip: SettlementTrip,
    event: Partial<CancellationEvent>,
    p: SettlementParams = paramsOf(),
  ) =>
    computeCancellationSettlement(
      trip,
      { reason: 'GUEST_CANCELLED', requestedAtMs: at(-10 * 60), ...FLAGS, ...event },
      p,
    );

  it('table de décision de 08 : qualification et état cible de chaque motif bêta', () => {
    expect(Object.keys(DECISION_TABLE).sort()).toEqual([...BETA_CANCELLATION_REASONS].sort());
    for (const reason of BETA_CANCELLATION_REASONS) {
      const minutes = reason === 'GUEST_NO_SHOW' ? 120 : -10 * 60;
      const s = settle(baseTrip(currency), { reason, requestedAtMs: at(minutes) });
      expect([reason, s.qualification, s.targetState]).toEqual([
        reason,
        ...DECISION_TABLE[reason]!,
      ]);
      expect(s.requestedReason).toBe(reason);
    }
  });

  it('motif FULL : hôte inéligible, aucun fait de no-show exigé', () => {
    for (const reason of ['HOST_CANCELLED', 'HOST_NO_SHOW', 'HOST_ACCOUNT_CLOSED']) {
      const s = computeCancellationSettlement(
        baseTrip(currency),
        { reason, requestedAtMs: at(120) },
        paramsOf(),
      );
      expect([reason, s.hostEligible, s.hostFromGuest.amountMinor]).toEqual([reason, false, 0n]);
    }
  });

  it('origines de qualification (08 qualify, règles 1 à 3)', () => {
    const t = baseTrip(currency);
    expect(settle(t, { requestedAtMs: at(-10 * 60) }).origin).toBe('EVENT');
    expect(settle(t, { requestedAtMs: at(60) }).origin).toBe('LATE_GUEST_CANCELLATION');
    expect(settle(t, { requestedAtMs: at(60), checkinValidated: true }).origin).toBe('EVENT');
    const noEvidence = settle(t, {
      reason: 'HOST_CANCELLED_DUE_TO_GUEST',
      evidenceValidated: false,
    });
    expect([noEvidence.reason, noEvidence.origin]).toEqual([
      'HOST_CANCELLED',
      'REQUALIFIED_NO_EVIDENCE',
    ]);
    const wrongSub = settle(t, {
      reason: 'HOST_CANCELLED_DUE_TO_GUEST',
      subReason: 'OTHER_REASON',
    });
    expect(wrongSub.reason).toBe('HOST_CANCELLED');
  });

  it('no-show à noShowAt exact accepté ; avant : sous-motif de retrait exigé (règle 3)', () => {
    const t = baseTrip(currency);
    const { subReason: _s, ...noSub } = FLAGS;
    void _s;
    const exact = computeCancellationSettlement(
      t,
      { reason: 'GUEST_NO_SHOW', requestedAtMs: at(60), ...noSub },
      paramsOf(),
    );
    expect([exact.origin, exact.hostEligible]).toEqual(['EVENT', true]);
    expect(
      codeOf(() =>
        computeCancellationSettlement(
          t,
          { reason: 'GUEST_NO_SHOW', requestedAtMs: at(59), ...noSub },
          paramsOf(),
        ),
      ),
    ).toBe('REJECTED_TOO_EARLY');
    expect(
      codeOf(() =>
        settle(t, {
          reason: 'GUEST_NO_SHOW',
          requestedAtMs: at(59),
          subReason: 'LICENSE_NOT_UPLOADED_1H',
        }),
      ),
    ).toBe('REJECTED_TOO_EARLY');
    // Constaté au retrait : déclarable, mais hors de [noShowAt ; T + 72 h] ⇒ hôte inéligible (08).
    const pickup = settle(t, { reason: 'GUEST_NO_SHOW', requestedAtMs: at(30) });
    expect([pickup.origin, pickup.hostEligible, pickup.hostFromGuest.amountMinor]).toEqual([
      'PICKUP_CHECK',
      false,
      0n,
    ]);
    const late = settle(t, { reason: 'GUEST_NO_SHOW', requestedAtMs: at(72 * 60 + 1) });
    expect(late.hostEligible).toBe(false);
    const edge = settle(t, { reason: 'GUEST_NO_SHOW', requestedAtMs: at(72 * 60) });
    expect(edge.hostEligible).toBe(true);
  });

  it('pénalité de l’hôte : exemption, barème > 24 h et ≤ 24 h (BR-CXL-13)', () => {
    const t = baseTrip(currency);
    const p = paramsOf().hostPenalty!;
    const host = (minutes: number, waived?: boolean) =>
      settle(t, {
        reason: 'HOST_CANCELLED',
        requestedAtMs: at(minutes),
        ...(waived === undefined ? {} : { hostPenaltyWaived: waived }),
      }).hostPenalty.amountMinor;
    expect(host(-10 * 60)).toBe(p.cxlLate.amountMinor);
    expect(host(-10 * 60, false)).toBe(p.cxlLate.amountMinor);
    expect(host(-10 * 60, true)).toBe(0n);
    expect(host(-24 * 60)).toBe(p.cxlLate.amountMinor);
    expect(host(-24 * 60 - 1)).toBe(p.cxlEarly.amountMinor);
    expect(
      settle(t, { reason: 'HOST_NO_SHOW', requestedAtMs: at(30) }).hostPenalty.amountMinor,
    ).toBe(p.hostNoShow.amountMinor);
    expect(settle(t, {}).hostPenalty.amountMinor).toBe(0n);
    // Pas de pénalité due ⇒ aucun barème exigé.
    const { hostPenalty: _p, ...noSchedule } = paramsOf();
    void _p;
    expect(settle(t, {}, noSchedule).hostPenalty.amountMinor).toBe(0n);
  });

  it('dernière minute (BR-CXL-01) : seuil strict, paramètre pays', () => {
    // Seuil 30 h : réservé exactement 30 h avant ⇒ pas de dernière minute ⇒ gratuit jusqu'à T − 24 h.
    const p30 = testParams(currency, { lastMinuteThresholdHours: 30 });
    const t30 = baseTrip(currency, { bookedAtMs: at(-30 * 60) });
    const total = t30.totalPaid.amountMinor;
    expect(settle(t30, { requestedAtMs: at(-25 * 60) }, p30).guestRefund.amountMinor).toBe(total);
    // Réservé 29 h 59 avant ⇒ dernière minute ⇒ gratuit 1 h après la réservation seulement.
    const t29 = baseTrip(currency, { bookedAtMs: at(-30 * 60 + 1) });
    expect(settle(t29, { requestedAtMs: at(-25 * 60) }, p30).guestRefund.amountMinor < total).toBe(
      true,
    );
    expect(settle(t29, { requestedAtMs: at(-29 * 60 + 1) }, p30).guestRefund.amountMinor).toBe(
      total,
    );
  });

  it('tarif non remboursable : conducteur additionnel 0 ⇒ aucun fait exigé (BR-PRICE-08)', () => {
    const nr = baseTrip(currency, { rateType: 'NON_REFUNDABLE' });
    const { additionalDriverApproved: _a, ...noFlag } = FLAGS;
    void _a;
    const s = computeCancellationSettlement(
      nr,
      { reason: 'GUEST_CANCELLED', requestedAtMs: at(-10 * 60), ...noFlag },
      paramsOf(),
    );
    expect(s.guestRefund.amountMinor).toBe(0n);
    const withDriver = baseTrip(currency, {
      rateType: 'NON_REFUNDABLE',
      lines: { tripPrice: m(12_000n), tripFee: m(1_800n), additionalDriver: m(1_500n) },
      totalPaid: m(12_000n + 1_800n + 1_500n + 966n),
    });
    expect(
      codeOf(() =>
        computeCancellationSettlement(
          withDriver,
          { reason: 'GUEST_CANCELLED', requestedAtMs: at(-10 * 60), ...noFlag },
          paramsOf(),
        ),
      ),
    ).toBe('SETTLEMENT_INPUT_INVALID');
  });

  it('entrées invalides du trip : SETTLEMENT_INPUT_INVALID, une par une', () => {
    const t = baseTrip(currency);
    const g = t.taxGroups[0]!;
    const bad: [string, SettlementTrip][] = [
      ['days 0', { ...t, days: 0 }],
      ['days décimal', { ...t, days: 1.5 }],
      ['rateType', { ...t, rateType: 'FLEX' as never }],
      ['startAtMs non entier', { ...t, startAtMs: 1.5 }],
      ['startAtMs chaîne', { ...t, startAtMs: '0' as never }],
      ['bookedAtMs non entier', { ...t, bookedAtMs: Number.NaN }],
      ['réservé après le départ', { ...t, bookedAtMs: T0_MS + 1 }],
      ['ligne inconnue', { ...t, lines: { ...t.lines, fuel: m(0n) } as never }],
      ['groupe en double', { ...t, taxGroups: [g, { ...g, taxPaid: m(0n) }] }],
      ['thirdParty non booléen', { ...t, taxGroups: [{ ...g, thirdParty: 'no' as never }] }],
      [
        'ligne de groupe inconnue',
        { ...t, taxGroups: [{ ...g, lines: ['fuel' as SettlementLine] }] },
      ],
    ];
    for (const [label, trip] of bad) {
      expect([label, codeOf(() => settle(trip, {}))]).toEqual([label, 'SETTLEMENT_INPUT_INVALID']);
    }
    // réservé à l'instant du départ : admis
    expect(codeOf(() => settle({ ...t, bookedAtMs: T0_MS }, { requestedAtMs: T0_MS }))).toBe(
      undefined,
    );
    for (const share of ['hostSharePctFrozen', 'deliverySharePct', 'extrasSharePct'] as const) {
      expect([
        share,
        codeOf(() => settle({ ...t, [share]: { num: 1, den: 2 } as never }, {})),
      ]).toEqual([share, 'RATIO_INVALID']);
    }
  });

  it('événement et paramètres invalides', () => {
    const t = baseTrip(currency);
    expect(codeOf(() => settle(t, { requestedAtMs: 1.5 }))).toBe('SETTLEMENT_INPUT_INVALID');
    expect(codeOf(() => settle(t, { reason: 42 as never }))).toBe(
      'SETTLEMENT_REASON_NOT_SUPPORTED',
    );
    expect(
      codeOf(() => settle(t, { requestedAtMs: at(60), checkinValidated: undefined } as never)),
    ).toBe('SETTLEMENT_INPUT_INVALID');
    expect(
      codeOf(() =>
        settle(t, {
          requestedAtMs: at(60),
          hostNoShowReportedBefore: undefined as never,
        }),
      ),
    ).toBe('SETTLEMENT_INPUT_INVALID');
    for (const key of [
      'noShowGraceMinutes',
      'lastMinuteThresholdHours',
      'freeCancelLeadHours',
    ] as const) {
      for (const value of [-1, 1.5, '1']) {
        const p = { ...paramsOf(), [key]: value } as SettlementParams;
        expect([key, value, codeOf(() => settle(t, {}, p))]).toEqual([
          key,
          value,
          'SETTLEMENT_CONFIG_INVALID',
        ]);
      }
      expect(codeOf(() => settle(t, {}, { ...paramsOf(), [key]: 0 }))).toBe(undefined);
    }
  });

  it('jambes : part assureur exigée seulement pour une ligne retenue non nulle, dans [0 ; 1]', () => {
    const t = baseTrip(currency);
    const zeroProtection = Object.fromEntries(
      (['tripPrice', 'protection', 'enhancedRoadside'] as const).map((l) => [l, m(0n)]),
    );
    const retained = {
      tripPrice: m(0n),
      promoPlatform: m(0n),
      promoHost: m(0n),
      tripFee: m(0n),
      protection: m(0n),
      extras: m(0n),
      enhancedRoadside: m(0n),
      additionalDriver: m(0n),
      youngDriver: m(0n),
      delivery: m(0n),
      ...zeroProtection,
    };
    const { insurerPremiumShareFrozen: _a, insurerRoadsideShareFrozen: _b, ...noShares } = t;
    void _a;
    void _b;
    expect(computeLegs(noShares, retained, {}, m(0n)).INSURER.amountMinor).toBe(0n);
    const withProtection = { ...retained, protection: m(1_000n) };
    expect(codeOf(() => computeLegs(noShares, withProtection, {}, m(0n)))).toBe(
      'SETTLEMENT_CONFIG_INVALID',
    );
    for (const share of [ratio(3n, 2n), ratio(-1n, 2n)]) {
      expect(
        codeOf(() =>
          computeLegs({ ...t, insurerPremiumShareFrozen: share }, withProtection, {}, m(0n)),
        ),
      ).toBe('SETTLEMENT_CONFIG_INVALID');
    }
    expect(
      codeOf(() =>
        computeLegs(
          { ...t, insurerPremiumShareFrozen: { num: 1, den: 2 } as never },
          withProtection,
          {},
          m(0n),
        ),
      ),
    ).toBe('RATIO_INVALID');
    expect(
      computeLegs({ ...t, insurerPremiumShareFrozen: ratio(1n, 1n) }, withProtection, {}, m(0n))
        .INSURER.amountMinor,
    ).toBe(1_000n);
  });
});

describe('règlements persistés : refus et formes (US-018)', () => {
  const currency = COUNTRY_VARIANTS[0]!.currency;
  const event: CancellationEvent = {
    reason: 'GUEST_CANCELLED',
    requestedAtMs: at(-10 * 60),
    ...FLAGS,
  };
  /** Version 1, calculée dans le test (jamais à la collecte). */
  const version1 = () => buildSettlementRecord(baseTrip(currency), event, testParams(currency));

  it('canonicalJson : nombre non fini refusé, clés indéfinies omises, ordre des clés stable', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, { a: Number.NEGATIVE_INFINITY }]) {
      expect(codeOf(() => canonicalJson(bad))).toBe('SETTLEMENT_INPUT_INVALID');
    }
    expect(canonicalJson({ b: 1, a: undefined, c: [2n] })).toBe(canonicalJson({ c: [2n], b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('kind CANCELLATION ; jambe absente de la version n et delta entre devises refusés', () => {
    const v1 = version1();
    expect(v1.kind).toBe('CANCELLATION');
    const broken = { ...v1, legs: v1.legs.slice(1) } as SettlementRecord;
    expect(codeOf(() => signedLegs(broken))).toBe('SETTLEMENT_INPUT_INVALID');
    expect(codeOf(() => settlementDelta(v1, { ...v1, currency: 'XXX' }))).toBe(
      'SETTLEMENT_INPUT_INVALID',
    );
  });

  it('clé d’opération : chaque partie validée ; limite PSP < 64 refusée', () => {
    const parts = {
      tripRef: 'trip-1',
      segmentNo: 1,
      version: 1,
      operation: 'REFUND' as const,
      tenderId: 'card',
      instanceSeq: 1,
      attemptNo: 1,
    };
    expect(codeOf(() => settlementOperationKey(parts))).toBe(undefined);
    for (const [k, v] of [
      ['tripRef', 'a:b'],
      ['tenderId', 'x y'],
      ['operation', 'STEAL'],
      ['segmentNo', 0],
      ['version', 1.5],
      ['instanceSeq', -1],
      ['attemptNo', 0],
    ] as const) {
      expect([k, codeOf(() => settlementOperationKey({ ...parts, [k]: v } as never))]).toEqual([
        k,
        'SETTLEMENT_INPUT_INVALID',
      ]);
    }
    const key = settlementOperationKey(parts);
    expect(codeOf(() => pspIdempotencyValue(key, 63))).toBe('SETTLEMENT_INPUT_INVALID');
    expect(codeOf(() => pspIdempotencyValue(key, 0))).toBe('SETTLEMENT_INPUT_INVALID');
    expect(pspIdempotencyValue(key, 64).length <= 64).toBe(true);
  });

  it('inputsHash = SHA-256 hexadécimal de « rueda.settlement.inputs/1\n » ‖ entrées (08 E4)', () => {
    const v1 = version1();
    const expected = createHash('sha256')
      .update(`rueda.settlement.inputs/1\n${v1.inputs}`, 'utf8')
      .digest('hex');
    expect(v1.inputsHash).toBe(expected);
  });

  it('charge utile : montants en chaînes, lignes, groupes et jambes détaillés', () => {
    const v1 = version1();
    const payload = settlementRecordPayload(v1) as {
      lines: { line: string; amountMinor: string; refundMinor: string; retainedMinor: string }[];
      taxGroups: { groupId: string; taxPaidMinor: string; retainedTaxMinor: string }[];
      legs: { leg: string; keptMinor: string; advanceMinor: string; variationMinor: string }[];
    };
    expect(payload.lines[0]).toEqual({
      line: v1.lines[0]!.line,
      amountMinor: String(v1.lines[0]!.amountMinor),
      refundMinor: String(v1.lines[0]!.refundMinor),
      retainedMinor: String(v1.lines[0]!.retainedMinor),
    });
    expect(payload.taxGroups[0]).toMatchObject({
      groupId: 'g',
      taxPaidMinor: String(v1.taxGroups[0]!.taxPaidMinor),
      retainedTaxMinor: String(v1.taxGroups[0]!.retainedTaxMinor),
    });
    expect(payload.legs.map((l) => l.leg)).toEqual([
      'HOST',
      'INSURER',
      'TAX_THIRD_PARTY',
      'PLATFORM',
    ]);
    expect(payload.legs[0]).toMatchObject({ keptMinor: String(v1.legs[0]!.keptMinor) });
  });

  it('SettlementError : nom, code, isSettlementError filtre le code', () => {
    let caught: unknown;
    try {
      signedLegs({ ...version1(), legs: [] } as SettlementRecord);
    } catch (error) {
      caught = error;
    }
    const e = caught as SettlementError;
    expect(e).toBeInstanceOf(SettlementError);
    expect(e.name).toBe('SettlementError');
    expect(isSettlementError(e, 'SETTLEMENT_INPUT_INVALID')).toBe(true);
    expect(isSettlementError(e, 'LEG_AMOUNT_NEGATIVE')).toBe(false);
    expect(isSettlementError(new Error('x'))).toBe(false);
    expect(isSettlementError(new Error('x'), 'SETTLEMENT_INPUT_INVALID')).toBe(false);
  });
});
