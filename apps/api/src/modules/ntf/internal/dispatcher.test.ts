/**
 * Résolution événement → destinataires → canaux (16 NTF-001) et critère 2 d'US-021 : « Given un
 * événement rejoué, When il est reçu, Then aucun doublon par destinataire et canal » (unicité
 * (event_id, destinataire, canal), 17 §3.2.12). Base en mémoire ; preuve sur PostgreSQL réel :
 * test/int/ntf.int.test.ts. USD (PA) et PYG (PY).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { subscribedEventTypes } from './catalog.js';
import { dispatchEvent, NotificationContractError, planDispatches } from './dispatcher.js';
import { COUNTRY_CASES, event, MemoryDb } from './ntf.test-support.js';

const guest = randomUUID();
const host = randomUUID();
const tripId = '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a6f';

describe('abonnement', () => {
  it('le dispatcher écoute les événements canoniques du catalogue (17 §4.5)', () => {
    expect(subscribedEventTypes()).toEqual([
      'booking.trip.booked',
      'kyc.verification.status_changed',
      'payout.batch.status_changed',
      'trip.overdue.detected',
      'trip.status_changed',
    ]);
  });
});

describe.each(COUNTRY_CASES)('planDispatches — $country ($currency)', (c) => {
  const booked = () =>
    event(
      'booking.trip.booked',
      {
        trip_id: tripId,
        guest_user_id: guest,
        host_user_id: host,
        scheduled_start: '2026-12-24T14:00:00Z',
        scheduled_end: '2026-12-27T10:00:00Z',
        currency: c.currency,
      },
      c.country,
    );

  it('réservation confirmée : voyageur et hôte, e-mail (documents), référence courte', () => {
    const plan = planDispatches(booked());
    expect(plan.map((p) => [p.recipientRole, p.recipientUserId, p.channel, p.template])).toEqual([
      ['GUEST', guest, 'EMAIL', 'EVT_BOOKING_CONFIRMED'],
      ['HOST', host, 'EMAIL', 'EVT_BOOKING_CONFIRMED'],
    ]);
    expect(plan[0]?.variables).toEqual({
      booking_ref: '9B2D4A6F',
      start_at: '2026-12-24T14:00:00Z',
      end_at: '2026-12-27T10:00:00Z',
    });
  });

  it('retard détecté : SMS d’abord (urgent, 10b §3.9)', () => {
    const plan = planDispatches(
      event(
        'trip.overdue.detected',
        {
          trip_id: tripId,
          guest_user_id: guest,
          host_user_id: host,
          scheduled_end: '2026-12-27T10:00:00Z',
        },
        c.country,
      ),
    );
    expect(plan.map((p) => p.channel)).toEqual(['SMS', 'SMS']);
  });

  it('versement : montant en unités mineures (chaîne) et devise, sans conversion', () => {
    const payload = { host_user_id: host, net_minor: c.amountMinor, currency: c.currency };
    const sent = planDispatches(
      event('payout.batch.status_changed', { ...payload, to: 'INITIATED' }, c.country),
    );
    const held = planDispatches(
      event('payout.batch.status_changed', { ...payload, to: 'ON_HOLD' }, c.country),
    );
    const other = planDispatches(
      event('payout.batch.status_changed', { ...payload, to: 'NETTING' }, c.country),
    );
    expect(sent.map((p) => p.template)).toEqual(['EVT_PAYOUT_SENT']);
    expect(held.map((p) => p.template)).toEqual(['EVT_PAYOUT_ON_HOLD']);
    expect(other).toEqual([]);
    expect(sent[0]?.variables).toEqual({
      amount: { amount_minor: c.amountMinor, currency: c.currency },
    });
  });

  it('annulation : seulement vers un statut CANCELLED_* ; KYC : seulement APPROVED', () => {
    const trip = (to: string) =>
      planDispatches(
        event(
          'trip.status_changed',
          { trip_id: tripId, guest_user_id: guest, host_user_id: host, to },
          c.country,
        ),
      );
    expect(trip('CANCELLED_BY_HOST').map((p) => p.template)).toEqual([
      'EVT_BOOKING_CANCELLED',
      'EVT_BOOKING_CANCELLED',
    ]);
    expect(trip('IN_PROGRESS')).toEqual([]);
    const kyc = (to: string) =>
      planDispatches(event('kyc.verification.status_changed', { user_id: guest, to }, null));
    expect(kyc('APPROVED').map((p) => [p.recipientRole, p.channel])).toEqual([['GUEST', 'EMAIL']]);
    expect(kyc('REJECTED')).toEqual([]);
  });

  it('contrat de charge utile violé : erreur (lettre morte et alerte), aucun envoi partiel', () => {
    const bad = [
      {
        trip_id: tripId,
        host_user_id: host,
        scheduled_start: '2026-12-24T14:00:00Z',
        scheduled_end: '2026-12-27T10:00:00Z',
      },
      {
        trip_id: 'pas-un-uuid',
        guest_user_id: guest,
        host_user_id: host,
        scheduled_start: '2026-12-24T14:00:00Z',
        scheduled_end: '2026-12-27T10:00:00Z',
      },
      {
        trip_id: tripId,
        guest_user_id: guest,
        host_user_id: host,
        scheduled_start: '24/12/2026',
        scheduled_end: '2026-12-27T10:00:00Z',
      },
    ];
    for (const payload of bad) {
      expect(() => planDispatches(event('booking.trip.booked', payload, c.country))).toThrow(
        NotificationContractError,
      );
    }
    expect(() =>
      planDispatches(
        event(
          'payout.batch.status_changed',
          { host_user_id: host, to: 'INITIATED', net_minor: '1.5', currency: c.currency },
          c.country,
        ),
      ),
    ).toThrow(NotificationContractError);
  });

  it('critère 2 : événement rejoué ⇒ aucun doublon par destinataire et canal, une seule tâche d’envoi', async () => {
    const db = new MemoryDb();
    const e = booked();
    const first = await dispatchEvent(e, db);
    const replay = await dispatchEvent(e, db);
    expect(first).toHaveLength(2);
    expect(replay).toEqual([]);
    expect(db.dispatches).toHaveLength(2);
    expect(db.pendingSends()).toHaveLength(2);
    // un autre événement de même contenu est un autre fait : nouveaux envois
    expect(await dispatchEvent({ ...e, eventId: randomUUID() }, db)).toHaveLength(2);
  });
});
