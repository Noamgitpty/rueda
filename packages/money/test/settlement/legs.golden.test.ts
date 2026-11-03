/**
 * US-017 — jambes explicites (08 E7) rejouées sur les vecteurs TJ de l'export des oracles
 * (`check_legs.py`, US-016). Les attendus viennent de l'export ; aucun n'est écrit ici.
 *
 * Les trips J, J3 et K2 n'existent que dans le texte de 08 E7 (« Trips ajoutés ») : leurs
 * **entrées** (lignes, taxe payée par groupe, total) sont recopiées de 08 ; la taxe payée est celle
 * de la facture (par ligne puis sommée), écrite par 08.
 */
import { describe, expect, it } from 'vitest';
import {
  compareLegs,
  legVector,
  loadGoldenVectors,
  replay,
  settlementVector,
  type GoldenLegVector,
} from '../../src/golden-vectors/index.ts';
import {
  computeCancellationSettlement,
  computeCaptureLegs,
  money,
  ratio,
  type CancellationEvent,
  type Legs,
  type SettlementTrip,
} from '../../src/index.ts';
import { USD } from '../fixtures.ts';
import {
  J,
  J3,
  N,
  NP,
  NP_MAX,
  N_MAX,
  TEST_INSURER_SHARES,
  T0_MS,
  at,
  settleVector,
  testParams,
  toLegObservation,
  toTrip,
} from './adapter.ts';

const set = loadGoldenVectors();
const PLAN = ratio(3n, 4n);
const BOOKED = at(-5 * 24 * 60); // « sauf mention contraire, la réservation est faite à T−5 j »

/** K2 (USD, 1 j, remboursable) : P 10,02, F 5,00, protection 10,05 ; taxe 7 % sur F et protection. */
const K2: SettlementTrip = {
  currency: USD,
  days: 1,
  rateType: 'REFUNDABLE',
  startAtMs: T0_MS,
  bookedAtMs: BOOKED,
  lines: {
    tripPrice: money(1_002n, USD),
    tripFee: money(500n, USD),
    protection: money(1_005n, USD),
  },
  taxGroups: [
    { id: 'itbms', lines: ['tripFee', 'protection'], taxPaid: money(105n, USD), thirdParty: false },
  ],
  totalPaid: money(2_612n, USD),
  hostSharePctFrozen: PLAN,
  deliverySharePct: PLAN,
  extrasSharePct: PLAN,
  ...TEST_INSURER_SHARES,
};

const guestCancelAtTMinus10h: CancellationEvent = {
  reason: 'GUEST_CANCELLED',
  requestedAtMs: at(-600),
};
const hostDeclaredNoShow: CancellationEvent = {
  reason: 'GUEST_NO_SHOW',
  requestedAtMs: at(70),
  hostMessageTraced: true,
};

const fromT = (id: string, pick: 'settledLegs' | 'legVariation') => (): Legs =>
  settleVector(settlementVector(set, id))[pick];
const captureOfT = (id: string) => (): Legs =>
  computeCaptureLegs(toTrip(settlementVector(set, id).trip));
const settle = (trip: SettlementTrip, ev: CancellationEvent, pick: 'legVariation') => (): Legs =>
  computeCancellationSettlement(trip, ev, testParams(trip.currency))[pick];

/** Ligne TJ de 08 E7 → état du moteur qui la produit. */
const SOURCES: Readonly<Record<string, () => Legs>> = {
  TJ01: captureOfT('T03'),
  TJ02a: fromT('T03', 'settledLegs'),
  TJ02b: fromT('T03', 'legVariation'),
  TJ04a: fromT('T05', 'settledLegs'),
  TJ04b: fromT('T05', 'legVariation'),
  TJ05a: fromT('T39', 'settledLegs'),
  TJ05b: fromT('T39', 'legVariation'),
  TJ06: fromT('T14', 'legVariation'),
  TJ08a: captureOfT('T27'),
  TJ08b: fromT('T27', 'legVariation'),
  TJ09a: captureOfT('T40'),
  TJ09b: fromT('T40', 'legVariation'),
  TJ10a: () => computeCaptureLegs(J),
  TJ10b: settle(J, guestCancelAtTMinus10h, 'legVariation'),
  TJ11a: () => computeCaptureLegs(J3),
  TJ11b: settle(J3, guestCancelAtTMinus10h, 'legVariation'),
  TJ12a: () => computeCaptureLegs(K2),
  TJ12b: settle(K2, hostDeclaredNoShow, 'legVariation'),
  TJ13a: () => computeCaptureLegs(N),
  TJ13b: () => computeCaptureLegs(N_MAX),
  TJ13c: () => computeCaptureLegs(NP),
  TJ13d: () => computeCaptureLegs(NP_MAX),
};

