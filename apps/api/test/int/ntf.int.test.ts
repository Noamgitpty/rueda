/**
 * US-021 — moteur de notifications de bout en bout sur PostgreSQL réel, sous les rôles de
 * production (CLAUDE.md point 6 : `connectAs` exécute l'assertion L0-05 en tête de chaque test) :
 * consommateur `ntf_dispatcher`, minuterie `ntf_sender` exécutée par le `JobRunner` du module BUS,
 * coordonnées lues par `core.iam_notification_contact` (adaptateur IAM), FAKE e-mail et SMS.
 *
 * Critères (19 US-021) :
 *  - « Given un événement rejoué, When il est reçu, Then aucun doublon par destinataire et canal » ;
 *  - « Given un échec d'envoi, When il est remonté, Then repli sur l'autre canal et
 *    notification.fallback.triggered ».
 * (Critère 1, gabarits es / en / fr / pt : tests unitaires `templates.test.ts`.)
 *
 * US-213 (ADR-157) : les parties d'une réservation sont lues en base par l'adaptateur
 * `postgresNotificationParties` d'AVL (`core.booking_notification_parties`, 0133), sous
 * `ntf_dispatcher` ; un trip réel (monde de la fixture 9963) et la charge utile réelle de
 * `booking.trip.booked` (0126, sans identifiant de personne).
 * Chaque cas tourne en USD (PA) et en PYG sans décimale (PY).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { connectAs, releaseClient } from '@rueda/db/testing';
import { FakeClock, FakeMessagingChannel } from '@rueda/fake-adapters';
import { countryCases } from '../support/countries.js';
import type { DeadLetterAlert, LeasedSqlClient } from '../../src/modules/bus/index.js';
import { BusRegistry, JobRunner, workerTransactions } from '../../src/modules/bus/index.js';
import { CountryConfigService } from '../../src/modules/cfg/index.js';
import { postgresNotificationContacts } from '../../src/modules/iam/index.js';
import { postgresNotificationParties } from '../../src/modules/avl/index.js';
import type { NotificationParties, NtfLogEntry } from '../../src/modules/ntf/index.js';
import {
  dispatchEvent,
  MAX_SEND_ATTEMPTS,
  NotificationSender,
  notificationCountryData,
  NTF_DISPATCHER_WORKER,
  NTF_SENDER_WORKER,
  registerNotifications,
  repositoryLocaleConfig,
  RULES,
} from '../../src/modules/ntf/index.js';

const CASES = countryCases();
const COUNTRY_DATA = notificationCountryData(new CountryConfigService().config);

const opened: pg.Client[] = [];

/**
 * Numéro E.164 fictif (`+1 555`) unique par construction (BOARD N-186) : un numéro vérifié
 * n'appartient qu'à un compte (ACC-014, index unique) sur une base partagée par tous les fichiers ;
 * `+15559` puis 6 chiffres du compteur de test de la base (fixture 9999).
 */
async function uniquePhone(api: pg.Client): Promise<string> {
  const { rows } = await api.query<{ n: string }>(
    'SELECT test_fixture.next_unique_serial()::text AS n',
  );
  const n = rows[0]?.n ?? '';
  if (!/^[0-9]{1,6}$/.test(n)) throw new Error(`compteur unique de test hors de 6 chiffres : ${n}`);
  return `+15559${n.padStart(6, '0')}`;
}
afterEach(async () => {
  for (const c of opened.splice(0)) await releaseClient(c);
});

async function open(role: 'app_api' | 'app_worker'): Promise<pg.Client> {
  const client = await connectAs(role); // assertion L0-05
  opened.push(client);
  return client;
}

const asSql = (client: pg.Client): LeasedSqlClient => ({
  query: async <R>(text: string, params?: readonly unknown[]) => {
    const result = await client.query(text, params as unknown[] | undefined);
    return { rows: result.rows as R[], rowCount: result.rowCount };
  },
  release: () => undefined,
});

