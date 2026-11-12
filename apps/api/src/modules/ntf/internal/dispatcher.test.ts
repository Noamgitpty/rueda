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
      'catalog.addition_request.resolved',
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

  it('versement : charge utile conforme à 17 §4.5 (`batch_id`, `status`, `net_minor`) + extensions NTF', () => {
    // 17 §4.5 : `batch_id`, `status`, `net_minor` ; extensions NTF (ADR-061) : `host_user_id`
    // (titulaire du compte d'hôte, dérivé de `org_id` par PYO) et `currency`
    const payload = {
      batch_id: randomUUID(),
      net_minor: c.amountMinor,
      host_user_id: host,
      currency: c.currency,
    };
    const plan = (status: string) =>
      planDispatches(event('payout.batch.status_changed', { ...payload, status }, c.country));
    expect(plan('INITIATED').map((p) => p.template)).toEqual(['EVT_PAYOUT_SENT']);
    expect(plan('ON_HOLD').map((p) => p.template)).toEqual(['EVT_PAYOUT_ON_HOLD']);
    expect(plan('NETTING')).toEqual([]);
    expect(plan('INITIATED')[0]?.variables).toEqual({
      amount: { amount_minor: c.amountMinor, currency: c.currency },
    });
  });

  it('demande d’ajout au catalogue tranchée (US-114) : l’hôte demandeur est notifié, e-mail d’abord ; APPROVED et MERGED ⇒ ajout, REJECTED ⇒ refus', () => {
    // 17 §4.5 : `request_id`, `status`, `resolved_variant_id` ; extension NTF : `host_user_id`
    const payload = {
      request_id: randomUUID(),
      resolved_variant_id: randomUUID(),
      host_user_id: host,
    };
    const plan = (status: string) =>
      planDispatches(
        event('catalog.addition_request.resolved', { ...payload, status }, c.country),
      );
    for (const status of ['APPROVED', 'MERGED']) {
      expect(
        plan(status).map((p) => [p.recipientRole, p.recipientUserId, p.channel, p.template]),
      ).toEqual([['HOST', host, 'EMAIL', 'EVT_CATALOG_ADDITION_APPROVED']]);
    }
    expect(plan('REJECTED').map((p) => p.template)).toEqual(['EVT_CATALOG_ADDITION_REJECTED']);
    expect(plan('OPEN')).toEqual([]);
    expect(() =>
      planDispatches(event('catalog.addition_request.resolved', payload, c.country)),
    ).toThrow(NotificationContractError);
  });

  it('champ de statut absent (ex. `to` au lieu de `status`) : erreur de contrat, jamais ignoré en silence', () => {
    const base = { host_user_id: host, net_minor: c.amountMinor, currency: c.currency };
    for (const payload of [{ ...base, to: 'INITIATED' }, base, { ...base, status: 1 }]) {
      expect(() =>
        planDispatches(event('payout.batch.status_changed', payload, c.country)),
      ).toThrow(NotificationContractError);
    }
    for (const type of ['trip.status_changed', 'kyc.verification.status_changed']) {
      expect(() =>
        planDispatches(event(type, { user_id: guest, guest_user_id: guest, status: 'X' }, null)),
      ).toThrow(NotificationContractError);
    }
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
          { host_user_id: host, status: 'INITIATED', net_minor: '1.5', currency: c.currency },
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
