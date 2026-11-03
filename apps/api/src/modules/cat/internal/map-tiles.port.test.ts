/** Conformance du FAKE au port `MapTiles` (US-020, ADR-058). */
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeMapTiles } from '@rueda/fake-adapters';
import type { MapTiles } from '../index.js';

describe('port MapTiles ← FAKE', () => {
  it('le FAKE se conforme au port ; coordonnées hors grille refusées', async () => {
    const port: MapTiles = new FakeMapTiles({
      clock: new FakeClock('2026-11-03T12:00:00Z'),
      maxZoom: 18,
    });
    expect(await port.tile({ z: 1, x: 2, y: 0 })).toEqual({
      status: 'REFUSED',
      reason: 'OUT_OF_RANGE',
    });
  });
});
