/**
 * Lecture défensive des réponses de la fiche S03 (US-204) : galerie dans l'ordre de l'hôte,
 * notes, hôte vérifié, dates choisies, lieu exact. Valeurs de forme seulement (aucun montant :
 * le site n'en calcule aucun ici).
 */
import { describe, expect, it } from 'vitest';
import {
  listingExtrasOf,
  meetingPointOf,
  photoSrc,
  ratingValue,
  slotApiPath,
  slotInputOf,
  slotViewOf,
} from './listing-page.ts';

const L = '00000000-0000-4000-8000-0000000204a1';
const P1 = '00000000-0000-4000-8000-0000000204b1';
const P2 = '00000000-0000-4000-8000-0000000204b2';
const ok = (json: unknown) => ({ status: 200, json, session: null }) as const;
const listing = (extra: Record<string, unknown>) =>
  ok({
    listing: {
      id: L,
      hostVerified: true,
      ratings: null,
      photos: [
        { id: P2, order: 0, key: `listing/${L}/${P2}` },
        { id: P1, order: 3, key: `listing/${L}/${P1}` },
      ],
      ...extra,
    },
  });

describe('listingExtrasOf', () => {
  it('garde l’ordre rendu par l’API (ordre de l’hôte), chemins du site seulement', () => {
    const x = listingExtrasOf(listing({}));
    expect(x?.photos).toEqual([
      { id: P2, src: `/media/listing/${L}/${P2}` },
      { id: P1, src: `/media/listing/${L}/${P1}` },
    ]);
    expect(x?.hostVerified).toBe(true);
    expect(x?.vehicleRating).toBeNull();
  });

  it('refuse un ordre non croissant, une clé d’une autre annonce ou hors forme, un champ manquant', () => {
    const swapped = [
      { id: P2, order: 3, key: `listing/${L}/${P2}` },
      { id: P1, order: 0, key: `listing/${L}/${P1}` },
    ];
    expect(listingExtrasOf(listing({ photos: swapped }))).toBeNull();
    const foreign = [{ id: P1, order: 0, key: `listing/${P2}/${P1}` }];
    expect(listingExtrasOf(listing({ photos: foreign }))).toBeNull();
    const traversal = [{ id: P1, order: 0, key: `../${L}/${P1}` }];
    expect(listingExtrasOf(listing({ photos: traversal }))).toBeNull();
    expect(listingExtrasOf(listing({ hostVerified: undefined }))).toBeNull();
    expect(listingExtrasOf(listing({ photos: undefined }))).toBeNull();
    expect(listingExtrasOf({ status: 'unavailable' })).toBeNull();
  });

  it('notes : moyenne ×100 lue telle quelle, « Nuevo » sans avis ; incohérence refusée', () => {
    const x = listingExtrasOf(
      listing({
        ratings: {
          vehicle: { averageX100: 480, reviewCount: 3, tripCount: 5 },
          host: { averageX100: null, reviewCount: 0, tripCount: 2 },
        },
      }),
    );
    expect(ratingValue(x?.vehicleRating ?? null)).toBe(4.8);
    expect(ratingValue(x?.hostRating ?? null)).toBeUndefined();
    expect(x?.hostRating?.tripCount).toBe(2);
    const bad = { averageX100: null, reviewCount: 2, tripCount: 2 };
    expect(listingExtrasOf(listing({ ratings: { vehicle: bad, host: bad } }))).toBeNull();
  });

  it('photoSrc : clé fermée de la même annonce', () => {
    expect(photoSrc(L, `listing/${L}/${P1}`)).toBe(`/media/listing/${L}/${P1}`);
    expect(photoSrc(L, `listing/${L}/${P1}/x`)).toBeNull();
    expect(photoSrc(L, `https://ailleurs/${P1}`)).toBeNull();
  });
});

