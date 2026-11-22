/**
 * Résolution événement → destinataires → canaux (16 NTF-001) et critère 2 d'US-021 : « Given un
 * événement rejoué, When il est reçu, Then aucun doublon par destinataire et canal » (unicité
 * (event_id, destinataire, canal), 17 §3.2.12). Base en mémoire ; preuve sur PostgreSQL réel :
 * test/int/ntf.int.test.ts. USD (PA) et PYG (PY).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PartyFacts } from './catalog.js';
import { RULES, subscribedEventTypes } from './catalog.js';
import {
  dispatchEvent,
  NotificationContractError,
  partyKey,
  planDispatches,
  requiredParties,
} from './dispatcher.js';
import { COUNTRY_CASES, event, MemoryDb, MemoryParties, tripFacts } from './ntf.test-support.js';

const guest = randomUUID();
const host = randomUUID();
const tripId = '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a6f';
const holdId = '7d4b0190-8a1f-4c3e-9b2d-4a6f3c5e0190';

/** Faits d'un trip lus en base (US-213, ADR-157), clés de `partyKey`. */
const tripMap = (facts: PartyFacts | null = tripFacts(guest, host)) =>
  new Map([[partyKey('TRIP', tripId), facts]]);
/** Faits d'un hold (0133 : type, statut, motif, demande autorisée). */
const holdFacts = (over: Partial<PartyFacts> = {}): PartyFacts => ({
  ...tripFacts(guest, host),
  holdKind: 'REQUEST',
  holdStatus: 'AWAITING_HOST',
  releaseReason: null,
  requestAuthorized: true,
  ...over,
});
const holdMap = (facts: PartyFacts | null) => new Map([[partyKey('HOLD', holdId), facts]]);
const who = (plan: ReturnType<typeof planDispatches>) =>
  plan.map((p) => [p.recipientRole, p.recipientUserId, p.channel, p.template]);

