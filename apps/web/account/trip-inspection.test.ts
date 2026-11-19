/**
 * Lecture défensive de la série de photos (US-303) : une réponse bien formée donne la vue ; toute
 * forme inattendue ⇒ `null` (jamais une série partielle). Attendus : contrat OpenAPI
 * `TripInspection` et 16 TRP-004 (25 angles obligatoires), jamais le code testé.
 */
import { describe, expect, it } from 'vitest';
import { requiredProgress, sectionOf, slotLabel, tripInspectionOf } from './trip-inspection.ts';

const TRIP = '00000000-0000-4000-8000-000000000303';
const FILE = '00000000-0000-4000-8000-0000000003f1';
const slots = [
  { code: 'EXT_01', group: 'EXTERIOR', required: true },
  { code: 'INT_01', group: 'INTERIOR', required: true },
  { code: 'FUEL', group: 'FUEL', required: true },
  { code: 'DAMAGE_03', group: 'DAMAGE', required: false },
];
const reply = (over: Record<string, unknown> = {}) => ({
  status: 200 as const,
  json: {
    tripId: TRIP,
    kind: 'checkin',
    viewerRole: 'GUEST',
    timezone: 'UTC',
    open: true,
    uploads: { open: true, maxBytes: 76032, maxLongSidePx: 1600, mimeTypes: ['image/jpeg'] },
    slots,
    sides: [
      { role: 'HOST', status: 'NONE', submittedAt: null, photos: [] },
      {
        role: 'GUEST',
        status: 'DRAFT',
        submittedAt: null,
        photos: [
          {
            slot: 'EXT_01',
            fileId: FILE,
            sha256: 'a'.repeat(64),
            bytes: 10,
            receivedAt: '2036-12-10T14:05:00.000Z',
            clockSkew: false,
          },
        ],
      },
    ],
    ...over,
  },
  session: null,
});

describe('US-303 — série de photos lue par le site', () => {
  it('réponse bien formée : ma série et celle de l’autre partie, progression des obligatoires', () => {
    const v = tripInspectionOf(reply());
    expect(v?.mine.role).toBe('GUEST');
    expect(v?.other.role).toBe('HOST');
    expect(requiredProgress(v!.slots, v!.mine)).toEqual({ done: 1, total: 3 });
    expect(v!.slots.map(sectionOf)).toEqual(['EXTERIOR', 'INTERIOR', 'GAUGES', 'OPTIONAL']);
    expect(slotLabel('DAMAGE_03')).toEqual({
      key: 'web.inspection.slot.DAMAGE',
      values: { n: '3' },
    });
  });

  it('forme inattendue ⇒ null', () => {
    for (const over of [
      { viewerRole: 'STAFF' },
      { kind: 'arrival' },
      { tripId: 'x' },
      { timezone: '' },
      { slots: [{ code: 'ROOF', group: 'EXTERIOR', required: true }] },
      { sides: [{ role: 'GUEST', status: 'DRAFT', submittedAt: null, photos: [] }] },
      {
        sides: [
          { role: 'HOST', status: 'NONE', submittedAt: null, photos: [] },
          { role: 'GUEST', status: 'DRAFT', submittedAt: null, photos: [{ slot: 'EXT_01' }] },
        ],
      },
    ]) {
      expect(tripInspectionOf(reply(over)), JSON.stringify(over)).toBeNull();
    }
    expect(tripInspectionOf({ status: 404, json: {}, session: null })).toBeNull();
    expect(tripInspectionOf({ status: 'unavailable' })).toBeNull();
  });
});
