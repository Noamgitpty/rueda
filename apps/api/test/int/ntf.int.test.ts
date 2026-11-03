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
 * (Critère 1, gabarits es / en / fr : tests unitaires `templates.test.ts`.)
 * Chaque cas tourne en USD (PA) et en PYG sans décimale (PY).
 */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { connectAs, releaseClient } from '@rueda/db/testing';
import { FakeClock, FakeMessagingChannel } from '@rueda/fake-adapters';
import { countryCases } from '../support/countries.js';
import type { DeadLetterAlert, LeasedSqlClient } from '../../src/modules/bus/index.js';
import { BusRegistry, JobRunner, workerTransactions } from '../../src/modules/bus/index.js';
import { CountryConfigService } from '../../src/modules/cfg/index.js';
import { postgresNotificationContacts } from '../../src/modules/iam/index.js';
import type { NtfLogEntry } from '../../src/modules/ntf/index.js';
import {
  dispatchEvent,
  MAX_SEND_ATTEMPTS,
  NotificationSender,
  notificationCountryData,
  NTF_DISPATCHER_WORKER,
  NTF_SENDER_WORKER,
  registerNotifications,
  repositoryLocaleConfig,
} from '../../src/modules/ntf/index.js';

const CASES = countryCases();
const COUNTRY_DATA = notificationCountryData(new CountryConfigService().config);

const opened: pg.Client[] = [];
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

/** Compte vérifié (commandes IAM de production), numéro vérifié posé par la fixture 9500. */
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
    `SELECT core.iam_cmd_register($1, $2, $3, 'Inès', 'Dupré', $4, $5, $6, 86400, '203.0.113.7')`,
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

    const first = await e.tx.run(NTF_DISPATCHER_WORKER, (sql) => dispatchEvent(event, sql));
    const replay = await e.tx.run(NTF_DISPATCHER_WORKER, (sql) => dispatchEvent(event, sql));
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
    const guest = await verifiedAccount(
      api,
      'fr',
      `+1555${String(randomInt(0, 10_000_000)).padStart(7, '0')}`,
    );
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
});