const STORY_TJ = [
  'TJ02a',
  'TJ02b',
  'TJ04a',
  'TJ04b',
  'TJ05a',
  'TJ05b',
  'TJ06',
  'TJ08b',
  'TJ09b',
  'TJ10b',
  'TJ12b',
];

const engine = (v: GoldenLegVector) => {
  const source = SOURCES[v.id];
  if (!source) throw new Error(`aucune source pour ${v.id}`);
  return toLegObservation(source());
};

describe('jambes TJ rejouées (08 E7)', () => {
  it('vecteurs de la story : égalité exacte jambe par jambe, en USD et en PYG', () => {
    const vectors = STORY_TJ.map((id) => legVector(set, id));
    expect(new Set(vectors.map((v) => v.currency))).toEqual(new Set(['USD', 'PYG']));
    const report = replay(vectors, engine, compareLegs);
    expect(report.replayed).toBe(STORY_TJ.length);
    expect(report.mismatches).toEqual([]);
  });

  it('captures, taxe pour compte de tiers et promo plateforme (TJ01, TJ08a … TJ12a, TJ13a–d)', () => {
    const ids = Object.keys(SOURCES).filter((id) => !STORY_TJ.includes(id));
    const report = replay(
      ids.map((id) => legVector(set, id)),
      engine,
      compareLegs,
    );
    expect(report.replayed).toBe(11);
    expect(report.mismatches).toEqual([]);
  });

  it('les trips J, J3, K2 recopiés de 08 sont équilibrés et sans jambe négative au règlement', () => {
    for (const [trip, ev] of [
      [J, guestCancelAtTMinus10h],
      [J3, guestCancelAtTMinus10h],
      [K2, hostDeclaredNoShow],
    ] as const) {
      const s = computeCancellationSettlement(trip, ev, testParams(trip.currency));
      expect(s.negativeLeg).toBe(false);
      expect(s.legVariation.total.amountMinor).toBe(-s.guestRefund.amountMinor);
    }
  });

  it('un PSP qui ventilerait au prorata (TJ10c, contre-exemple) diffère du moteur', () => {
    const report = replay(
      [legVector(set, 'TJ10c')],
      () => engine(legVector(set, 'TJ10b')),
      compareLegs,
    );
    expect(report.mismatches.map((m) => m.field)).toContain('HOST');
  });
});

describe('jambe retenue négative : drapeau negativeLeg (08 E7 règle 5)', () => {
  // La capture de N et NP est refusée au checkout (TJ13a, TJ13c, export) ; le moteur reste pur et
  // signale l'état sans réduire le remboursement. Recalcul indépendant des revues argent et qa :
  // PLATFORM retenue de N = −16,09 à T − 10 h. Ici, le signe et le drapeau seulement.
  it.each([
    ['N (USD)', N, 'TJ13a'],
    ['NP (PYG)', NP, 'TJ13c'],
  ] as const)('%s annulé à T − 10 h : PLATFORM retenue < 0, drapeau levé', (_name, trip, tj) => {
    expect(legVector(set, tj).kind).toBe('REFUSED_CAPTURE');
    expect(legVector(set, tj).legsMinor.PLATFORM < 0n).toBe(true);
    const s = computeCancellationSettlement(
      trip,
      guestCancelAtTMinus10h,
      testParams(trip.currency),
    );
    expect(s.settledLegs.PLATFORM.amountMinor < 0n).toBe(true);
    expect(s.negativeLeg).toBe(true);
    // Le remboursement n'est pas réduit : équilibre intact, variation = − remboursement.
    expect(s.legVariation.total.amountMinor).toBe(-s.guestRefund.amountMinor);
  });

  it.each([
    ['N (USD)', N],
    ['NP (PYG)', NP],
  ] as const)(
    '%s annulé dans la fenêtre gratuite (T − 2 j) : rien retenu, drapeau baissé',
    (_name, trip) => {
      const s = computeCancellationSettlement(
        trip,
        { reason: 'GUEST_CANCELLED', requestedAtMs: at(-2 * 24 * 60) },
        testParams(trip.currency),
      );
      expect(s.settledLegs.total.amountMinor).toBe(0n);
      expect(s.negativeLeg).toBe(false);
    },
  );
});
