/**
 * Carte des résultats (US-203 ; 19 US-203 critère 1 « liste et carte montrent les mêmes
 * véhicules » ; 16 SRC-008 « marqueur placé sur la zone approximative ») : positions des
 * marqueurs calculées depuis le point approximatif seul ; chaque annonce est soit placée, soit
 * listée « sans point », jamais omise ; l'ordre des résultats est gardé.
 */
import { describe, expect, it } from 'vitest';
import { mapLayout } from './search-map.ts';

const id = (n: number): string => `20300000-0000-4000-8000-00000000000${n}`;

describe('US-203 — carte des résultats', () => {
  it('chaque annonce est placée ou listée sans point, dans l’ordre des résultats ; aucune n’est omise', () => {
    const results = [
      { id: id(1), point: { lat: 8.99, lng: -79.51 } },
      { id: id(2), point: null },
      { id: id(3), point: { lat: 9.01, lng: -79.53 } },
      { id: id(4), point: { lat: 8.97, lng: -79.49 } },
    ];
    const m = mapLayout(results);
    expect(m.placed.map((p) => p.id)).toEqual([id(1), id(3), id(4)]);
    expect(m.unplaced).toEqual([id(2)]);
    expect([...m.placed.map((p) => p.id), ...m.unplaced].sort()).toEqual(
      results.map((r) => r.id).sort(),
    );
  });

  it('projection : ouest à gauche, nord en haut, dans la marge intérieure du cadre', () => {
    const m = mapLayout([
      { id: id(1), point: { lat: 9.0, lng: -79.6 } }, // nord-ouest
      { id: id(2), point: { lat: 8.9, lng: -79.4 } }, // sud-est
    ]);
    const [nw, se] = m.placed;
    expect(nw!.xPct).toBeLessThan(se!.xPct);
    expect(nw!.yPct).toBeLessThan(se!.yPct);
    for (const p of m.placed) {
      expect(p.xPct).toBeGreaterThanOrEqual(20);
      expect(p.xPct).toBeLessThanOrEqual(80);
      expect(p.yPct).toBeGreaterThanOrEqual(16);
      expect(p.yPct).toBeLessThanOrEqual(84);
    }
  });

  it('un seul point, ou des points identiques (même zone arrondie) : centrés puis décalés, jamais superposés', () => {
    expect(mapLayout([{ id: id(1), point: { lat: 8.99, lng: -79.51 } }]).placed).toEqual([
      { id: id(1), xPct: 50, yPct: 50 },
    ]);
    const same = mapLayout(
      [1, 2, 3].map((n) => ({ id: id(n), point: { lat: 8.99, lng: -79.51 } })),
    ).placed;
    expect(same).toHaveLength(3);
    const ys = same.map((p) => p.yPct);
    expect(new Set(ys).size).toBe(3);
    for (const p of same) {
      expect(p.yPct).toBeGreaterThanOrEqual(16);
      expect(p.yPct).toBeLessThanOrEqual(84);
    }
  });

  it('aucun point : rien à placer, tout est listé sans point', () => {
    expect(mapLayout([{ id: id(1), point: null }])).toEqual({ placed: [], unplaced: [id(1)] });
    expect(mapLayout([])).toEqual({ placed: [], unplaced: [] });
  });
});
