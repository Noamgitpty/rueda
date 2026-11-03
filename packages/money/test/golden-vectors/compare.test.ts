/**
 * Comparateurs du harnais : un moteur fictif (doublure de test ; aucun moteur réel n'existe encore)
 * rend l'attendu exporté, puis l'attendu décalé d'une unité mineure ; l'écart doit être détecté.
 */
import { describe, expect, it } from 'vitest';
import {
  LEG_NAMES,
  SETTLEMENT_COLUMNS_08,
  compareLegs,
  compareSettlement,
  legVectors,
  loadGoldenVectors,
  GoldenVectorsError,
  replay,
  settlementVectors,
  type GoldenSettlementVector,
  type SettlementObservation,
} from '../../src/golden-vectors/index.ts';

const set = loadGoldenVectors();
const echo = (v: GoldenSettlementVector): SettlementObservation =>
  Object.fromEntries(SETTLEMENT_COLUMNS_08.map((f) => [f, v.expected[f]]));
const first = (): GoldenSettlementVector => {
  const v = settlementVectors(set)[0];
  if (!v) throw new Error('export vide');
  return v;
};

describe('compareSettlement et replay', () => {
  it('un moteur qui rend l’attendu passe sur tous les vecteurs, dans les deux devises', () => {
    const report = replay(settlementVectors(set), echo, compareSettlement);
    expect(report.replayed).toBe(set.settlement.length);
    expect(report.mismatches).toEqual([]);
  });

  it.each(SETTLEMENT_COLUMNS_08)('un écart d’une unité mineure sur %s est détecté', (field) => {
    const v = first();
    const obs = { ...echo(v), [field]: v.expected[field] + 1n };
    expect(compareSettlement(v, obs)).toEqual([
      { vectorId: v.id, field, expected: v.expected[field], observed: v.expected[field] + 1n },
    ]);
  });

  it('un champ absent ou un number est un écart (fail-closed)', () => {
    const v = first();
    const partial: Record<string, bigint | undefined> = { ...echo(v) };
    delete partial['guestRefundMinor'];
    expect(compareSettlement(v, partial).map((m) => m.field)).toEqual(['guestRefundMinor']);
    const asNumber = {
      ...echo(v),
      hostEarningsMinor: Number(v.expected.hostEarningsMinor),
    } as unknown as SettlementObservation;
    expect(compareSettlement(v, asNumber).map((m) => m.field)).toEqual(['hostEarningsMinor']);
  });

  it('une exception du moteur est un écart, jamais un vecteur ignoré', () => {
    const report = replay(
      settlementVectors(set).slice(0, 2),
      (): SettlementObservation => {
        throw new Error('moteur absent');
      },
      compareSettlement,
    );
    expect(report.mismatches.map((m) => m.field)).toEqual(['exception', 'exception']);
  });

  it('une liste vide lève GOLDEN_REPLAY_EMPTY au lieu de passer sans rien comparer', () => {
    const empty = settlementVectors(set, { currency: 'XXX' });
    expect(empty).toEqual([]);
    expect(() => replay(empty, echo, compareSettlement)).toThrow(GoldenVectorsError);
    expect(() => replay([], echo, compareSettlement)).toThrow(/GOLDEN_REPLAY_EMPTY/);
  });
});

describe('compareLegs', () => {
  it('aucun écart sur l’attendu, un écart par jambe décalée d’une unité', () => {
    for (const v of legVectors(set)) {
      expect(compareLegs(v, { legsMinor: v.legsMinor, totalMinor: v.totalMinor })).toEqual([]);
      for (const k of LEG_NAMES) {
        const legs = { ...v.legsMinor, [k]: v.legsMinor[k] - 1n };
        expect(
          compareLegs(v, { legsMinor: legs, totalMinor: v.totalMinor }).map((m) => m.field),
        ).toEqual([k]);
      }
    }
  });

  it('un total absent est un écart', () => {
    const v = legVectors(set)[0];
    expect(v).toBeDefined();
    if (v)
      expect(compareLegs(v, { legsMinor: v.legsMinor }).map((m) => m.field)).toEqual([
        'totalMinor',
      ]);
  });
});
