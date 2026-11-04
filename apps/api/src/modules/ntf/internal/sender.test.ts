/**
 * Envoi, réessais, idempotence et repli (US-021 ; 17 §2.13 « repli automatique après échec ;
 * idempotence ; 3 réessais ; journal » ; critère 3 : « Given un échec d'envoi, When il est remonté,
 * Then repli sur l'autre canal et notification.fallback.triggered »). FAKE e-mail et SMS d'US-020 ;
 * base en mémoire (preuve PostgreSQL : test/int/ntf.int.test.ts). USD (PA) et PYG (PY).
 *
 * Journaux : aucune adresse, aucun numéro, aucun prénom, aucun texte de message (17 §6.3, C2).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { formatDateTime, getProfile } from '@rueda/i18n';
import { createDispatch, dispatchEvent } from './dispatcher.js';
import type { MemoryDb as MemoryDbType } from './ntf.test-support.js';
import {
  COUNTRY_CASES,
  COUNTRY_DATA,
  event,
  LOCALE_CONFIG,
  MemoryDb,
  senderHarness,
} from './ntf.test-support.js';
import { MAX_SEND_ATTEMPTS, NotificationSender, RETRY_BASE_SECONDS } from './sender.js';

const START = '2026-12-24T14:00:00Z';
const END = '2026-12-27T10:00:00Z';

/** Exécute les tâches `ntf_sender` en attente jusqu'à épuisement (les délais sont ignorés). */
async function drain(db: MemoryDbType, sender: NotificationSender): Promise<number> {
  let runs = 0;
  for (let jobs = db.pendingSends(); jobs.length > 0; jobs = db.pendingSends()) {
    for (const job of jobs) {
      db.markDone(job);
      await sender.handle(job.payload, db);
      runs += 1;
    }
  }
  return runs;
}

