/**
 * US-017 — moteur de règlement des annulations, sous-ensemble bêta, **test-first** : chaque attendu
 * vient de l'export des oracles Python (`@rueda/money/golden-vectors`, US-016), jamais du moteur.
 * Aucun montant attendu n'est écrit dans ce fichier.
 *
 * Critères de 19 US-017 : T01–T09, T14, T15, T23–T27, T38–T43, T61, T62 ; TJ02a, TJ02b, TJ04a,
 * TJ04b, TJ05a, TJ05b, TJ06, TJ08b, TJ09b, TJ10b, TJ12b ; en USD (PA) et en PYG (PY).
 */
import { describe, expect, it } from 'vitest';
import {
  checksFor,
  compareAmounts,
  compareSettlement,
  loadGoldenVectors,
  replay,
  settlementVector,
  settlementVectors,
  type GoldenSettlementVector,
  type GoldenValue,
} from '../../src/golden-vectors/index.ts';
import {
  BETA_CANCELLATION_REASONS,
  CANCELLATION_ENGINE_VERSION,
  LEGS,
  computeCancellationSettlement,
  isSettlementError,
  type CancellationSettlement,
} from '../../src/index.ts';
import {
  COMPARED_FIELDS,
  at,
  settleVector,
  testParams,
  toEvent,
  toObservation,
  toTrip,
} from './adapter.ts';

const set = loadGoldenVectors();

/** Vecteurs de règlement cités par 19 US-017 (T61, T62 : contrôles d'oracle, plus bas). */
const STORY_T = [
  'T01',
  'T02',
  'T03',
  'T04',
  'T05',
  'T06',
  'T07',
  'T08',
  'T09',
  'T14',
  'T15',
  'T23',
  'T24',
  'T25',
  'T26',
  'T27',
  'T38',
  'T39',
  'T40',
  'T41',
  'T42',
  'T43',
];

const isBeta = (v: GoldenSettlementVector): boolean =>
  (BETA_CANCELLATION_REASONS as readonly string[]).includes(v.event.reason);

const compareAll = (v: GoldenSettlementVector, s: CancellationSettlement) => [
  ...compareSettlement(v, toObservation(s), COMPARED_FIELDS),
  ...(s.reason === v.expected.qualifiedReason
    ? []
    : [{ vectorId: v.id, field: 'qualifiedReason', expected: 0n, observed: s.reason }]),
];

const int = (value: GoldenValue | undefined): bigint => {
  if (typeof value !== 'bigint') throw new Error('entier attendu dans le contrôle d’oracle');
  return value;
};
const tuple = (value: GoldenValue | undefined): readonly GoldenValue[] => {
  if (!Array.isArray(value)) throw new Error('liste attendue dans le contrôle d’oracle');
  return value as readonly GoldenValue[];
};
const check = (vectorId: string, label: string): GoldenValue => {
  const found = checksFor(set, vectorId).find((c) => c.label === label);
  if (!found) throw new Error(`contrôle « ${label} » absent de l'export`);
  return found.expected;
};

describe('vecteurs de la story, rejoués (USD et PYG)', () => {
  const vectors = STORY_T.map((id) => settlementVector(set, id));

  it('tous normatifs, des deux devises', () => {
    expect(vectors.every((v) => v.normative)).toBe(true);
    expect(new Set(vectors.map((v) => v.currency))).toEqual(new Set(['USD', 'PYG']));
  });

  it('égalité exacte sur les colonnes de 08, le détail de l’oracle et le motif qualifié', () => {
    const report = replay(vectors, (v) => settleVector(v), compareAll);
    expect(report.replayed).toBe(STORY_T.length);
    expect(report.mismatches).toEqual([]);
  });

  it.each(['USD', 'PYG'])('tous les vecteurs normatifs bêta en %s', (currency) => {
    const list = settlementVectors(set, { currency, normativeOnly: true }).filter(isBeta);
    const report = replay(list, (v) => settleVector(v), compareAll);
    expect(report.replayed).toBeGreaterThan(currency === 'PYG' ? 2 : STORY_T.length);
    expect(report.mismatches).toEqual([]);
  });
});