describe('abonnement', () => {
  it('le dispatcher écoute les événements canoniques du catalogue (17 §4.5)', () => {
    expect(subscribedEventTypes()).toEqual([
      'booking.hold.released',
      'booking.request.capture_unconfirmed',
      'booking.request.declined',
      'booking.request.expired',
      'booking.request.received',
      'booking.trip.booked',
      'booking.trip.host_restricted',
      'booking.trip.host_restriction_lifted',
      'catalog.addition_request.resolved',
      'deposit.decision.executed',
      'kyc.verification.status_changed',
      'payout.batch.status_changed',
      // US-310 : réponse automatique à une demande d'aide hors plage
      'support.help_request.received',
      // US-305 : trip suivant à risque (prolongation du trip en retard bornée)
      'trip.at_risk.flagged',
      // US-316 : rendez-vous de remise ou de retour accepté (avis aux deux parties)
      'trip.meeting.confirmed',
      // US-307 : signalement du no-show de l'hôte par le voyageur (l'hôte prévenu)
      'trip.no_show.reported',
      'trip.overdue.detected',
      // US-306 : étape d'escalade de non-restitution (gabarit de l'étape remis à l'hôte)
      'trip.overdue.escalated',
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

  it('réservation confirmée : voyageur et hôte (un texte par rôle), e-mail (documents), référence courte du trip (8 premiers chiffres, comme les écrans)', () => {
    const plan = planDispatches(booked(), RULES, tripMap());
    expect(who(plan)).toEqual([
      ['GUEST', guest, 'EMAIL', 'EVT_BOOKING_CONFIRMED'],
      ['HOST', host, 'EMAIL', 'EVT_BOOKING_CONFIRMED_HOST'],
    ]);
    for (const p of plan) {
      expect(p.variables).toEqual({
        booking_ref: '0190F5A2',
        start_at: '2026-12-24T14:00:00Z',
        end_at: '2026-12-27T10:00:00Z',
      });
    }
  });

  it('US-306 : étape d’escalade de non-restitution (`trip.overdue.escalated`, 0173) ⇒ l’hôte seul, le gabarit de l’étape (e-mail d’abord) ; référence du trip et fin prévue seulement ; étape inconnue : aucun envoi', () => {
    const escalated = (stage: string) =>
      event(
        'trip.overdue.escalated',
        {
          trip_id: tripId,
          stage,
          host_user_id: host,
          documents: ['DEMAND_LETTER', 'GPS_REQUEST'],
          scheduled_end: '2026-12-27T10:00:00+00:00',
          escalated_at: '2026-12-27T16:00:00+00:00',
        },
        c.country,
      );
    for (const [stage, template] of [
      ['T2H', 'EVT_UNRETURNED_CONTACT'],
      ['T6H', 'EVT_UNRETURNED_FORMAL_NOTICE'],
      ['T24H', 'EVT_UNRETURNED_POLICE_REPORT'],
    ] as const) {
      const plan = planDispatches(escalated(stage), RULES, tripMap());
      expect(who(plan), stage).toEqual([['HOST', host, 'EMAIL', template]]);
      expect(plan[0]?.variables).toEqual({
        booking_ref: '0190F5A2',
        end_at: '2026-12-27T10:00:00+00:00',
      });
    }
    expect(planDispatches(escalated('T30M'), RULES, tripMap())).toEqual([]);
  });

  it('US-213 : charge utile réelle de `booking.trip.booked` (0126, sans identifiant de personne) ⇒ parties lues en base, titulaire du compte d’hôte', () => {
    // 0126 : trip_id, hold_id, vehicle_id, org_id, scheduled_start, scheduled_end
    const real = event(
      'booking.trip.booked',
      {
        trip_id: tripId,
        hold_id: holdId,
        vehicle_id: randomUUID(),
        org_id: randomUUID(),
        scheduled_start: '2026-12-24T14:00:00.000000+00:00',
        scheduled_end: '2026-12-27T10:00:00.000000+00:00',
      },
      c.country,
    );
    expect(requiredParties(real)).toEqual([{ subject: 'TRIP', id: tripId }]);
    expect(who(planDispatches(real, RULES, tripMap()))).toEqual([
      ['GUEST', guest, 'EMAIL', 'EVT_BOOKING_CONFIRMED'],
      ['HOST', host, 'EMAIL', 'EVT_BOOKING_CONFIRMED_HOST'],
    ]);
    // trip inconnu de la base, ou faits non lus (port absent) : erreur de contrat, aucun envoi
    expect(() => planDispatches(real, RULES, tripMap(null))).toThrow(NotificationContractError);
    expect(() => planDispatches(real)).toThrow(NotificationContractError);
  });

  it('US-702 / US-702b : décision de la caution exécutée ⇒ le voyageur du trip (base) ; avis choisi par `notice` de la base : libérée en entier, frais annoncés capturés, ou bloquée jusqu’à l’expiration (VOID refusé, 08 E3 repli 4) ; montants dans la devise du pays', () => {
    // 0150 : deposit_id, trip_id, status, captured_minor, released_minor, currency, decided_at ;
    // 0153 : notice, auth_expiry_at
    const decided = (
      status: string,
      notice: string,
      captured: string,
      released: string,
      authExpiryAt: string | null = '2031-07-16T10:00:00+00:00',
    ) =>
      event(
        'deposit.decision.executed',
        {
          deposit_id: randomUUID(),
          trip_id: tripId,
          status,
          captured_minor: captured,
          released_minor: released,
          currency: c.currency,
          decided_at: '2031-07-16T08:00:00+00:00',
          notice,
          auth_expiry_at: authExpiryAt,
        },
        c.country,
      );
    for (const [status, expiry] of [
      ['VOIDED', '2031-07-16T10:00:00+00:00'],
      ['EXPIRED', '2031-07-16T08:00:00+00:00'],
      ['REFUNDED', null],
    ] as const) {
      const plan = planDispatches(
        decided(status, 'RELEASED', '0', '1500000', expiry),
        RULES,
        tripMap(),
      );
      expect(who(plan)).toEqual([['GUEST', guest, 'EMAIL', 'EVT_DEPOSIT_RELEASED']]);
      expect(plan[0]?.variables).toEqual({
        booking_ref: '0190F5A2',
        amount: { amount_minor: '1500000', currency: c.currency },
      });
    }
    const partial = planDispatches(
      decided('PARTIALLY_CAPTURED', 'PARTIALLY_CAPTURED', '1200', '28800'),
      RULES,
      tripMap(),
    );
    expect(who(partial)).toEqual([['GUEST', guest, 'EMAIL', 'EVT_DEPOSIT_PARTIALLY_CAPTURED']]);
    expect(partial[0]?.variables).toEqual({
      booking_ref: '0190F5A2',
      amount: { amount_minor: '28800', currency: c.currency },
      captured: { amount_minor: '1200', currency: c.currency },
    });
    // VOID refusé : jamais « libérée » ; montant bloqué et date d'expiration de l'autorisation
    const blocked = planDispatches(
      decided('EXPIRED', 'BLOCKED_UNTIL_EXPIRY', '0', '1500000'),
      RULES,
      tripMap(),
    );
    expect(who(blocked)).toEqual([['GUEST', guest, 'EMAIL', 'EVT_DEPOSIT_BLOCKED_UNTIL_EXPIRY']]);
    expect(blocked[0]?.variables).toEqual({
      booking_ref: '0190F5A2',
      amount: { amount_minor: '1500000', currency: c.currency },
      expires_at: '2031-07-16T10:00:00+00:00',
    });
    // date d'expiration absente : erreur de contrat (jamais un avis sans date)
    expect(() =>
      planDispatches(
        decided('EXPIRED', 'BLOCKED_UNTIL_EXPIRY', '0', '1500000', null),
        RULES,
        tripMap(),
      ),
    ).toThrow(NotificationContractError);
    // avis absent (statut seul) : erreur de contrat (jamais un avis deviné)
    const bad = event(
      'deposit.decision.executed',
      { trip_id: tripId, status: 'VOIDED' },
      c.country,
    );
    expect(() => planDispatches(bad, RULES, tripMap())).toThrow(NotificationContractError);
  });

  it('US-213 : charge utile et base en désaccord sur une personne ⇒ erreur de contrat (jamais un mélange)', () => {
    const other = randomUUID();
    expect(() => planDispatches(booked(), RULES, tripMap(tripFacts(other, host)))).toThrow(
      NotificationContractError,
    );
    expect(() => planDispatches(booked(), RULES, tripMap(tripFacts(guest, other)))).toThrow(
      NotificationContractError,
    );
  });

  it('US-213 : demande reçue ⇒ l’hôte (titulaire), heure limite de la base ; refus et expiration ⇒ le voyageur ; capture non confirmée ⇒ les deux', () => {
    const respondBy = '2026-12-20T18:00:00.000000+00:00';
    const base = { hold_id: holdId, vehicle_id: randomUUID(), org_id: randomUUID() };
    const received = planDispatches(
      event('booking.request.received', { ...base, request_respond_by: respondBy }, c.country),
      RULES,
      holdMap(holdFacts()),
    );
    expect(who(received)).toEqual([['HOST', host, 'EMAIL', 'EVT_BOOKING_REQUEST_RECEIVED']]);
    // référence de la demande : celle de S06, S07 et A05 (8 premiers chiffres du hold)
    expect(received[0]?.variables).toEqual({ booking_ref: '7D4B0190', respond_by: respondBy });
    // heure limite absente : erreur de contrat
    expect(() =>
      planDispatches(
        event('booking.request.received', base, c.country),
        RULES,
        holdMap(holdFacts()),
      ),
    ).toThrow(NotificationContractError);
    const plan = (type: string, facts: PartyFacts) =>
      who(
        planDispatches(event(type, { ...base, decision: 'X' }, c.country), RULES, holdMap(facts)),
      );
    expect(plan('booking.request.declined', holdFacts({ holdStatus: 'RELEASED' }))).toEqual([
      ['GUEST', guest, 'EMAIL', 'EVT_BOOKING_REQUEST_DECLINED'],
    ]);
    expect(plan('booking.request.expired', holdFacts({ holdStatus: 'EXPIRED' }))).toEqual([
      ['GUEST', guest, 'EMAIL', 'EVT_BOOKING_REQUEST_EXPIRED'],
    ]);
    expect(
      plan(
        'booking.request.capture_unconfirmed',
        holdFacts({ holdStatus: 'RELEASED', releaseReason: 'CAPTURE_UNCONFIRMED' }),
      ),
    ).toEqual([
      ['GUEST', guest, 'EMAIL', 'EVT_BOOKING_REQUEST_FAILED'],
      ['HOST', host, 'EMAIL', 'EVT_BOOKING_REQUEST_FAILED_HOST'],
    ]);
    // l'acceptation n'a pas de message propre : la confirmation suit au passage BOOKED
    expect(
      planDispatches(
        event('booking.request.accepted', base, c.country),
        RULES,
        holdMap(holdFacts()),
      ),
    ).toEqual([]);
  });

  it('US-213 (N-247) : `booking.hold.released` ⇒ voyageur et hôte prévenus SEULEMENT pour la capture refusée d’une demande acceptée (faits lus en base)', () => {
    const released = event(
      'booking.hold.released',
      {
        hold_id: holdId,
        vehicle_id: randomUUID(),
        org_id: randomUUID(),
        reason: 'PAYMENT_DECLINED',
      },
      c.country,
    );
    const declined = holdFacts({ holdStatus: 'RELEASED', releaseReason: 'PAYMENT_DECLINED' });
    expect(who(planDispatches(released, RULES, holdMap(declined)))).toEqual([
      ['GUEST', guest, 'EMAIL', 'EVT_BOOKING_REQUEST_FAILED'],
      ['HOST', host, 'EMAIL', 'EVT_BOOKING_REQUEST_FAILED_HOST'],
    ]);
    for (const facts of [
      { ...declined, holdKind: 'CHECKOUT' },
      { ...declined, requestAuthorized: false },
      { ...declined, releaseReason: 'GUEST_RELEASED' },
      { ...declined, holdStatus: 'EXPIRED' },
    ]) {
      expect(planDispatches(released, RULES, holdMap(facts))).toEqual([]);
    }
    // charge utile d'une libération par le voyageur (0037 : sans motif) : aucune erreur de contrat
    const plain = event(
      'booking.hold.released',
      { hold_id: holdId, vehicle_id: randomUUID() },
      c.country,
    );
    expect(planDispatches(plain, RULES, holdMap(holdFacts({ holdKind: 'CHECKOUT' })))).toEqual([]);
    // hold absent de la charge utile : erreur de contrat
    expect(() => requiredParties(event('booking.hold.released', {}, c.country))).toThrow(
      NotificationContractError,
    );
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
      planDispatches(event('catalog.addition_request.resolved', { ...payload, status }, c.country));
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

  it('hôte restreint (US-122, ADR-124) : le voyageur du trip à venir est prévenu, l’hôte jamais ; voyageur absent : erreur de contrat', () => {
    const payload = { trip_id: tripId, guest_user_id: guest, org_id: tripId };
    expect(
      planDispatches(event('booking.trip.host_restricted', payload, c.country)).map((p) => [
        p.recipientRole,
        p.recipientUserId,
        p.channel,
        p.template,
      ]),
    ).toEqual([['GUEST', guest, 'EMAIL', 'EVT_TRIP_HOST_RESTRICTED']]);
    expect(() =>
      planDispatches(
        event('booking.trip.host_restricted', { trip_id: tripId, org_id: tripId }, c.country),
      ),
    ).toThrow(NotificationContractError);
  });

  it('restriction de l’hôte levée (US-215c, ADR-156) : le voyageur du trip à venir est prévenu, l’hôte jamais ; voyageur absent : erreur de contrat', () => {
    const payload = { trip_id: tripId, guest_user_id: guest, org_id: tripId };
    expect(
      planDispatches(event('booking.trip.host_restriction_lifted', payload, c.country)).map((p) => [
        p.recipientRole,
        p.recipientUserId,
        p.channel,
        p.template,
      ]),
    ).toEqual([['GUEST', guest, 'EMAIL', 'EVT_TRIP_HOST_RESTRICTION_LIFTED']]);
    expect(() =>
      planDispatches(
        event(
          'booking.trip.host_restriction_lifted',
          { trip_id: tripId, org_id: tripId },
          c.country,
        ),
      ),
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
    // charge utile de 0124 : trip_id, from, to, reason, settlement_id (parties lues en base)
    const changed = (to: string) =>
      event(
        'trip.status_changed',
        { trip_id: tripId, from: 'BOOKED', to, reason: 'X', settlement_id: null },
        c.country,
      );
    const trip = (to: string) => planDispatches(changed(to), RULES, tripMap());
    expect(who(trip('CANCELLED_BY_HOST'))).toEqual([
      ['GUEST', guest, 'EMAIL', 'EVT_BOOKING_CANCELLED'],
      ['HOST', host, 'EMAIL', 'EVT_BOOKING_CANCELLED'],
    ]);
    expect(trip('IN_PROGRESS')).toEqual([]);
    // statut non déclenchant : aucune lecture en base
    expect(requiredParties(changed('IN_PROGRESS'))).toEqual([]);
    expect(requiredParties(changed('CANCELLED_BY_GUEST'))).toEqual([
      { subject: 'TRIP', id: tripId },
    ]);
    const kyc = (to: string) =>
      planDispatches(event('kyc.verification.status_changed', { user_id: guest, to }, null));
    expect(kyc('APPROVED').map((p) => [p.recipientRole, p.channel])).toEqual([['GUEST', 'EMAIL']]);
    expect(kyc('REJECTED')).toEqual([]);
  });

  it('contrat de charge utile violé : erreur (lettre morte et alerte), aucun envoi partiel', () => {
    const bad = [
      // US-213 : le voyageur et l’hôte viennent de la base ; ici, c’est le trip qui manque
      {
        host_user_id: host,
        scheduled_start: '2026-12-24T14:00:00Z',
        scheduled_end: '2026-12-27T10:00:00Z',
      },
      // date de fin absente
      { trip_id: tripId, scheduled_start: '2026-12-24T14:00:00Z' },
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
      expect(() =>
        planDispatches(event('booking.trip.booked', payload, c.country), RULES, tripMap()),
      ).toThrow(NotificationContractError);
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
    const parties = new MemoryParties().set('TRIP', tripId, tripFacts(guest, host));
    const e = booked();
    const first = await dispatchEvent(e, db, RULES, parties);
    const replay = await dispatchEvent(e, db, RULES, parties);
    expect(first).toHaveLength(2);
    expect(replay).toEqual([]);
    expect(db.dispatches).toHaveLength(2);
    expect(db.pendingSends()).toHaveLength(2);
    // une lecture des parties par traitement (les deux règles partagent le même trip)
    expect(parties.calls).toEqual([partyKey('TRIP', tripId), partyKey('TRIP', tripId)]);
    // un autre événement de même contenu est un autre fait : nouveaux envois
    expect(await dispatchEvent({ ...e, eventId: randomUUID() }, db, RULES, parties)).toHaveLength(
      2,
    );
  });

  it('US-213 : port des parties absent ou sujet inconnu ⇒ erreur de contrat, aucun envoi créé', async () => {
    const db = new MemoryDb();
    await expect(dispatchEvent(booked(), db)).rejects.toThrow(NotificationContractError);
    await expect(dispatchEvent(booked(), db, RULES, new MemoryParties())).rejects.toThrow(
      NotificationContractError,
    );
    expect(db.dispatches).toEqual([]);
    expect(db.pendingSends()).toEqual([]);
  });
});