describe.each(COUNTRY_CASES)('NotificationSender — $country ($currency)', (c) => {
  const country = COUNTRY_DATA.countryOf(c.country);
  if (!country) throw new Error(`pays ${c.country}`);

  function setup(contact: { email?: string | null; phone?: string | null; locale?: string } = {}) {
    const h = senderHarness();
    const db = new MemoryDb();
    const guest = randomUUID();
    const host = randomUUID();
    const contactOf = (n: string) => ({
      email: contact.email === undefined ? `${n}@example.test` : contact.email,
      phoneE164: contact.phone === undefined ? '+15550000001' : contact.phone,
      preferredLocale: contact.locale ?? 'fr',
      firstName: n === 'guest' ? 'Inès Dupré' : 'Ramón Báez',
    });
    h.directory.set(guest, contactOf('guest'));
    h.directory.set(host, contactOf('host'));
    const booked = event(
      'booking.trip.booked',
      {
        trip_id: randomUUID(),
        guest_user_id: guest,
        host_user_id: host,
        scheduled_start: START,
        scheduled_end: END,
      },
      c.country,
    );
    const sender = new NotificationSender(h.deps);
    return { h, db, guest, host, booked, sender };
  }

  it('envoi réussi : langue du destinataire, date au fuseau du pays, empreinte, clé ntf:<id>', async () => {
    const { h, db, booked, sender, guest } = setup({ locale: 'fr' });
    await dispatchEvent(booked, db);
    expect(await drain(db, sender)).toBe(2);

    const sent = h.email.sent();
    expect(sent).toHaveLength(2);
    const toGuest = sent.find((m) => m.to === 'guest@example.test');
    const row = db.dispatches.find((d) => d.recipient_user_id === guest);
    expect(toGuest?.idempotencyKey).toBe(`ntf:${row?.id}`);
    expect(toGuest?.locale).toBe('fr');
    // oracle : formatDateTime de @rueda/i18n au fuseau du pays (CFG)
    const startText = formatDateTime(START, country.timeZone, getProfile(LOCALE_CONFIG, 'fr'));
    expect(toGuest?.body).toContain(startText);
    expect(toGuest?.body).toContain('Inès Dupré');
    expect(toGuest?.subject).toMatch(/^Réservation [0-9A-F]{8} confirmée$/);
    expect(row).toMatchObject({ status: 'SENT', attempts: 1, locale: 'fr', last_error: null });
    expect(row?.provider_message_id).toMatch(/^fk_mail/);
    expect(row?.rendered_hash).toHaveLength(32);
    expect(h.sms.sent()).toEqual([]);
    expect(db.events).toEqual([]);
  });

  it('portugais du Brésil (DEC-FONDATEUR-18) : texte pt, date au format pt-BR', async () => {
    const { h, db, booked, sender } = setup({ locale: 'pt' });
    await dispatchEvent(booked, db);
    await drain(db, sender);
    const toGuest = h.email.sent().find((m) => m.to === 'guest@example.test');
    expect(toGuest?.locale).toBe('pt');
    expect(toGuest?.subject).toMatch(/^Reserva [0-9A-F]{8} confirmada$/);
    const startText = formatDateTime(START, country.timeZone, getProfile(LOCALE_CONFIG, 'pt'));
    expect(toGuest?.body).toContain(`de ${startText} a `);
    expect(toGuest?.body).toMatch(/^Olá, Inès Dupré\./);
  });

  it('langue absente du pays ⇒ locale par défaut du pays ; même langue, autre région ⇒ locale du pays', async () => {
    for (const [preferred, expected] of [
      ['de-DE', country.defaultLocale],
      ['es-AR', country.defaultLocale],
      ['en-GB', 'en'],
      // portugais du Brésil (DEC-FONDATEUR-18) : pt-BR et pt-PT ⇒ locale pt du pays
      ['pt-BR', 'pt'],
      ['pt-PT', 'pt'],
    ] as const) {
      const { h, db, booked, sender } = setup({ locale: preferred });
      await dispatchEvent(booked, db);
      await drain(db, sender);
      expect(h.email.sent().map((m) => m.locale)).toEqual([expected, expected]);
    }
  });

  it('tâche rejouée après l’envoi : rien de plus (envoi déjà SENT)', async () => {
    const { h, db, booked, sender } = setup();
    await dispatchEvent(booked, db);
    const jobs = db.pendingSends();
    await drain(db, sender);
    for (const job of jobs) await sender.handle(job.payload, db);
    expect(h.email.sent()).toHaveLength(2);
  });

  it('panne passagère : réessai différé (60 s, 120 s), même clé, envoyé à la 3e tentative', async () => {
    const { h, db, sender, guest } = setup();
    h.email.runtime.script.script('send', { kind: 'UNAVAILABLE' }, { kind: 'TIMEOUT_BEFORE' });
    // un seul destinataire pour lire les tentatives sans ambiguïté
    await dispatchEvent(
      event('kyc.verification.status_changed', { user_id: guest, to: 'APPROVED' }, c.country),
      db,
    );
    await drain(db, sender);
    const [row] = db.dispatches;
    expect(row).toMatchObject({ status: 'SENT', attempts: 3, last_error: null });
    expect(db.jobs.map((j) => [j.singletonKey, j.delaySeconds])).toEqual([
      [`${row?.id}:1`, 0],
      [`${row?.id}:2`, RETRY_BASE_SECONDS],
      [`${row?.id}:3`, RETRY_BASE_SECONDS * 2],
    ]);
    expect(h.email.sent()).toHaveLength(1);
    expect(h.email.sent()[0]?.idempotencyKey).toBe(`ntf:${row?.id}`);
    expect(db.events).toEqual([]);
  });

  it('issue inconnue (TIMEOUT après départ) : rejeu de la même clé, un seul message parti', async () => {
    const { h, db, booked, sender } = setup();
    h.email.runtime.script.script('send', { kind: 'TIMEOUT_AFTER' });
    await dispatchEvent(booked, db);
    await drain(db, sender);
    // le premier envoi est parti malgré le TIMEOUT : rejoué, le FAKE rend le premier résultat
    expect(h.email.sent()).toHaveLength(2);
    expect(db.dispatches.map((d) => d.status)).toEqual(['SENT', 'SENT']);
  });

  it(`critère 3 : ${String(MAX_SEND_ATTEMPTS)} échecs ⇒ repli SMS et notification.fallback.triggered`, async () => {
    const { h, db, booked, sender, guest } = setup({ locale: country.defaultLocale });
    h.email.runtime.script.script(
      'send',
      ...Array.from({ length: 2 * MAX_SEND_ATTEMPTS }, () => ({ kind: 'UNAVAILABLE' as const })),
    );
    await dispatchEvent(booked, db);
    await drain(db, sender);

    const primary = db.dispatches.filter((d) => d.channel === 'EMAIL');
    const fallback = db.dispatches.filter((d) => d.channel === 'SMS');
    expect(primary.map((d) => [d.status, d.attempts, d.last_error])).toEqual([
      ['FALLBACK_TRIGGERED', 3, 'UNAVAILABLE_EXHAUSTED'],
      ['FALLBACK_TRIGGERED', 3, 'UNAVAILABLE_EXHAUSTED'],
    ]);
    expect(fallback.map((d) => d.status)).toEqual(['SENT', 'SENT']);
    expect(fallback.map((d) => d.fallback_of).sort()).toEqual(primary.map((d) => d.id).sort());
    expect(h.sms.sent()).toHaveLength(2);
    expect(h.email.sent()).toEqual([]);

    const events = db.events.filter((e) => e.type === 'notification.fallback.triggered');
    expect(events).toHaveLength(2);
    const forGuest = primary.find((d) => d.recipient_user_id === guest);
    expect(events.find((e) => e.payload['dispatch_id'] === forGuest?.id)?.payload).toEqual({
      dispatch_id: forGuest?.id,
      channel: 'EMAIL',
      fallback_channel: 'SMS',
      fallback_dispatch_id: fallback.find((d) => d.fallback_of === forGuest?.id)?.id,
      reason: 'UNAVAILABLE_EXHAUSTED',
    });
    expect(events[0]?.causationId).toBe(booked.eventId);
    expect(events[0]?.correlationId).toBe(booked.correlationId);
  });

  it('refus définitif (destinataire bloqué) : repli immédiat, sans réessai', async () => {
    const { h, db, booked, sender } = setup();
    h.email.block('guest@example.test');
    await dispatchEvent(booked, db);
    await drain(db, sender);
    const blocked = db.dispatches.find((d) => d.channel === 'EMAIL' && d.status !== 'SENT');
    expect(blocked).toMatchObject({
      status: 'FALLBACK_TRIGGERED',
      attempts: 1,
      last_error: 'REFUSED_BLOCKED',
    });
    expect(h.sms.sent()).toHaveLength(1);
  });

  it('repli impossible (aucun numéro vérifié) : FAILED et notification.dispatch.failed, pas de second repli', async () => {
    const { h, db, booked, sender } = setup({ phone: null });
    h.email.block('guest@example.test');
    await dispatchEvent(booked, db);
    await drain(db, sender);
    const sms = db.dispatches.filter((d) => d.channel === 'SMS');
    expect(sms.map((d) => [d.status, d.last_error])).toEqual([['FAILED', 'NO_CONTACT']]);
    expect(db.events.map((e) => e.type).sort()).toEqual([
      'notification.dispatch.failed',
      'notification.fallback.triggered',
    ]);
    expect(db.events.find((e) => e.type === 'notification.dispatch.failed')?.payload).toMatchObject(
      {
        channel: 'SMS',
        fallback_channel: null,
        fallback_dispatch_id: null,
      },
    );
    expect(h.sms.sent()).toEqual([]);
  });

  it('canal sans adaptateur (capacité inconnue = « non ») : repli', async () => {
    const { h, db, booked } = setup();
    const sender = new NotificationSender({ ...h.deps, channels: { SMS: h.sms } });
    await dispatchEvent(booked, db);
    await drain(db, sender);
    expect(db.dispatches.filter((d) => d.channel === 'EMAIL').map((d) => d.last_error)).toEqual([
      'CHANNEL_UNAVAILABLE',
      'CHANNEL_UNAVAILABLE',
    ]);
    expect(h.sms.sent()).toHaveLength(2);
  });

  it('compte fermé ou inconnu : SUPPRESSED, rien n’est envoyé, aucun repli', async () => {
    const { h, db, sender } = setup();
    const unknown = event(
      'kyc.verification.status_changed',
      { user_id: randomUUID(), to: 'APPROVED' },
      c.country,
    );
    await dispatchEvent(unknown, db);
    await drain(db, sender);
    expect(db.dispatches.map((d) => [d.status, d.last_error])).toEqual([
      ['SUPPRESSED', 'RECIPIENT_UNAVAILABLE'],
    ]);
    expect([...h.email.sent(), ...h.sms.sent()]).toEqual([]);
    expect(db.events).toEqual([]);
  });

  it('garde : un repli ne se replie pas (SMS de repli refusé ⇒ FAILED, aucun nouvel e-mail)', async () => {
    const { h, db, sender, guest } = setup();
    h.email.block('guest@example.test');
    h.sms.block('+15550000001');
    await dispatchEvent(
      event('kyc.verification.status_changed', { user_id: guest, to: 'APPROVED' }, c.country),
      db,
    );
    await drain(db, sender);
    expect(
      db.dispatches.map((d) => [d.channel, d.status, d.last_error, d.fallback_of !== null]),
    ).toEqual([
      ['EMAIL', 'FALLBACK_TRIGGERED', 'REFUSED_BLOCKED', false],
      ['SMS', 'FAILED', 'REFUSED_BLOCKED', true],
    ]);
    expect(db.events.map((e) => e.type)).toEqual([
      'notification.fallback.triggered',
      'notification.dispatch.failed',
    ]);
    expect(db.events[1]?.payload).toMatchObject({ channel: 'SMS', fallback_channel: null });
  });

  it('repli vers un envoi déjà existant (canal doublé) : fallback_dispatch_id le nomme, aucun doublon', async () => {
    const { h, db, sender, guest } = setup();
    const kyc = event(
      'kyc.verification.status_changed',
      { user_id: guest, to: 'APPROVED' },
      c.country,
    );
    await dispatchEvent(kyc, db);
    // envoi SMS déjà présent pour le même (événement, destinataire)
    const smsId = await createDispatch(db, {
      eventId: kyc.eventId,
      eventType: kyc.type,
      countryCode: kyc.countryCode,
      correlationId: kyc.correlationId,
      recipientUserId: guest,
      recipientRole: 'GUEST',
      channel: 'SMS',
      template: 'EVT_KYC_APPROVED',
      variables: {},
      fallbackOf: null,
    });
    h.email.block('guest@example.test');
    await drain(db, sender);
    expect(db.dispatches.filter((d) => d.channel === 'SMS')).toHaveLength(1);
    const fallback = db.events.find((e) => e.type === 'notification.fallback.triggered');
    expect(fallback?.payload['fallback_dispatch_id']).toBe(smsId);
    expect(smsId).not.toBeNull();
    expect(h.sms.sent()).toHaveLength(1);
  });

  it('US-052 critère 2 : plafond SMS du pays atteint ⇒ SMS non critique refusé, alerte une fois', async () => {
    const { h, db, guest, sender } = setup();
    h.smsBudget.cap = 0; // plafond journalier déjà atteint
    h.email.block('guest@example.test'); // l'e-mail échoue : repli SMS (non critique : KYC)
    const kyc = event(
      'kyc.verification.status_changed',
      { user_id: guest, to: 'APPROVED' },
      c.country,
    );
    await dispatchEvent(kyc, db);
    await drain(db, sender);
    const sms = db.dispatches.find((d) => d.channel === 'SMS');
    expect(sms).toMatchObject({ status: 'FAILED', attempts: 0, last_error: 'SMS_DAILY_CAP' });
    expect(h.sms.sent()).toEqual([]); // aucun SMS ne part
    const alerts = db.events.filter((e) => e.type === 'notification.sms_cap.reached');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.payload).toEqual({
      dispatch_id: sms?.id,
      country_code: c.country,
      template: 'EVT_KYC_APPROVED',
    });
    expect(db.events.filter((e) => e.type === 'notification.dispatch.failed')).toHaveLength(1);
    // second refus du jour : aucune nouvelle alerte
    const again = event(
      'kyc.verification.status_changed',
      { user_id: guest, to: 'APPROVED' },
      c.country,
    );
    await dispatchEvent(again, db);
    await drain(db, sender);
    expect(db.events.filter((e) => e.type === 'notification.sms_cap.reached')).toHaveLength(1);
  });

  it('US-052 critère 2 : message critique de trip (retard) envoyé malgré le plafond, et compté', async () => {
    const { h, db, guest, host, sender } = setup();
    h.smsBudget.cap = 0;
    const overdue = event(
      'trip.overdue.detected',
      { trip_id: randomUUID(), guest_user_id: guest, host_user_id: host, scheduled_end: END },
      c.country,
    );
    await dispatchEvent(overdue, db);
    await drain(db, sender);
    expect(h.sms.sent()).toHaveLength(2);
    expect(db.dispatches.every((d) => d.status === 'SENT')).toBe(true);
    expect(h.smsBudget.sent.get(c.country)).toBe(2);
    expect(db.events.some((e) => e.type === 'notification.sms_cap.reached')).toBe(false);
  });

  it('US-052 : compteur du plafond indisponible ⇒ la tâche échoue, aucun SMS (fail-closed)', async () => {
    const { h, db, guest, host, sender } = setup();
    h.smsBudget.fail = true;
    const overdue = event(
      'trip.overdue.detected',
      { trip_id: randomUUID(), guest_user_id: guest, host_user_id: host, scheduled_end: END },
      c.country,
    );
    await dispatchEvent(overdue, db);
    const [job] = db.pendingSends();
    if (job === undefined) throw new Error('aucune tâche');
    await expect(sender.handle(job.payload, db)).rejects.toThrow(/indisponible/);
    expect(h.sms.sent()).toEqual([]);
  });

  it('US-052 : un réessai ne recompte pas le plafond (réservation à la 1re tentative)', async () => {
    const { h, db, guest, host, sender } = setup();
    h.sms.runtime.script.script(
      'send',
      { kind: 'UNAVAILABLE' as const },
      { kind: 'UNAVAILABLE' as const },
    );
    const overdue = event(
      'trip.overdue.detected',
      { trip_id: randomUUID(), guest_user_id: guest, host_user_id: host, scheduled_end: END },
      c.country,
    );
    await dispatchEvent(overdue, db);
    await drain(db, sender);
    expect(h.sms.sent()).toHaveLength(2);
    expect(h.smsBudget.sent.get(c.country)).toBe(2);
  });

  it('journaux : identifiants et codes seulement — ni adresse, ni numéro, ni prénom, ni texte', async () => {
    const { h, db, booked, sender } = setup();
    h.email.block('guest@example.test');
    await dispatchEvent(booked, db);
    await drain(db, sender);
    expect(h.logs.length).toBeGreaterThan(0);
    const text =
      JSON.stringify(h.logs) +
      JSON.stringify(db.events) +
      JSON.stringify(db.dispatches.map((d) => d.variables));
    const sentBodies = [...h.email.sent(), ...h.sms.sent()].flatMap((m) => [
      m.body,
      m.subject ?? '',
    ]);
    for (const secret of [
      'guest@example.test',
      'host@example.test',
      '+15550000001',
      'Inès',
      'Ramón',
      ...sentBodies.filter((b) => b.length > 0),
    ]) {
      expect(text).not.toContain(secret);
    }
    for (const entry of h.logs) {
      expect(Object.keys(entry).sort()).toEqual(
        ['attempts', 'channel', 'code', 'dispatch_id', 'event', 'outcome', 'template'].sort(),
      );
    }
  });
});
