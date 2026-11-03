import { describe, expect, it } from 'vitest';
import { FakeMapTiles } from '../src/maps/index.ts';
import { sniffMime } from '../src/files/index.ts';
import { clock } from './support.ts';

const setup = () => new FakeMapTiles({ clock: clock(), maxZoom: 18 });

describe('FakeMapTiles (fonds de carte seuls)', () => {
  it('réussite : tuile PNG ; doublon de requête ⇒ mêmes octets', async () => {
    const tiles = setup();
    const a = await tiles.tile({ z: 12, x: 1_000, y: 2_000 });
    const b = await tiles.tile({ z: 12, x: 1_000, y: 2_000 });
    if (a.status !== 'OK' || b.status !== 'OK') throw new Error('tuiles attendues');
    expect(sniffMime(a.value.body)).toBe('image/png');
    expect(a.value.body.equals(b.value.body)).toBe(true);
    expect(a.value.attribution).not.toBe('');
  });

  it('refus : coordonnées hors grille ou zoom hors bornes ; quota épuisé', async () => {
    const tiles = setup();
    for (const t of [
      { z: 19, x: 0, y: 0 },
      { z: -1, x: 0, y: 0 },
      { z: 2, x: 4, y: 0 },
      { z: 2, x: 0, y: -1 },
      { z: 1.5, x: 0, y: 0 },
    ]) {
      expect(await tiles.tile(t)).toEqual({ status: 'REFUSED', reason: 'OUT_OF_RANGE' });
    }
    tiles.runtime.script.script('tile', { kind: 'REFUSE', reason: 'QUOTA_EXCEEDED' });
    expect(await tiles.tile({ z: 0, x: 0, y: 0 })).toEqual({
      status: 'REFUSED',
      reason: 'QUOTA_EXCEEDED',
    });
    expect(() => new FakeMapTiles({ clock: clock(), maxZoom: 23 })).toThrow(RangeError);
  });

  it('échec et délai : panne prolongée, délai dépassé, tuile lente', async () => {
    const tiles = setup();
    tiles.runtime.script.script('tile', { kind: 'TIMEOUT_BEFORE' }, { kind: 'DELAY', ms: 3_000 });
    expect(await tiles.tile({ z: 0, x: 0, y: 0 })).toEqual({ status: 'TIMEOUT' });
    expect((await tiles.tile({ z: 0, x: 0, y: 0 })).status).toBe('OK');
    expect(tiles.runtime.clock.now().toISOString()).toBe('2026-11-03T12:00:03.000Z');
    tiles.runtime.script.setDefault('tile', { kind: 'UNAVAILABLE' });
    expect(await tiles.tile({ z: 0, x: 0, y: 0 })).toEqual({ status: 'UNAVAILABLE' });
  });
});