describe('critères de la story', () => {
  it('T05 et T06 : même résultat, déclaré par l’hôte ou automatique (invariance à l’initiateur)', () => {
    const t05 = toObservation(settleVector(settlementVector(set, 'T05')));
    const t06 = toObservation(settleVector(settlementVector(set, 'T06')));
    expect(t06).toEqual(t05);
  });

  it('T25 : annulation reçue après noShowAt, requalifiée no-show (origine annulation tardive)', () => {
    const s = settleVector(settlementVector(set, 'T25'));
    expect(s.requestedReason).toBe('GUEST_CANCELLED');
    expect(s.reason).toBe('GUEST_NO_SHOW');
    expect(s.origin).toBe('LATE_GUEST_CANCELLATION');
  });

  it('T39 : hôte inéligible, toute la retenue à la jambe PLATFORM', () => {
    const s = settleVector(settlementVector(set, 'T39'));
    expect(s.hostEligible).toBe(false);
    expect(s.settledLegs.HOST.amountMinor).toBe(0n);
    expect(s.settledLegs.PLATFORM.amountMinor).toBe(s.settledLegs.total.amountMinor);
  });

  it('T61 (a) : platform_funded_host_compensation absent ou non booléen ⇒ 0 (fail-closed)', () => {
    const [absent, notBoolean, explicitTrue] = tuple(check('T61', 'T61')).map(int);
    const t17 = settlementVector(set, 'T17');
    const comp = (value: unknown): bigint =>
      settleVector(t17, { platformFundedHostCompensation: value }).hostCompensation.amountMinor;
    expect(comp(undefined)).toBe(absent);
    expect(comp(null)).toBe(absent);
    expect(comp(false)).toBe(absent);
    expect(comp('TURO_MODEL')).toBe(notBoolean);
    expect(comp('true')).toBe(notBoolean);
    expect(comp(true)).toBe(explicitTrue);
    expect(comp(true)).toBe(int(check('T61', 'T61 hostPartOf(A, 1) inchange')));
    // Défaut : gains hôte et net plateforme d'un règlement intégral (option B).
    const def = settleVector(t17);
    expect(def.hostEarnings.amountMinor).toBe(absent);
    expect(def.platformNet.amountMinor).toBe(absent);
  });

  it('T61 (b) : PSP_FAILURE à T − 2 h sur A, compensation due seulement avec `true`', () => {
    const [absent, , , payable] = tuple(check('T61', 'T61')).map(int);
    const trip = toTrip(settlementVector(set, 'T17').trip);
    const event = { ...toEvent(settlementVector(set, 'T17').event), reason: 'PSP_FAILURE' };
    const run = (value: unknown) =>
      computeCancellationSettlement(
        trip,
        event,
        testParams(trip.currency, { platformFundedHostCompensation: value }),
      ).hostCompensation.amountMinor;
    expect(run(undefined)).toBe(absent);
    expect(run(true)).toBe(payable);
  });

  it('T17, T18 (option A, non normatifs) : égalité derrière le paramètre explicite `true`', () => {
    const list = settlementVectors(set).filter((v) => ['T17', 'T18'].includes(v.id));
    expect(list.every((v) => !v.normative)).toBe(true);
    const report = replay(
      list,
      (v) => settleVector(v, { platformFundedHostCompensation: true }),
      compareAll,
    );
    expect(report.mismatches).toEqual([]);
  });

  it('T62 : pénalités en unités mineures, PA (T14) et PY (T48, PROPOSÉ) via host_penalty', () => {
    const [pa, py] = tuple(check('T62', 'T62')).map(int);
    expect(settleVector(settlementVector(set, 'T14')).hostPenalty.amountMinor).toBe(pa);
    const t48 = settlementVector(set, 'T48');
    expect(t48.normative).toBe(false);
    expect(settleVector(t48).hostPenalty.amountMinor).toBe(py);
    expect(compareAll(t48, settleVector(t48))).toEqual([]);
  });

  it('T20, T21, T37, T47 : motif hors bêta ⇒ erreur explicite, jamais un résultat', () => {
    for (const id of ['T20', 'T21', 'T47']) {
      const v = settlementVector(set, id);
      expect(isBeta(v)).toBe(false);
      const trip = toTrip(v.trip);
      expect(() =>
        computeCancellationSettlement(trip, toEvent(v.event), testParams(trip.currency)),
      ).toThrow(expect.objectContaining({ code: 'SETTLEMENT_REASON_NOT_SUPPORTED' }));
    }
    const t37 = toTrip(settlementVector(set, 'T37').trip);
    expect(() =>
      computeCancellationSettlement(
        t37,
        { reason: 'TERM_BREAKDOWN_NOT_GUEST', requestedAtMs: at(1200) },
        testParams(t37.currency),
      ),
    ).toThrow(expect.objectContaining({ code: 'SETTLEMENT_REASON_NOT_SUPPORTED' }));
  });
});

describe('invariants de 08 sur chaque vecteur rejoué', () => {
  const replayed = settlementVectors(set, { normativeOnly: true }).filter(isBeta);

  it.each(replayed.map((v) => [v.id, v] as const))(
    '%s : équilibre, Σ jambes, variation = − remboursement, aucune jambe négative',
    (_id, v) => {
      const s = settleVector(v);
      const total = toTrip(v.trip).totalPaid.amountMinor;
      expect(s.engineVersion).toBe(CANCELLATION_ENGINE_VERSION);
      expect(s.guestRefund.amountMinor + s.retained.amountMinor + s.retainedTax.amountMinor).toBe(
        total,
      );
      for (const legs of [s.captureLegs, s.settledLegs, s.legVariation]) {
        expect(LEGS.reduce((acc, k) => acc + legs[k].amountMinor, 0n)).toBe(legs.total.amountMinor);
      }
      expect(s.captureLegs.total.amountMinor).toBe(total);
      expect(s.settledLegs.total.amountMinor).toBe(
        s.retained.amountMinor + s.retainedTax.amountMinor,
      );
      expect(s.legVariation.total.amountMinor).toBe(-s.guestRefund.amountMinor);
      expect(s.negativeLeg).toBe(false);
      for (const k of LEGS) {
        expect(s.settledLegs[k].amountMinor >= 0n, k).toBe(true);
        expect(s.captureLegs[k].amountMinor >= 0n, k).toBe(true);
      }
    },
  );
});

