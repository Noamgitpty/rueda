/**
 * US-224 partie 224d — lecture défensive de `GET /trips/{id}/refunds` et états montrés à la personne.
 * Attendus : 08 SM-8 (états), BR-PAY-08 (date d'émission), 19 US-224 critère 1 (hôte : jambe HOST
 * seulement) ; jamais le code testé.
 */
import { describe, expect, it } from 'vitest';
import { phaseOf, REFUND_STATUSES, tripRefundsOf } from './trip-refunds.ts';

const TRIP = '00000000-0000-4000-8000-0000000224d1';
const guest = {
  tripId: TRIP,
  viewerRole: 'GUEST',
  tripStatus: 'CANCELLED_BY_GUEST',
  currency: 'XTS',
  currencyExponent: 2,
  timezone: 'Etc/UTC',
  refunds: [
    {
      status: 'SENT',
      amountMinor: '18744',
      rail: 'NATIVE_PARTIAL',
      plannedAt: '2034-03-07T10:00:00.000Z',
      issuedAt: '2034-03-07T10:00:10.123Z',
    },
  ],
};
const host = {
  ...guest,
  viewerRole: 'HOST',
  refunds: [
    {
      status: 'PLANNED',
      hostLegMinor: '8625',
      plannedAt: '2034-03-07T10:00:00.000Z',
      issuedAt: null,
    },
  ],
};
const ok = (json: unknown) => ({ status: 200, json, session: null });

describe('tripRefundsOf', () => {
  it('voyageur et hôte : la vue rendue telle quelle', () => {
    expect(tripRefundsOf(ok(guest))).toEqual(guest);
    expect(tripRefundsOf(ok(host))).toEqual(host);
  });

  it('toute forme inattendue ⇒ null (jamais un remboursement partiel ou deviné)', () => {
    const item = guest.refunds[0]!;
    for (const bad of [
      { ...guest, viewerRole: 'STAFF' },
      { ...guest, tripId: 'x' },
      { ...guest, currency: 'xts' },
      { ...guest, currencyExponent: 7 },
      { ...guest, timezone: 'UTC; x' },
      { ...guest, refunds: 'x' },
      { ...guest, refunds: [{ ...item, amountMinor: '1.5' }] },
      { ...guest, refunds: [{ ...item, amountMinor: '-1' }] },
      { ...guest, refunds: [{ ...item, rail: 'AGENCY' }] },
      { ...guest, refunds: [{ ...item, status: 'DONE' }] },
      { ...guest, refunds: [{ ...item, issuedAt: '2034-03-07' }] },
      { ...host, refunds: [{ ...host.refunds[0], hostLegMinor: 8625 }] },
      // vue de l'hôte avec un montant du voyageur : pas la forme de l'hôte
      { ...host, refunds: [item] },
    ]) {
      expect(tripRefundsOf(ok(bad)), JSON.stringify(bad)).toBeNull();
    }
    expect(
      tripRefundsOf({ status: 404, json: { code: 'REFUND_NOT_FOUND' }, session: null }),
    ).toBeNull();
    expect(tripRefundsOf({ status: 'unavailable' })).toBeNull();
  });

  it('états SM-8 regroupés pour la personne ; remplacé ou annulé ⇒ non montré', () => {
    expect(Object.fromEntries(REFUND_STATUSES.map((s) => [s, phaseOf(s)]))).toEqual({
      PLANNED: 'PREPARING',
      BLOCKED_CHARGEBACK: 'ATTENTION',
      // US-224f (ADR-166) : en bêta, attente d'un autre moyen après un rejet confirmé
      PENDING_CUSTOMER_CHOICE: 'ATTENTION',
      PENDING_BANK_DETAILS: 'PREPARING',
      SUBMITTED: 'ISSUED',
      SENT: 'ISSUED',
      CONFIRMED: 'CONFIRMED',
      FAILED: 'ATTENTION',
      CREDITED: 'ISSUED',
      CANCELLED: null,
      SUPERSEDED: null,
    });
  });
});
