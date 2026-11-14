/**
 * US-045 — résilience du travailleur `ntf_sender` sur le canal SMS face au FAKE hostile
 * `FakeMessagingChannel` (`@rueda/fake-adapters/messaging`, mode scripté ; 17 §5 « SMS », §2.13
 * « idempotence ; 3 réessais ; repli », §12 « Résilience » ; ADR-032 « mode hostile » ; ADR-058 ;
 * ADR-061).
 *
 * Ce qui est prouvé, pour chaque pays de la configuration (USD et PYG), sur un gabarit SMS d'abord
 * (`trip.overdue.detected` ⇒ EVT_TRIP_OVERDUE, SMS puis e-mail en repli) :
 * - `TIMEOUT_AFTER` : la tentative suivante rejoue la MÊME clé `ntf:<envoi>` ; un seul SMS part ;
 * - `TIMEOUT_BEFORE` : rien ne part, réessai différé, un seul SMS à la reprise ;
 * - `DUPLICATE` : le fournisseur double le message ; nous ne l'avons demandé qu'UNE fois (un appel
 *   par envoi, aucun réessai), l'envoi est `SENT` à la 1re tentative ;
 * - `DELAY` : envoi lent mais réussi, sans réessai ;
 * - panne prolongée (`UNAVAILABLE` ou `TIMEOUT_AFTER` par défaut) : 3 tentatives différées
 *   (0, 60 s, 120 s), plafond SMS compté UNE fois par envoi, puis repli e-mail
 *   (`notification.fallback.triggered`) ; sous `TIMEOUT_AFTER` le SMS n'est parti qu'une fois.
 *
 * Attendus tirés du contrat : en-tête de sender.ts (clé identique à chaque tentative, 3 tentatives,
 * attente 60 s × 2^(n−1), réservation du plafond à la 1re tentative seulement, US-052), table de
 * FakeRuntime (ADR-058 : `TIMEOUT_AFTER` = effet produit, rejeu = premier résultat ; `DUPLICATE` =
 * effet produit deux fois, au consommateur de dédoublonner). Jamais de l'instantané du code. Heure
 * virtuelle (FakeClock) ; base en mémoire de ntf.test-support.ts. Données fictives.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dispatchEvent } from './dispatcher.js';
import type { MemoryDb as MemoryDbType } from './ntf.test-support.js';
import { COUNTRY_CASES, event, MemoryDb, senderHarness } from './ntf.test-support.js';
import { MAX_SEND_ATTEMPTS, NotificationSender, RETRY_BASE_SECONDS } from './sender.js';

const END = '2026-12-27T10:00:00Z';
const GUEST_PHONE = '+15550000001';
const HOST_PHONE = '+15550000002';

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

describe.each(COUNTRY_CASES)(
  'US-045 — SMS face au fournisseur hostile ($country, $currency)',
  (c) => {
    async function setup() {
      const h = senderHarness();
      const db = new MemoryDb();
      const guest = randomUUID();
      const host = randomUUID();
      h.directory.set(guest, {
        email: 'guest@example.test',
        phoneE164: GUEST_PHONE,
        preferredLocale: 'es',
        firstName: 'Inès',
      });
      h.directory.set(host, {
        email: 'host@example.test',
        phoneE164: HOST_PHONE,
        preferredLocale: 'es',
        firstName: 'Ramón',
      });
      const overdue = event(
        'trip.overdue.detected',
        { trip_id: randomUUID(), guest_user_id: guest, host_user_id: host, scheduled_end: END },
        c.country,
      );
      await dispatchEvent(overdue, db);
      const sms = () => db.dispatches.filter((d) => d.channel === 'SMS');
      // un envoi SMS par destinataire, rien d'autre en file
      expect(sms()).toHaveLength(2);
      return { h, db, sender: new NotificationSender(h.deps), sms };
    }

    /** Délais des tâches `ntf_sender` d'un envoi, dans l'ordre (singletonKey `<id>:<tentative>`). */
    const delaysOf = (db: MemoryDbType, id: string) =>
      db.jobs.filter((j) => j.singletonKey?.startsWith(`${id}:`)).map((j) => j.delaySeconds);

    it('TIMEOUT_AFTER : rejeu de la même clé à la tentative suivante, un seul SMS par destinataire', async () => {
      const { h, db, sender, sms } = await setup();
      h.sms.runtime.script.script('send', { kind: 'TIMEOUT_AFTER' }, { kind: 'TIMEOUT_AFTER' });
      await drain(db, sender);

      const sent = h.sms.sent();
      expect(sent.map((m) => m.to).sort()).toEqual([GUEST_PHONE, HOST_PHONE]);
      for (const row of sms()) {
        expect(row).toMatchObject({ status: 'SENT', attempts: 2, last_error: null });
        const message = sent.find((m) => m.idempotencyKey === `ntf:${row.id}`);
        // identifiant rendu par le rejeu = celui du message parti au premier appel
        expect(row.provider_message_id).toBe(message?.messageId);
        expect(delaysOf(db, row.id)).toEqual([0, RETRY_BASE_SECONDS]);
      }
      expect(h.sms.runtime.script.calls('send')).toBe(4);
      // plafond SMS réservé à la 1re tentative seulement : 2 envois, pas 4
      expect(h.smsBudget.sent.get(c.country)).toBe(2);
      expect(h.email.sent()).toEqual([]);
      expect(db.events).toEqual([]);
    });

    it('TIMEOUT_BEFORE : rien ne part, réessai différé, un seul SMS à la reprise', async () => {
      const { h, db, sender, sms } = await setup();
      h.sms.runtime.script.script('send', { kind: 'TIMEOUT_BEFORE' }, { kind: 'TIMEOUT_BEFORE' });
      await drain(db, sender);
      expect(h.sms.sent()).toHaveLength(2);
      for (const row of sms()) {
        expect(row).toMatchObject({ status: 'SENT', attempts: 2, last_error: null });
        expect(h.sms.sent().filter((m) => m.idempotencyKey === `ntf:${row.id}`)).toHaveLength(1);
        expect(delaysOf(db, row.id)).toEqual([0, RETRY_BASE_SECONDS]);
      }
      expect(h.logs.filter((l) => l.outcome === 'RETRY').map((l) => l.code)).toEqual([
        'TIMEOUT',
        'TIMEOUT',
      ]);
      expect(h.smsBudget.sent.get(c.country)).toBe(2);
    });

    it('DUPLICATE : le fournisseur double le message ; nous ne l’avons demandé qu’une fois, sans réessai', async () => {
      const { h, db, sender, sms } = await setup();
      h.sms.runtime.script.setDefault('send', { kind: 'DUPLICATE' });
      await drain(db, sender);
      // ce que voit le consommateur : OK une fois par envoi ; le doublon est du côté du fournisseur
      // (deux copies, même clé, même identifiant de message)
      expect(h.sms.runtime.script.calls('send')).toBe(2);
      for (const row of sms()) {
        expect(row).toMatchObject({ status: 'SENT', attempts: 1, last_error: null });
        const copies = h.sms.sent().filter((m) => m.idempotencyKey === `ntf:${row.id}`);
        expect(copies).toHaveLength(2);
        expect(new Set(copies.map((m) => m.messageId))).toEqual(new Set([row.provider_message_id]));
        expect(delaysOf(db, row.id)).toEqual([0]);
      }
      expect(h.logs.map((l) => l.outcome)).toEqual(['SENT', 'SENT']);
      expect(h.smsBudget.sent.get(c.country)).toBe(2);
      // tâches rejouées après coup : envois déjà SENT, aucun nouvel appel
      for (const job of db.jobs) await sender.handle(job.payload, db);
      expect(h.sms.runtime.script.calls('send')).toBe(2);
    });

    it('DELAY : envoi lent mais réussi à la 1re tentative, sans réessai (heure virtuelle)', async () => {
      const { h, db, sender, sms } = await setup();
      const before = h.sms.runtime.clock.nowMs();
      h.sms.runtime.script.setDefault('send', { kind: 'DELAY', ms: 30_000 });
      await drain(db, sender);
      expect(h.sms.sent()).toHaveLength(2);
      for (const m of h.sms.sent())
        expect(m.sentAt.getTime()).toBeGreaterThanOrEqual(before + 30_000);
      for (const row of sms()) {
        expect(row).toMatchObject({ status: 'SENT', attempts: 1 });
        expect(delaysOf(db, row.id)).toEqual([0]);
      }
    });

    it(`panne prolongée (UNAVAILABLE) : ${String(MAX_SEND_ATTEMPTS)} tentatives différées, plafond compté une fois, repli e-mail`, async () => {
      const { h, db, sender, sms } = await setup();
      h.sms.runtime.script.setDefault('send', { kind: 'UNAVAILABLE' });
      await drain(db, sender);

      expect(h.sms.sent()).toEqual([]);
      expect(h.sms.runtime.script.calls('send')).toBe(2 * MAX_SEND_ATTEMPTS);
      for (const row of sms()) {
        expect(row).toMatchObject({
          status: 'FALLBACK_TRIGGERED',
          attempts: MAX_SEND_ATTEMPTS,
          last_error: 'UNAVAILABLE_EXHAUSTED',
        });
        expect(delaysOf(db, row.id)).toEqual([0, RETRY_BASE_SECONDS, RETRY_BASE_SECONDS * 2]);
      }
      // aucun double comptage du plafond par les réessais (US-052)
      expect(h.smsBudget.sent.get(c.country)).toBe(2);
      expect(
        h.email
          .sent()
          .map((m) => m.to)
          .sort(),
      ).toEqual(['guest@example.test', 'host@example.test']);
      expect(db.events.map((e) => e.type)).toEqual([
        'notification.fallback.triggered',
        'notification.fallback.triggered',
      ]);
      expect(h.logs.filter((l) => l.outcome === 'RETRY')).toHaveLength(2 * (MAX_SEND_ATTEMPTS - 1));
    });

    it('issue inconnue prolongée (TIMEOUT_AFTER) : le SMS n’est parti qu’une fois malgré 3 tentatives, puis repli', async () => {
      const { h, db, sender, sms } = await setup();
      h.sms.runtime.script.setDefault('send', { kind: 'TIMEOUT_AFTER' });
      await drain(db, sender);
      // chaque rejeu porte la même clé : le fournisseur ne renvoie pas le message
      expect(
        h.sms
          .sent()
          .map((m) => m.to)
          .sort(),
      ).toEqual([GUEST_PHONE, HOST_PHONE]);
      expect(h.sms.runtime.script.calls('send')).toBe(2 * MAX_SEND_ATTEMPTS);
      for (const row of sms()) {
        expect(row).toMatchObject({
          status: 'FALLBACK_TRIGGERED',
          attempts: MAX_SEND_ATTEMPTS,
          last_error: 'TIMEOUT_EXHAUSTED',
        });
      }
      expect(h.smsBudget.sent.get(c.country)).toBe(2);
      expect(h.email.sent()).toHaveLength(2);
    });
  },
);