/** Compte vérifié (commandes IAM de production), numéro vérifié posé par la fixture 9600. */
async function verifiedAccount(
  api: pg.Client,
  locale: string,
  phone: string | null,
): Promise<string> {
  const userId = randomUUID();
  const token = randomBytes(32);
  const hash = createHash('sha256').update(token).digest();
  const b64 = (n: number) => randomBytes(n).toString('base64').replace(/=+$/, '');
  await api.query(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Inès', 'Dupré', $4, $5, $6, 86400, '203.0.113.7', NULL, '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]'::jsonb, false)`,
    [
      userId,
      `u-${userId}@example.test`,
      `$argon2id$v=19$m=65536,t=3,p=1$${b64(16)}$${b64(32)}`,
      locale,
      randomUUID(),
      hash,
    ],
  );
  await api.query('SELECT core.iam_cmd_verify_email($1)', [hash]);
  if (phone !== null) {
    await api.query('SELECT test_fixture.ntf_set_phone($1, $2, true)', [userId, phone]);
  }
  return userId;
}

/** Parties fixes d'un trip (le trip de l'événement de test n'existe pas en base). */
const fixedParties = (guest: string, host: string): NotificationParties => ({
  partiesOf: () =>
    Promise.resolve({
      guestUserId: guest,
      hostUserId: host,
      holdKind: null,
      holdStatus: null,
      releaseReason: null,
      requestAuthorized: null,
    }),
});

class RecordingAlerter {
  readonly alerts: DeadLetterAlert[] = [];
  deadLetter(alert: DeadLetterAlert): void {
    this.alerts.push(alert);
  }
}

function engine(worker: pg.Client) {
  const clock = new FakeClock('2026-11-03T12:00:00Z');
  const email = new FakeMessagingChannel({ clock, channel: 'EMAIL' });
  const sms = new FakeMessagingChannel({ clock, channel: 'SMS' });
  const logs: NtfLogEntry[] = [];
  const sender = new NotificationSender({
    channels: { EMAIL: email, SMS: sms },
    directory: postgresNotificationContacts,
    // plafond SMS (US-052) : prouvé par sender.test.ts et packages/db/test/l0/l0-risk-rate-limit.test.ts ; illimité ici
    smsBudget: { reserve: () => Promise.resolve({ allowed: true, alert: false }) },
    countryOf: COUNTRY_DATA.countryOf,
    exponentOf: COUNTRY_DATA.exponentOf,
    localeConfig: repositoryLocaleConfig(),
    brand: 'Marca de prueba',
    log: (e) => logs.push(e),
    retryBaseSeconds: 0, // réessais immédiatement échus dans le test
  });
  const registry = new BusRegistry();
  registerNotifications(registry, sender);
  const tx = workerTransactions(() => Promise.resolve(asSql(worker)));
  const runner = new JobRunner(tx, registry, new RecordingAlerter(), { backoffBaseSeconds: 0 });
  /** Exécute la file ntf_sender jusqu'à épuisement. */
  const drain = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) {
      const r = await runner.runOnce(NTF_SENDER_WORKER);
      if (r.outcomes.length === 0) return;
      for (const o of r.outcomes) expect(o.outcome).toBe('PROCESSED');
    }
    throw new Error('file ntf_sender non épuisée');
  };
  return { email, sms, logs, tx, drain };
}

interface DispatchRow {
  id: string;
  channel: string;
  status: string;
  attempts: number;
  locale: string | null;
  last_error: string | null;
  fallback_of: string | null;
  has_hash: boolean;
}

