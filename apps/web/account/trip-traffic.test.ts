/**
 * Suite d'US-318 (0181, ADR-201) — lecture défensive des refacturations vues par le voyageur, textes
 * des états (voyageur et hôte), liens. Attendus : contrat de `GET /trips/{id}/traffic-charges`
 * (montants en chaînes d'unités mineures, heures ISO) et 08 BR-TT-02 (48 h pour payer ou
 * contester ; aucun débit avant), jamais le code testé.
 */
import { describe, expect, it } from 'vitest';
import type { ApiResult } from './api-client.ts';
import {
  slotGroupOf,
  trafficDoneOf,
  trafficFailureKey,
  trafficGuestHref,
  trafficGuestOf,
  trafficGuestStatusKey,
  trafficHostAnswerKey,
  trafficOffered,
} from './trip-traffic.ts';

const TRIP = '3180a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b';
const ID = '3180a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5c';
const FILE = '3180a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5d';
const DUE = '2057-04-13T10:00:00.000Z';
const ok = (json: unknown, status = 200): ApiResult => ({ status, json }) as ApiResult;

const charge = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  kind: 'FINE',
  occurredAt: '2057-04-08T10:00:00.000Z',
  reference: 'PV-2057/0042',
  amountMinor: '1230',
  adminFeeMinor: '62',
  totalMinor: '1292',
  declaredAt: '2057-04-11T10:00:00.000Z',
  responseDueAt: DUE,
  status: 'AWAITING_GUEST',
  executionStatus: 'PENDING',
  canRespond: true,
  disputeReason: null,
  decidedAt: null,
  decisionRationale: null,
  ...extra,
});
const view = (extra: Record<string, unknown> = {}) => ({
  tripId: TRIP,
  currency: 'XTS',
  charges: [charge()],
  photos: [
    {
      fileId: FILE,
      kind: 'CHECKOUT',
      slot: 'EXT_01',
      takenBy: 'GUEST',
      receivedAt: '2057-04-10T10:00:00.000Z',
    },
  ],
  ...extra,
});

describe('suite d’US-318 — refacturations vues par le voyageur', () => {
  it('vue lue en entier, montants en chaînes', () => {
    const v = trafficGuestOf(ok(view()), TRIP);
    expect(v?.charges[0]).toMatchObject({ totalMinor: '1292', reference: 'PV-2057/0042' });
    expect(v?.charges[0]?.canRespond).toBe(true);
    expect(v?.photos[0]?.slot).toBe('EXT_01');
  });

  it('forme inattendue ⇒ null (jamais une vue partielle)', () => {
    expect(trafficGuestOf(ok(view()), ID)).toBeNull();
    expect(trafficGuestOf(ok(view(), 404), TRIP)).toBeNull();
    for (const bad of [
      { totalMinor: 1292 },
      { amountMinor: '12.30' },
      { reference: null },
      { reference: '#42' },
      { status: 'PAID' },
      { executionStatus: 'LOST' },
      { canRespond: 'yes' },
      { responseDueAt: 'demain' },
      { decidedAt: 'x' },
    ]) {
      expect(
        trafficGuestOf(ok(view({ charges: [charge(bad)] })), TRIP),
        JSON.stringify(bad),
      ).toBeNull();
    }
    expect(
      trafficGuestOf(
        ok(view({ photos: [{ fileId: 'x', kind: 'CHECKOUT', slot: 'EXT_01' }] })),
        TRIP,
      ),
    ).toBeNull();
  });

  it('une réponse n’est proposée que pour une refacturation en attente', () => {
    const v = trafficGuestOf(ok(view({ charges: [charge({ status: 'DISPUTED' })] })), TRIP);
    expect(v?.charges[0]?.canRespond).toBe(false);
  });

  it('état pour le voyageur : avant l’échéance « réponds avant », après : ce qui va se passer', () => {
    const c = trafficGuestOf(ok(view()), TRIP)!.charges[0]!;
    const before = Date.parse(DUE) - 1;
    const after = Date.parse(DUE);
    expect(trafficGuestStatusKey(c, before)).toBe('web.trafficGuest.due');
    expect(trafficGuestStatusKey(c, after)).toBe('web.trafficGuest.status.EXPIRED');
    expect(trafficGuestStatusKey({ ...c, status: 'ACCEPTED', canRespond: false }, before)).toBe(
      'web.trafficGuest.status.ACCEPTED',
    );
    expect(trafficGuestStatusKey({ ...c, status: 'REJECTED', canRespond: false }, before)).toBe(
      'web.trafficGuest.status.REJECTED',
    );
  });

  it('réponse vue par l’hôte : en attente, sans réponse, payée, contestée, décidée, rejetée', () => {
    const before = Date.parse(DUE) - 1;
    const at = { responseDueAt: DUE };
    expect(trafficHostAnswerKey({ ...at, guestStatus: 'AWAITING_GUEST' }, before)).toBe(
      'web.traffic.guest.AWAITING_GUEST',
    );
    expect(trafficHostAnswerKey({ ...at, guestStatus: 'AWAITING_GUEST' }, Date.parse(DUE))).toBe(
      'web.traffic.guest.expired',
    );
    expect(trafficHostAnswerKey({ ...at, guestStatus: 'ACCEPTED' }, before)).toBe(
      'web.traffic.guest.ACCEPTED',
    );
    expect(trafficHostAnswerKey({ ...at, guestStatus: 'DISPUTED' }, before)).toBe(
      'web.traffic.guest.DISPUTED',
    );
    expect(trafficHostAnswerKey({ ...at, guestStatus: 'DECIDED_CHARGE' }, before)).toBe(
      'web.traffic.guest.DECIDED_CHARGE',
    );
    expect(trafficHostAnswerKey({ ...at, guestStatus: 'REJECTED' }, before)).toBe(
      'web.traffic.guest.REJECTED',
    );
    expect(trafficHostAnswerKey({ responseDueAt: null, guestStatus: null }, before)).toBeNull();
  });

  it('emplacement de photo : groupe connu, sinon « autre photo »', () => {
    expect(slotGroupOf('EXT_03')).toBe('EXTERIOR');
    expect(slotGroupOf('INT_01')).toBe('INTERIOR');
    expect(slotGroupOf('DAMAGE_10')).toBe('DAMAGE');
    expect(slotGroupOf('ODOMETER')).toBe('ODOMETER');
    expect(slotGroupOf('ROOF_01')).toBeNull();
  });

  it('lien reconstruit, résultat lu dans une liste fermée, états du trip proposés', () => {
    expect(trafficGuestHref(TRIP)).toBe(`/trips/${TRIP}/traffic-charges`);
    expect(trafficGuestHref(TRIP, 'accepted')).toBe(`/trips/${TRIP}/traffic-charges?done=accepted`);
    expect(trafficDoneOf('disputed')).toBe('disputed');
    expect(trafficDoneOf('https://x')).toBeNull();
    expect(trafficOffered('COMPLETED')).toBe(true);
    expect(trafficOffered('IN_PROGRESS')).toBe(false);
  });

  it('refus : clé du catalogue renvoyée par l’API ; sans réseau : indisponible', () => {
    expect(trafficFailureKey({ status: 'unavailable' } as ApiResult)).toBe(
      'common.tripClaims.unavailable',
    );
    expect(
      trafficFailureKey(
        ok({ code: 'TRAFFIC_NOT_OPEN', messageKey: 'common.tripClaims.trafficNotOpen' }, 409),
      ),
    ).toBe('common.tripClaims.trafficNotOpen');
    expect(trafficFailureKey(ok({ messageKey: 'x.inconnue' }, 409))).toBe('common.error.server');
  });
});
