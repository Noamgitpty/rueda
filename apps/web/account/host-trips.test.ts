/**
 * Lecture défensive des trips de l'hôte (US-219) : une réponse mal formée est refusée en bloc
 * (jamais une donnée partielle) ; montant relu tel quel (jamais recalculé) ; filtres d'A05 sans
 * valeur étrangère. Attendus : 16 HDB-002, 17 `host_guest_v`.
 */
import { describe, expect, it } from 'vitest';
import {
  hostTripOf,
  hostTripsOf,
  tripCarLabel,
  tripFilterQuery,
  tripReference,
} from './host-trips.ts';

const ID = '21900000-0000-4000-8000-000000000001';
const CAR = '21900000-0000-4000-8000-000000000002';
const trip = {
  tripId: ID,
  reference: null,
  tab: 'UPCOMING',
  status: 'BOOKED',
  vehicle: { id: CAR, makeText: 'Toyota', modelText: 'Yaris', year: 2021, plate: 'AB123' },
  handoverPlace: 'Casa',
  startsAt: '2036-12-12T14:00:00.000Z',
  endsAt: '2036-12-13T14:00:00.000Z',
  timezone: 'UTC',
  bookedAt: '2036-12-10T15:00:00.000Z',
  paymentStatus: 'CONFIRMED',
  currency: 'XXX',
  hostEarningsMinor: '850000',
  guest: { firstName: 'Lucía', ageYears: 29, rating: null, verified: true },
};
const market = { currency: 'XXX', currencyExponent: 0 };
const ok = (json: unknown) => ({ status: 200, json, session: null });

describe('hostTripsOf / hostTripOf (US-219)', () => {
  it('réponse conforme : trips et marché relus tels quels', () => {
    const r = hostTripsOf(ok({ market, trips: [trip] }));
    expect(r?.market).toEqual(market);
    expect(r?.trips[0]).toMatchObject({ tripId: ID, hostEarningsMinor: 850000n, tab: 'UPCOMING' });
    expect(hostTripOf(ok({ market, trip }))?.trip.guest).toEqual(trip.guest);
  });

  it('réponse mal formée ou refusée ⇒ null (aucune donnée partielle)', () => {
    for (const bad of [
      { ...trip, tab: 'ARCHIVED' },
      { ...trip, tripId: 'x' },
      { ...trip, hostEarningsMinor: '12.50' },
      { ...trip, hostEarningsMinor: 12 },
      { ...trip, paymentStatus: 'PENDING' },
      { ...trip, guest: { ...trip.guest, verified: 'yes' } },
      { ...trip, startsAt: 'demain' },
    ]) {
      expect(hostTripsOf(ok({ market, trips: [trip, bad] }))).toBeNull();
    }
    expect(hostTripsOf(ok({ market: { currency: 'XXX' }, trips: [] }))).toBeNull();
    expect(
      hostTripsOf({ status: 404, json: { code: 'HOST_ACCOUNT_NOT_FOUND' }, session: null }),
    ).toBeNull();
    expect(hostTripOf(ok({ market, trip: { ...trip, guest: null } }))).toBeNull();
  });

  it('libellés : auto (marque, modèle, année, plaque) ; référence de repli', () => {
    const t = hostTripsOf(ok({ market, trips: [trip] }))?.trips[0];
    if (t === undefined) throw new Error('trip attendu');
    expect(tripCarLabel(t)).toBe('Toyota Yaris · 2021 · AB123');
    expect(tripReference(t)).toBe('21900000');
    expect(tripReference({ ...t, reference: 'KM-42' })).toBe('KM-42');
  });

  it('filtres d’A05 : onglet par défaut « à venir », valeurs étrangères écartées', () => {
    expect(tripFilterQuery({}).params.toString()).toBe('tab=UPCOMING');
    const q = tripFilterQuery({ tab: 'DONE', vehicleId: CAR, from: '2036-12-01', to: 'x', y: '1' });
    expect(q.tab).toBe('DONE');
    expect(q.params.toString()).toBe(`tab=DONE&vehicleId=${CAR}&from=2036-12-01`);
    expect(tripFilterQuery({ tab: 'HACK', vehicleId: 'x' }).params.toString()).toBe('tab=UPCOMING');
  });
});