describe.each(CASES)('NTF sur PostgreSQL réel — $country ($currency)', (c) => {
  const bookedEvent = (guest: string, host: string) => ({
    eventId: randomUUID(),
    type: 'booking.trip.booked',
    schemaVersion: 1,
    occurredAt: '2026-11-03T12:00:00.000Z',
    aggregateType: 'trip',
    aggregateId: randomUUID(),
    aggregateVersion: 1n,
    countryCode: c.country,
    actor: 'SYSTEM' as const,
    correlationId: randomUUID(),
    causationId: null,
    partitionKey: null,
    payload: {
      trip_id: randomUUID(),
      guest_user_id: guest,
      host_user_id: host,
      scheduled_start: '2026-12-24T14:00:00Z',
      scheduled_end: '2026-12-27T10:00:00Z',
      currency: c.currency,
    },
  });

  const rowsOf = (tx: ReturnType<typeof engine>['tx'], eventId: string) =>
    tx.run(NTF_SENDER_WORKER, async (sql) => {
      const { rows } = await sql.query<DispatchRow>(
        `SELECT id::text, channel, status, attempts, locale, last_error, fallback_of::text,
                rendered_hash IS NOT NULL AS has_hash
           FROM core.ntf_notification_dispatch WHERE event_id = $1::uuid ORDER BY channel, id`,
        [eventId],
      );
      return rows;
    });

  it('critère 2 : événement rejoué ⇒ aucun doublon par destinataire et canal ; un message chacun, dans sa langue', async () => {
    const api = await open('app_api');
    const worker = await open('app_worker');
    const guest = await verifiedAccount(api, 'fr', null);
    const host = await verifiedAccount(api, 'en', null);
    const e = engine(worker);
    const event = bookedEvent(guest, host);
    const parties = fixedParties(guest, host);

    const first = await e.tx.run(NTF_DISPATCHER_WORKER, (sql) =>
      dispatchEvent(event, sql, RULES, parties),
    );
    const replay = await e.tx.run(NTF_DISPATCHER_WORKER, (sql) =>
      dispatchEvent(event, sql, RULES, parties),
    );
    expect(first).toHaveLength(2);
    expect(replay).toEqual([]);
    await e.drain();

    const rows = await rowsOf(e.tx, event.eventId);
    expect(rows.map((r) => [r.channel, r.status, r.attempts, r.has_hash])).toEqual([
      ['EMAIL', 'SENT', 1, true],
      ['EMAIL', 'SENT', 1, true],
    ]);
    expect(rows.map((r) => r.locale).sort()).toEqual(['en', 'fr']);
    const sent = e.email.sent();
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((m) => m.to)).size).toBe(2);
    expect(sent.find((m) => m.locale === 'fr')?.subject).toMatch(
      /^Réservation [0-9A-F]{8} confirmée$/,
    );
    expect(sent.find((m) => m.locale === 'en')?.subject).toMatch(/^Booking [0-9A-F]{8} confirmed$/);
    // journal : aucune donnée personnelle
    const logs = JSON.stringify(e.logs);
    for (const m of sent) {
      expect(logs).not.toContain(m.to);
      expect(logs).not.toContain(m.body);
    }
    expect(logs).not.toContain('Inès');
  });

  it(`critère 3 : ${String(MAX_SEND_ATTEMPTS)} échecs e-mail ⇒ repli SMS et notification.fallback.triggered dans l'outbox`, async () => {
    const api = await open('app_api');
    const worker = await open('app_worker');
    const guest = await verifiedAccount(api, 'fr', await uniquePhone(api));
    const e = engine(worker);
    e.email.runtime.script.script(
      'send',
      ...Array.from({ length: MAX_SEND_ATTEMPTS }, () => ({ kind: 'UNAVAILABLE' as const })),
    );
    const event = {
      ...bookedEvent(guest, guest),
      type: 'kyc.verification.status_changed',
      payload: { user_id: guest, to: 'APPROVED' },
    };
    await e.tx.run(NTF_DISPATCHER_WORKER, (sql) => dispatchEvent(event, sql));
    await e.drain();

    const rows = await rowsOf(e.tx, event.eventId);
    const primary = rows.find((r) => r.channel === 'EMAIL');
    const fallback = rows.find((r) => r.channel === 'SMS');
    expect(primary).toMatchObject({
      status: 'FALLBACK_TRIGGERED',
      attempts: MAX_SEND_ATTEMPTS,
      last_error: 'UNAVAILABLE_EXHAUSTED',
    });
    expect(fallback).toMatchObject({ status: 'SENT', attempts: 1, fallback_of: primary?.id });
    expect(e.sms.sent()).toHaveLength(1);
    expect(e.email.sent()).toEqual([]);

    // l'événement est dans l'outbox (lu par le relais, seul lecteur autorisé)
    const published = await e.tx.run('outbox_relay', async (sql) => {
      const { rows: ev } = await sql.query<{ type: string; payload: Record<string, unknown> }>(
        `SELECT type, payload FROM core.outbox_outbox_event
          WHERE aggregate_id = $1::uuid ORDER BY id`,
        [primary?.id],
      );
      return ev;
    });
    expect(published).toEqual([
      {
        type: 'notification.fallback.triggered',
        payload: {
          dispatch_id: primary?.id,
          channel: 'EMAIL',
          fallback_channel: 'SMS',
          fallback_dispatch_id: fallback?.id,
          reason: 'UNAVAILABLE_EXHAUSTED',
        },
      },
    ]);
  });

  it('US-213 : `booking.trip.booked` réel (sans identifiant de personne) ⇒ voyageur et titulaire du compte d’hôte lus en base, un envoi chacun, aucun doublon au rejeu ; hors ntf_dispatcher : refus', async () => {
    const worker = await open('app_worker');
    const sql = asSql(worker);
    const as = (name: string) =>
      worker.query(
        `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                pg_catalog.set_config('app.worker_name', $1, true)`,
        [name],
      );
    const { rows: serial } = await worker.query<{ n: string }>(
      'SELECT test_fixture.next_unique_serial()::text AS n',
    );
    const guest = randomUUID();
    // montants de TEST (120 unités de la devise du pays) ; aucun montant n'est lu par NTF ici
    const lines = JSON.stringify([{ type: 'TRIP_PRICE', amountMinor: c.amountMinor }]);
    const deductibles = JSON.stringify({
      BASICA: c.amountMinor,
      ESTANDAR: c.amountMinor,
      TOTAL: '0',
    });
    // transaction ANNULÉE : le monde de la fixture 9963 (contrat d'assureur compris) ne reste pas
    await worker.query('BEGIN');
    try {
      await as(NTF_DISPATCHER_WORKER);
      const { rows: world } = await worker.query<{
        trip_id: string;
        hold_id: string;
        holder_id: string;
      }>(
        `SELECT trip_id::text, hold_id::text, holder_id::text
           FROM test_fixture.us211_world($1, $2::uuid, 'Ana', 'Pérez', 'es', 'María', 'Gómez', $3,
                                         'HOST', $4::timestamptz, $5::timestamptz, $6::jsonb,
                                         'BASICA', 600, 35, $7::jsonb, $9::bigint, $8::bigint)`,
        [
          c.country,
          guest,
          `U213${serial[0]?.n ?? ''}`,
          '2034-04-10T15:00:00.000Z',
          '2034-04-13T15:00:00.000Z',
          lines,
          deductibles,
          c.amountMinor,
          // RC de TEST au-dessus du minimum du pays (garde 0115) : 10^7 fois 120 unités
          (BigInt(c.amountMinor) * 10_000_000n).toString(),
        ],
      );
      const w = world[0];
      if (w === undefined) throw new Error('monde 9963 absent');
      // charge utile de 0126 : trip_id, hold_id, vehicle_id, org_id, scheduled_* (aucune personne)
      const event = {
        ...bookedEvent(guest, guest),
        aggregateId: w.trip_id,
        payload: {
          trip_id: w.trip_id,
          hold_id: w.hold_id,
          vehicle_id: randomUUID(),
          org_id: randomUUID(),
          scheduled_start: '2034-04-10T15:00:00.000000+00:00',
          scheduled_end: '2034-04-13T15:00:00.000000+00:00',
        },
      };
      const first = await dispatchEvent(event, sql, RULES, postgresNotificationParties);
      const replay = await dispatchEvent(event, sql, RULES, postgresNotificationParties);
      expect(first).toHaveLength(2);
      expect(replay).toEqual([]);

      await as(NTF_SENDER_WORKER);
      const { rows } = await worker.query<{
        recipient_user_id: string;
        recipient_role: string;
        template_key: string;
        variables: Record<string, unknown>;
      }>(
        `SELECT recipient_user_id::text, recipient_role, template_key, variables
           FROM core.ntf_notification_dispatch WHERE event_id = $1::uuid ORDER BY recipient_role`,
        [event.eventId],
      );
      expect(rows.map((r) => [r.recipient_role, r.recipient_user_id, r.template_key])).toEqual([
        ['GUEST', guest, 'EVT_BOOKING_CONFIRMED'],
        ['HOST', w.holder_id, 'EVT_BOOKING_CONFIRMED_HOST'],
      ]);
      // référence du trip (8 premiers chiffres, comme le contrat et les écrans) ; aucun nom stocké
      for (const r of rows) {
        expect(r.variables['booking_ref']).toBe(w.trip_id.slice(0, 8).toUpperCase());
        expect(JSON.stringify(r.variables)).not.toMatch(/Ana|Pérez|María|Gómez/);
      }

      // tout autre travailleur : la base refuse la lecture des parties (42501), aucun envoi
      await as('booking_contract');
      await worker.query('SAVEPOINT other_worker');
      await expect(
        dispatchEvent({ ...event, eventId: randomUUID() }, sql, RULES, postgresNotificationParties),
      ).rejects.toMatchObject({ code: '42501' });
      await worker.query('ROLLBACK TO SAVEPOINT other_worker');
    } finally {
      await worker.query('ROLLBACK');
    }
  });
});
