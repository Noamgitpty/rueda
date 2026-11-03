/**
 * Harnais des vecteurs dorés (US-016) : l'export des oracles est chargé, couvre T01–T68, TJ01–TJ21
 * et TA01–TA11, dans les deux devises de test, et respecte les invariants écrits dans 08.
 *
 * Les valeurs d'ancrage ci-dessous sont recopiées des tables de 08 (« Jeux de tests de référence »,
 * « T28–T48 », E7 « TJ ») et de 16 A.8.1 ; aucune ne vient d'un moteur. Ces tests ne recalculent
 * aucun règlement : ils contrôlent la lecture de l'export et ses équilibres.
 */
import { describe, expect, it } from 'vitest';
import {
  LEG_NAMES,
  checksFor,
  legVector,
  legVectors,
  loadGoldenVectors,
  settlementVector,
  settlementVectors,
  type GoldenLegVector,
} from '../src/index.ts';

const set = loadGoldenVectors();
const ids = (n: number, prefix: string): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
const sum = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);
const legSum = (v: GoldenLegVector): bigint => sum(LEG_NAMES.map((k) => v.legsMinor[k]));

/** Devises de test des oracles (« USD x100, PYG x1 ») : données de test, pas du code produit. */
const PA = 'USD';
const PY = 'PYG';

describe('chargement et couverture', () => {
  it('lit le format 1 avec les deux devises de test et leurs exposants', () => {
    expect(set.format).toBe(1);
    expect(set.currencies.get(PA)?.exponent).toBe(2);
    expect(set.currencies.get(PY)?.exponent).toBe(0);
  });

  it('couvre T01–T48 : 48 / 48 (règlement économique ou couche d’exécution)', () => {
    const covered = new Set([
      ...set.settlement.map((v) => v.id),
      ...set.checks.flatMap((c) => (c.vectorId ? [c.vectorId.replace(/[a-z]$/, '')] : [])),
    ]);
    expect(ids(48, 'T').filter((id) => !covered.has(id))).toEqual([]);
  });

  it('couvre les attentes de T49–T68 par les contrôles des oracles', () => {
    for (const id of ids(68, 'T').slice(48)) {
      expect(checksFor(set, id).length, id).toBeGreaterThan(0);
    }
  });

  it('couvre TA01–TA11 (16 A.8.1), chacun avec une attente d’oracle ou des TJ de référence', () => {
    expect(set.acceptance.map((a) => a.id)).toEqual(ids(11, 'TA'));
    for (const a of set.acceptance) {
      const evidence =
        a.checkLabels.length + a.legVectorRefs.length + (a.expected === undefined ? 0 : 1);
      expect(evidence, a.id).toBeGreaterThan(0);
      for (const ref of a.legVectorRefs) expect(() => legVector(set, ref)).not.toThrow();
    }
  });

  it('contient chaque TJ01–TJ21 de 08 E7, en USD et en PYG', () => {
    const families = new Set(set.legs.map((v) => v.id.slice(0, 4)));
    expect([...families].sort()).toEqual(ids(21, 'TJ'));
    expect(legVectors(set, { currency: PA }).length).toBeGreaterThan(0);
    expect(legVectors(set, { currency: PY }).length).toBeGreaterThan(0);
  });

  it('rejoue des vecteurs de règlement dans les deux devises', () => {
    expect(settlementVectors(set, { currency: PA }).length).toBeGreaterThan(0);
    expect(settlementVectors(set, { currency: PY }).map((v) => v.id)).toEqual([
      'T27',
      'T40',
      'T41',
      'T48',
    ]);
  });
});

describe('ancrages recopiés de 08 et 16', () => {
  it('T03 (USD) : 187,44 / 6,44 / 45,00 / 21,00 / 0', () => {
    const e = settlementVector(set, 'T03').expected;
    expect([
      e.guestRefundMinor,
      e.taxRefundedMinor,
      e.hostEarningsMinor,
      e.platformNetMinor,
      e.hostPenaltyMinor,
    ]).toEqual([18744n, 644n, 4500n, 2100n, 0n]);
  });

  it('T27 (PYG, sans décimale) : 1 000 367 / 75 033 / 268 750 / 131 416', () => {
    const v = settlementVector(set, 'T27');
    expect(v.currency).toBe(PY);
    const e = v.expected;
    expect([
      e.guestRefundMinor,
      e.taxRefundedMinor,
      e.hostEarningsMinor,
      e.platformNetMinor,
    ]).toEqual([1000367n, 75033n, 268750n, 131416n]);
    expect(v.trip.totalPaidMinor).toBe(1438050n);
  });

  it('T40 (PYG) : égalité exacte de allocHost, résidu à la plateforme (hôte 268 750)', () => {
    expect(settlementVector(set, 'T40').expected.hostEarningsMinor).toBe(268750n);
  });

  it('T14 : pénalité 25 en unités majeures = 2 500 unités mineures (T62)', () => {
    const e = settlementVector(set, 'T14').expected;
    expect([e.hostPenaltyMajor, e.hostPenaltyMinor]).toEqual([25n, 2500n]);
  });

  it('TJ01 : HOST 131,25 ; INSURER 25,50 ; TAX_THIRD_PARTY 0,00 ; PLATFORM 99,91 ; total 256,66', () => {
    const v = legVector(set, 'TJ01');
    expect(LEG_NAMES.map((k) => v.legsMinor[k])).toEqual([13125n, 2550n, 0n, 9991n]);
    expect(v.totalMinor).toBe(25666n);
  });

  it('TA07 : jours facturés 3 ; 4 ; 1 (verif15_ta.py)', () => {
    expect(set.acceptance.find((a) => a.id === 'TA07')?.expected).toEqual({
      billedDays: { minutes4349: 3n, minutes4350: 4n, minutes240: 1n },
    });
  });
});

