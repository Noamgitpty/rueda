/**
 * Aides pures du fuzz C11 (US-025) : déterminisme du générateur, graines dérivées, rejeu, mode
 * court par défaut et mode long explicite.
 */
import { describe, expect, it } from 'vitest';
import {
  C11_CI_RUNS,
  C11_DEFAULT_SEED,
  C11_NIGHTLY_RUNS,
  c11Config,
  formatReplay,
  parseReplay,
  Rng,
  runSeed,
} from './c11.ts';

const draw = (seed: number, n: number): number[] => {
  const r = new Rng(seed);
  return Array.from({ length: n }, () => r.next());
};

describe('fuzz C11 — aides pures', () => {
  it('même graine, même suite ; graines voisines, suites différentes ; sortie dans [0, 1)', () => {
    expect(draw(42, 50)).toEqual(draw(42, 50));
    expect(draw(42, 50)).not.toEqual(draw(43, 50));
    for (const x of draw(7, 10_000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('entiers et choix pondérés couvrent leur domaine, sans biais grossier', () => {
    const r = new Rng(1);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 40_000; i++) {
      const k = r.int(4);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(600);
    const w = { a: 1, b: 0, c: 3 };
    const seen = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 8_000; i++) seen[r.weighted(w)]++;
    expect(seen.b).toBe(0);
    expect(seen.c / seen.a).toBeGreaterThan(2.5);
    expect(seen.c / seen.a).toBeLessThan(3.5);
    expect(() => r.int(0)).toThrow(RangeError);
    expect(() => r.pick([])).toThrow(RangeError);
    expect(() => new Rng(-1)).toThrow(RangeError);
  });

  it('graines dérivées : stables, distinctes sur 10 000 exécutions, sur 32 bits', () => {
    const seeds = Array.from({ length: C11_NIGHTLY_RUNS }, (_, i) => runSeed(C11_DEFAULT_SEED, i));
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(runSeed(C11_DEFAULT_SEED, 3)).toBe(seeds[3]);
    for (const s of seeds) expect(s >>> 0).toBe(s);
  });

  it('rejeu : format et lecture aller-retour, refus des formes illisibles', () => {
    const orders = { 7: [1, 0], 2: [2, 0, 1] };
    const text = formatReplay(123, orders);
    expect(text).toBe('123:2=2,0,1;7=1,0');
    expect(parseReplay(text)).toEqual({ seed: 123, orders: { 2: [2, 0, 1], 7: [1, 0] } });
    expect(parseReplay('99')).toEqual({ seed: 99 });
    expect(formatReplay(99, {})).toBe('99');
    for (const bad of ['', 'x', '1:2=', '1:2=1,1', '99999999999']) {
      expect(() => parseReplay(bad), bad).toThrow(RangeError);
    }
  });

  it('configuration : mode court par défaut (1 000), mode long explicite, rejeu = 1 exécution', () => {
    expect(c11Config({})).toEqual({ runs: C11_CI_RUNS, seed: C11_DEFAULT_SEED });
    expect(C11_CI_RUNS).toBe(1000);
    expect(c11Config({ RUEDA_C11_RUNS: 'nightly' }).runs).toBe(10_000);
    expect(c11Config({ RUEDA_C11_RUNS: '25', RUEDA_C11_SEED: '5' })).toEqual({ runs: 25, seed: 5 });
    expect(c11Config({ RUEDA_C11_REPLAY: '77:3=1,0', RUEDA_C11_FAILURES: 'f.json' })).toEqual({
      runs: 1,
      seed: C11_DEFAULT_SEED,
      replay: { seed: 77, orders: { 3: [1, 0] } },
      failuresFile: 'f.json',
    });
    for (const bad of [
      { RUEDA_C11_RUNS: '0' },
      { RUEDA_C11_RUNS: 'x' },
      { RUEDA_C11_SEED: '-3' },
    ]) {
      expect(() => c11Config(bad)).toThrow(RangeError);
    }
  });
});