describe('mutation d’une unité : l’écart est détecté par le harnais', () => {
  it('chaque champ comparé décalé d’une unité mineure, en USD (T03) et en PYG (T40)', () => {
    for (const id of ['T03', 'T40']) {
      const v = settlementVector(set, id);
      const obs = toObservation(settleVector(v)) as Record<string, bigint>;
      for (const field of COMPARED_FIELDS) {
        const shifted = { ...obs, [field]: (obs[field] ?? 0n) + 1n };
        expect(compareAmounts(v.id, v.expected, shifted, [field]), `${id} ${field}`).toHaveLength(
          1,
        );
      }
    }
  });

  it('un mauvais paramètre (fenêtre gratuite de 25 h au lieu de 24 h) fait échouer T02', () => {
    const vs = ['T02', 'T03'].map((id) => settlementVector(set, id));
    const report = replay(vs, (v) => settleVector(v, { freeCancelLeadHours: 25 }), compareAll);
    expect(new Set(report.mismatches.map((m) => m.vectorId))).toEqual(new Set(['T02']));
  });
});

describe('entrées refusées (fail-closed)', () => {
  const t05 = settlementVector(set, 'T05');
  const trip = toTrip(t05.trip);
  const params = testParams(trip.currency);

  it('no-show sans hostMessageTraced : erreur, jamais un défaut silencieux', () => {
    const { hostMessageTraced: _omit, ...event } = toEvent(t05.event);
    void _omit;
    expect(() => computeCancellationSettlement(trip, event, params)).toThrow(
      expect.objectContaining({ code: 'SETTLEMENT_INPUT_INVALID' }),
    );
  });

  it('no-show déclaré avant noShowAt sans sous-motif de retrait : REJECTED_TOO_EARLY', () => {
    const event = { ...toEvent(t05.event), requestedAtMs: at(59) };
    expect(() => computeCancellationSettlement(trip, event, params)).toThrow(
      expect.objectContaining({ code: 'REJECTED_TOO_EARLY' }),
    );
  });

  it('pénalité due sans barème host_penalty : SETTLEMENT_CONFIG_INVALID (jamais 0)', () => {
    const t14 = settlementVector(set, 'T14');
    const { hostPenalty: _omit, ...noPenalty } = params;
    void _omit;
    expect(() =>
      computeCancellationSettlement(toTrip(t14.trip), toEvent(t14.event), noPenalty),
    ).toThrow(expect.objectContaining({ code: 'SETTLEMENT_CONFIG_INVALID' }));
  });

  it('protection sans part assureur figée : SETTLEMENT_CONFIG_INVALID (jamais 0)', () => {
    const { insurerPremiumShareFrozen: _omit, ...noShare } = trip;
    void _omit;
    expect(() => computeCancellationSettlement(noShare, toEvent(t05.event), params)).toThrow(
      expect.objectContaining({ code: 'SETTLEMENT_CONFIG_INVALID' }),
    );
  });

  it('barème en autre devise que le trip : refus, aucune conversion', () => {
    const t14 = settlementVector(set, 'T14');
    const usdTrip = toTrip(t14.trip);
    const pyParams = testParams(toTrip(settlementVector(set, 'T48').trip).currency);
    expect(() => computeCancellationSettlement(usdTrip, toEvent(t14.event), pyParams)).toThrow(
      expect.objectContaining({ code: 'SETTLEMENT_CONFIG_INVALID' }),
    );
  });

  it('total payé incohérent : SETTLEMENT_INPUT_INVALID', () => {
    const bad = { ...trip, totalPaid: trip.lines.tripPrice ?? trip.totalPaid };
    expect(() => computeCancellationSettlement(bad, toEvent(t05.event), params)).toThrow(
      expect.objectContaining({ code: 'SETTLEMENT_INPUT_INVALID' }),
    );
  });

  it('l’erreur est une SettlementError typée', () => {
    try {
      computeCancellationSettlement(trip, { reason: 'SWAP_REFUSED', requestedAtMs: at(0) }, params);
    } catch (error) {
      expect(isSettlementError(error, 'SETTLEMENT_REASON_NOT_SUPPORTED')).toBe(true);
      return;
    }
    throw new Error('aucune erreur');
  });
});