describe('statut normatif (OQ-BR-24, DEC-FONDATEUR-01)', () => {
  it('T48 (pénalité PYG PROPOSÉE) et T17, T18, T20 (option A non décidée) sont non normatifs', () => {
    const non = set.settlement.filter((v) => !v.normative);
    expect(non.map((v) => v.id)).toEqual(['T17', 'T18', 'T20', 'T48']);
    for (const v of non) expect(v.nonNormativeReason).toBeTruthy();
    expect(settlementVectors(set, { normativeOnly: true }).length).toBe(set.settlement.length - 4);
  });

  it('les contrôles de T62 sont non normatifs ; T55 n’a pas de variante', () => {
    expect(checksFor(set, 'T62').length).toBeGreaterThan(0);
    for (const c of checksFor(set, 'T62')) expect(c.normative).toBe(false);
    expect(set.settlement.some((v) => v.id.startsWith('T55'))).toBe(false);
  });
});

describe('invariants de 08 sur les données exportées', () => {
  it.each(set.settlement.map((v) => [v.id, v] as const))(
    '%s : équilibre et définitions',
    (_id, v) => {
      const e = v.expected;
      const taxPaid = sum(v.trip.taxGroups.map((g) => g.taxPaidMinor));
      // total payé = Σ lignes + Σ taxes de ligne
      expect(sum(Object.values(v.trip.linesMinor)) + taxPaid).toBe(v.trip.totalPaidMinor);
      // remboursement guest + Σ retenu HT + taxe retenue = total payé (contrôle d'équilibre de 08)
      expect(e.guestRefundMinor + e.retainedMinor + e.retainedTaxMinor).toBe(v.trip.totalPaidMinor);
      // taxe remboursée + taxe retenue = taxe payée
      expect(e.taxRefundedMinor + e.retainedTaxMinor).toBe(taxPaid);
      // net plateforme HT = Σ retenu HT − gains hôte ; gains = part du guest + compensation
      expect(e.platformNetMinor).toBe(e.retainedMinor - e.hostEarningsMinor);
      expect(e.hostEarningsMinor).toBe(e.hostFromGuestMinor + e.hostCompensationMinor);
      // pénalité : unités majeures × 10^exposant de la devise (T62)
      const exponent = set.currencies.get(v.currency)?.exponent;
      expect(exponent).toBeDefined();
      expect(e.hostPenaltyMinor).toBe(e.hostPenaltyMajor * 10n ** BigInt(exponent ?? 0));
      expect(e.guestRefundMinor >= 0n && e.guestRefundMinor <= v.trip.totalPaidMinor).toBe(true);
    },
  );

  it.each(set.legs.map((v) => [v.id, v] as const))(
    '%s : Σ jambes = total et signes de E7',
    (_id, v) => {
      expect(legSum(v)).toBe(v.totalMinor);
      const l = v.legsMinor;
      if (v.kind === 'ALLOCATION') for (const k of LEG_NAMES) expect(l[k] >= 0n, k).toBe(true);
      if (v.kind === 'REFUSED_CAPTURE') expect(l.PLATFORM < 0n).toBe(true);
      if (v.kind === 'CHARGEBACK_LOSS') {
        expect([l.INSURER, l.TAX_THIRD_PARTY]).toEqual([0n, 0n]);
        expect(l.HOST <= 0n && l.PLATFORM <= 0n).toBe(true);
      }
    },
  );

  // 08 E7 : TJ02 = T03, TJ04 = T05, TJ05 = T39, TJ08 = T27, TJ09 = T40.
  it.each([
    ['TJ02', 'T03', true],
    ['TJ04', 'T05', true],
    ['TJ05', 'T39', true],
    ['TJ08', 'T27', false],
    ['TJ09', 'T40', false],
  ] as const)(
    '%s recoupe %s : variation = − remboursement, jambe HOST = gains hôte',
    (tj, t, hasKept) => {
      const s = settlementVector(set, t);
      const variation = legVector(set, `${tj}b`);
      expect(variation.kind).toBe('VARIATION');
      expect(variation.currency).toBe(s.currency);
      expect(variation.totalMinor).toBe(-s.expected.guestRefundMinor);
      if (hasKept) {
        const kept = legVector(set, `${tj}a`);
        expect(kept.totalMinor).toBe(s.expected.retainedMinor + s.expected.retainedTaxMinor);
        expect(kept.legsMinor.HOST).toBe(s.expected.hostEarningsMinor);
      }
    },
  );

  it('TJ06 recoupe T14 (FULL) : variation = − 256,66', () => {
    expect(legVector(set, 'TJ06').totalMinor).toBe(
      -settlementVector(set, 'T14').expected.guestRefundMinor,
    );
  });
});