describe('slotInputOf', () => {
  it('reprend ?start=&end= de la recherche ou les champs du formulaire de la fiche', () => {
    expect(slotInputOf({})).toBeNull();
    expect(slotInputOf({ start: '2036-12-10T10:00', end: '2036-12-12T10:00' })).toEqual({
      ok: true,
      input: { start: '2036-12-10T10:00', end: '2036-12-12T10:00' },
    });
    expect(
      slotInputOf({
        startDate: '2036-12-10',
        startTime: '10:30',
        endDate: '2036-12-12',
        endTime: '09:00',
        start: 'ignoré',
      }),
    ).toEqual({ ok: true, input: { start: '2036-12-10T10:30', end: '2036-12-12T09:00' } });
  });

  it('fin ≤ début, hors pas de 30 min ou champ manquant ⇒ SEARCH_DATES_INVALID', () => {
    const refused = { ok: false, code: 'SEARCH_DATES_INVALID' };
    expect(slotInputOf({ start: '2036-12-10T10:00', end: '2036-12-10T09:30' })).toEqual(refused);
    expect(slotInputOf({ start: '2036-12-10T10:15', end: '2036-12-12T10:00' })).toEqual(refused);
    expect(slotInputOf({ start: '2036-12-10T10:00' })).toEqual(refused);
    expect(slotInputOf({ startDate: '2036-12-10', startTime: '10:00' })).toEqual(refused);
  });

  it('chemin de l’API', () => {
    expect(slotApiPath(L, { start: '2036-12-10T10:00', end: '2036-12-12T10:00' })).toBe(
      `/listings/${L}/availability?start=2036-12-10T10%3A00&end=2036-12-12T10%3A00`,
    );
  });
});

describe('slotViewOf', () => {
  it('OK, préavis en heures, refus connus ; tout le reste : erreur, jamais « libre »', () => {
    expect(
      slotViewOf(
        ok({
          availability: {
            startAt: '2036-12-10T15:00:00.000Z',
            endAt: '2036-12-12T15:00:00.000Z',
            timezone: 'UTC',
          },
        }),
      ),
    ).toEqual({
      kind: 'OK',
      startAt: '2036-12-10T15:00:00.000Z',
      endAt: '2036-12-12T15:00:00.000Z',
    });
    const err = (status: number, json: unknown) => ({ status, json, session: null }) as const;
    expect(
      slotViewOf(err(422, { code: 'DATES_NOTICE_TOO_SHORT', values: { noticeHours: 3 } })),
    ).toEqual({ kind: 'NOTICE', hours: 3 });
    expect(slotViewOf(err(409, { code: 'DATES_UNAVAILABLE' }))).toEqual({
      kind: 'REFUSED',
      key: 'common.listing.datesUnavailable',
    });
    expect(slotViewOf(err(422, { code: 'DATES_NOTICE_TOO_SHORT' }))).toEqual({ kind: 'ERROR' });
    expect(slotViewOf(err(500, { code: 'INTERNAL_ERROR' }))).toEqual({ kind: 'ERROR' });
    expect(slotViewOf(ok({ availability: { startAt: 'demain' } }))).toEqual({ kind: 'ERROR' });
    expect(slotViewOf({ status: 'unavailable' })).toEqual({ kind: 'ERROR' });
  });
});

describe('meetingPointOf', () => {
  it('lieu exact rendu au voyageur ; 404 ou forme inattendue : rien', () => {
    const m = {
      placeLabel: 'Entrada',
      addressLine: 'Calle 1',
      city: 'Ciudad',
      areaLabel: null,
      locationKind: 'POI',
    };
    expect(meetingPointOf(ok({ meetingPoint: m }))).toEqual({
      placeLabel: 'Entrada',
      addressLine: 'Calle 1',
      city: 'Ciudad',
      areaLabel: null,
    });
    expect(
      meetingPointOf({ status: 404, json: { code: 'MEETING_POINT_NOT_FOUND' }, session: null }),
    ).toBeNull();
    expect(meetingPointOf(ok({ meetingPoint: { ...m, addressLine: 3 } }))).toBeNull();
  });
});
