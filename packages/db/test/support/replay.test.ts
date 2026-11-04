/**
 * `withReplay` et `percentile` (US-007), sans base de données (revue sécurité US-007, constat 4).
 * Attendus : reprise de 17 §2.5 — `40P01` / `40001` rejoués au plus 3 fois, toute autre erreur
 * finale, traduite sans `DETAIL` ; percentile par rang le plus proche.
 */
import { describe, expect, it } from 'vitest';
import { cascadeBackoff, MAX_REPLAYS, percentile, SHORT_BACKOFF, withReplay } from './replay.ts';

const pgError = (code: string, constraint?: string) =>
  Object.assign(new Error(`sqlstate ${code}`), { code, constraint, detail: 'Key (x)=(secret)' });

describe('percentile', () => {
  it('rang le plus proche', () => {
    const v = Array.from({ length: 100 }, (_, i) => 100 - i); // 100 … 1, non trié
    expect(percentile(v, 0.95)).toBe(95);
    expect(percentile(v, 0.5)).toBe(50);
    expect(percentile(v, 1)).toBe(100);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([3, 1, 2], 0.01)).toBe(1);
  });

  it('liste vide : NaN', () => {
    expect(percentile([], 0.95)).toBeNaN();
  });
});

describe('withReplay (17 §2.5 « Reprise »)', () => {
  it('succès immédiat : aucun rejeu', async () => {
    const r = await withReplay(async () => 42);
    expect(r).toMatchObject({ value: 42, deadlocks: 0, serializationFailures: 0, replays: 0 });
    expect(r.error).toBeUndefined();
  });

  it('40P01 puis 40001 puis succès : deux rejeux comptés', async () => {
    const errors = [pgError('40P01'), pgError('40001')];
    let calls = 0;
    const r = await withReplay(async () => {
      calls++;
      const e = errors.shift();
      if (e) throw e;
      return 'ok';
    });
    expect(calls).toBe(3);
    expect(r).toMatchObject({ value: 'ok', deadlocks: 1, serializationFailures: 1, replays: 2 });
  });

  it('au plus 3 rejeux, puis RETRY', async () => {
    let calls = 0;
    const r = await withReplay(async () => {
      calls++;
      throw pgError('40P01');
    });
    expect(MAX_REPLAYS).toBe(3);
    expect(calls).toBe(MAX_REPLAYS + 1);
    expect(r).toMatchObject({ error: 'RETRY', deadlocks: 4, replays: 3 });
    expect(r.value).toBeUndefined();
  });

  it('23P01 : erreur finale traduite, sans rejeu ni DETAIL', async () => {
    let calls = 0;
    const r = await withReplay(async () => {
      calls++;
      throw pgError('23P01', 'vehicle_occupancy_no_overlap');
    });
    expect(calls).toBe(1);
    expect(r.error).toBe('VEHICLE_UNAVAILABLE');
    expect(r.raw).toEqual({ code: '23P01', constraint: 'vehicle_occupancy_no_overlap' });
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('erreur non PostgreSQL : finale, INTERNAL_ERROR', async () => {
    const r = await withReplay(async () => {
      throw new Error('boom');
    });
    expect(r.error).toBe('INTERNAL_ERROR');
    expect(r.replays).toBe(0);
  });
});

describe('attente avant rejeu', () => {
  it('défaut de 17 §2.5 : aléatoire courte, 5 à 50 ms', () => {
    for (let i = 0; i < 200; i++) {
      const ms = SHORT_BACKOFF(1);
      expect(ms).toBeGreaterThanOrEqual(5);
      expect(ms).toBeLessThan(50);
    }
  });

  it('injection (ADR-056) : [B, 1,5 B[ avec B = 3 × degré × deadlock_timeout', () => {
    const backoff = cascadeBackoff(100, 50); // B = 15 000 ms
    for (let replay = 1; replay <= MAX_REPLAYS; replay++) {
      for (let i = 0; i < 100; i++) {
        const ms = backoff(replay);
        expect(ms).toBeGreaterThanOrEqual(15_000);
        expect(ms).toBeLessThan(22_500);
      }
    }
    expect(() => cascadeBackoff(0, 50)).toThrow(RangeError);
    expect(() => cascadeBackoff(100, 0)).toThrow(RangeError);
  });

  it('withReplay applique l’attente fournie, numérotée par rejeu, sans changer le plafond', async () => {
    const asked: number[] = [];
    let calls = 0;
    const r = await withReplay(
      async () => {
        calls++;
        throw pgError('40P01');
      },
      (replay) => {
        asked.push(replay);
        return 0;
      },
    );
    expect(asked).toEqual([1, 2, 3]);
    expect(calls).toBe(MAX_REPLAYS + 1);
    expect(r).toMatchObject({ error: 'RETRY', deadlocks: 4, replays: 3 });
  });
});
