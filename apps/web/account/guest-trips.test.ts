/**
 * US-214 — lecture défensive de `GET /trips` et `GET /trips/{id}` (« Mis viajes », détail du trip).
 * Attendus : 16 BKG-027 (liste, détail), 19 US-214 (trip d'autrui : rien), L2-PM-35 (hôte en prénom
 * et initiale) ; montants relus tels quels (bigint), jamais recalculés ; jamais le code testé.
 */
import { describe, expect, it } from 'vitest';
import {
  guestCarLabel,
  guestTripHref,
  guestTripOf,
  guestTripReference,
  guestTripsOf,
  hasRefund,
} from './guest-trips.ts';

const TRIP = '00000000-0000-4000-8000-000000000214';
const HOLD = '00000000-0000-4000-8000-0000000002a4';
const trip = {
  kind: 'TRIP',
  id: TRIP,
  reference: 'K-00000000',
  tab: 'UPCOMING',
  status: 'BOOKED',
  paymentStatus: 'CONFIRMED',
  currency: 'XXX',
  currencyExponent: 0,
  timezone: 'Etc/UTC',
  startsAt: '2034-03-10T15:00:00.000Z',
  endsAt: '2034-03-13T15:00:00.000Z',
  respondBy: null,
  vehicle: { make: 'Toyota', model: 'Yaris', year: 2022 },
  hostName: 'María G.',
  handover: { place: 'Punto', address: 'Calle 1', city: 'Ciudad' },
  totalMinor: '1071000',
  contract: 'TO_SIGN',
};
const request = {
  ...trip,
  kind: 'REQUEST',
  id: HOLD,
  reference: null,
  tab: 'REQUESTED',
  status: 'AWAITING_HOST',
  paymentStatus: null,
  respondBy: '2034-03-08T15:00:00.000Z',
  handover: { place: null, address: null, city: 'Ciudad' },
  contract: null,
};
const ok = (json: unknown) => ({ status: 200, json, session: null });

describe('US-214 — lecture de « Mis viajes »', () => {
  it('relit la liste telle quelle : total en bigint (devise sans décimale), demande puis trip', () => {
    const r = guestTripsOf(ok({ trips: [request, trip] }));
    expect(r?.map((t) => [t.kind, t.id, t.tab])).toEqual([
      ['REQUEST', HOLD, 'REQUESTED'],
      ['TRIP', TRIP, 'UPCOMING'],
    ]);
    expect(r?.[1]?.totalMinor).toBe(1_071_000n);
    expect(r?.[1]?.hostName).toBe('María G.');
    expect(guestTripsOf(ok({ trips: [] }))).toEqual([]);
  });

  it('refuse en bloc une réponse illisible (jamais une liste partielle)', () => {
    for (const bad of [
      { ...trip, totalMinor: 1071000 },
      { ...trip, totalMinor: '10.5' },
      { ...trip, tab: 'PAST' },
      { ...trip, kind: 'HOLD' },
      { ...trip, paymentStatus: null },
      { ...trip, contract: 'MAYBE' },
      { ...trip, startsAt: 'demain' },
      { ...trip, currencyExponent: -1 },
      { ...trip, vehicle: { make: 'Toyota', model: 'Yaris', year: '2022' } },
      { ...request, paymentStatus: 'CONFIRMED' },
      { ...request, contract: 'NONE' },
      { ...request, tab: 'UPCOMING' },
      { ...request, respondBy: 'jamais' },
    ]) {
      expect(guestTripsOf(ok({ trips: [trip, bad] })), JSON.stringify(bad)).toBeNull();
    }
    expect(guestTripsOf({ status: 503, json: {}, session: null })).toBeNull();
    expect(guestTripsOf({ status: 'unavailable' })).toBeNull();
    expect(guestTripsOf(ok({}))).toBeNull();
  });

  it('détail : seulement le trip demandé (jamais une demande, jamais un autre trip)', () => {
    expect(guestTripOf(ok({ trip }), TRIP.toUpperCase())?.id).toBe(TRIP);
    expect(guestTripOf(ok({ trip }), HOLD)).toBeNull();
    expect(guestTripOf(ok({ trip: request }), HOLD)).toBeNull();
    expect(guestTripOf({ status: 404, json: {}, session: null }, TRIP)).toBeNull();
  });

  it('libellés et liens : auto sans plaque, référence, demande vers sa page, remboursement si annulé', () => {
    const [r, t] = guestTripsOf(ok({ trips: [request, trip] })) ?? [];
    expect(t && guestCarLabel(t)).toBe('Toyota Yaris · 2022');
    expect(t && guestTripReference(t)).toBe('K-00000000');
    expect(r && guestTripReference(r)).toBe('00000000');
    expect(t && guestTripHref(t)).toBe(`/trips/${TRIP}`);
    expect(r && guestTripHref(r)).toBe(`/checkout/hold/${HOLD}/payment`);
    expect(t && hasRefund(t)).toBe(false);
    const [cx] =
      guestTripsOf(ok({ trips: [{ ...trip, tab: 'CANCELLED', status: 'CANCELLED_BY_HOST' }] })) ??
      [];
    expect(cx && hasRefund(cx)).toBe(true);
    const [part] =
      guestTripsOf(ok({ trips: [{ ...trip, paymentStatus: 'REFUNDED_PARTIAL' }] })) ?? [];
    expect(part && hasRefund(part)).toBe(true);
  });
});
