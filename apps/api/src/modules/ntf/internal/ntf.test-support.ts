/**
 * Aides des tests unitaires NTF (US-021) : données pays lues dans CFG (aucune constante pays),
 * événements d'exemple, annuaire en mémoire et une base en mémoire qui ne comprend QUE les
 * requêtes de `dispatcher.ts` et `sender.ts` (la preuve sur PostgreSQL réel, sous app_worker, est
 * dans `apps/api/test/int/ntf.int.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import { FakeClock, FakeMessagingChannel } from '@rueda/fake-adapters';
import type { DomainEvent, JsonObject, SqlClient, SqlResult } from '../../bus/index.js';
import { CountryConfigService } from '../../cfg/index.js';
import type { MessageChannelKind } from './messaging-channel.port.js';
import type { RecipientContact, RecipientDirectory } from './recipient-directory.port.js';
import { notificationCountryData, repositoryLocaleConfig } from './registration.js';
import type { NotificationSenderDeps, NtfLogEntry } from './sender.js';
import type { SmsBudget, SmsReserveResult } from './sms-budget.port.js';

export const COUNTRY_CONFIG = new CountryConfigService().config;
export const COUNTRY_DATA = notificationCountryData(COUNTRY_CONFIG);
export const LOCALE_CONFIG = repositoryLocaleConfig();

/** Un cas par pays configuré : USD (PA) et PYG sans décimale (PY), CLAUDE.md point 3. */
export const COUNTRY_CASES = [...COUNTRY_CONFIG.countries.values()].map((c) => ({
  country: c.code,
  currency: c.currency.code,
  exponent: c.currency.exponent,
  /** 120 unités de la devise, en unités mineures. */
  amountMinor: (120n * 10n ** BigInt(c.currency.exponent)).toString(),
}));

/** Marque de test (la vraie est une donnée de thème, DEC-MARQUE). */
export const TEST_BRAND = 'Marca de prueba';

export function event(
  type: string,
  payload: JsonObject,
  countryCode: string | null,
  eventId = randomUUID(),
): DomainEvent {
  return {
    eventId,
    type,
    schemaVersion: 1,
    occurredAt: '2026-11-03T12:00:00.000Z',
    aggregateType: 'trip',
    aggregateId: randomUUID(),
    aggregateVersion: 1n,
    countryCode,
    actor: 'SYSTEM',
    correlationId: randomUUID(),
    causationId: null,
    payload,
    partitionKey: null,
  };
}

export class MemoryDirectory implements RecipientDirectory {
  readonly #contacts = new Map<string, RecipientContact>();
  set(userId: string, contact: RecipientContact): void {
    this.#contacts.set(userId, contact);
  }
  readonly contactOf = (_tx: SqlClient, userId: string): Promise<RecipientContact | null> =>
    Promise.resolve(this.#contacts.get(userId) ?? null);
}

export interface MemoryDispatch {
  id: string;
  event_id: string;
  event_type: string;
  country_code: string | null;
  correlation_id: string;
  recipient_user_id: string;
  recipient_role: string;
  channel: MessageChannelKind;
  template_key: string;
  template_version: number;
  variables: Record<string, unknown>;
  status: string;
  attempts: number;
  locale: string | null;
  provider_message_id: string | null;
  rendered_hash: Buffer | null;
  last_error: string | null;
  fallback_of: string | null;
}

export interface MemoryJob {
  readonly name: string;
  readonly payload: JsonObject;
  readonly singletonKey: string | null;
  readonly delaySeconds: number;
}

export interface MemoryEvent {
  readonly type: string;
  readonly payload: JsonObject;
  readonly correlationId: string;
  readonly causationId: string | null;
}

/** Base en mémoire : `notification_dispatch` (unicité 17 §3.2.12), tâches et outbox. */
export class MemoryDb implements SqlClient {
  readonly dispatches: MemoryDispatch[] = [];
  readonly jobs: MemoryJob[] = [];
  readonly events: MemoryEvent[] = [];

  query<R>(text: string, params: readonly unknown[] = []): Promise<SqlResult<R>> {
    const sql = text.replace(/\s+/g, ' ').trim();
    const p = params as unknown[];
    const result = (rows: unknown[]): Promise<SqlResult<R>> =>
      Promise.resolve({ rows: rows as R[], rowCount: rows.length });

    if (sql.startsWith('INSERT INTO core.ntf_notification_dispatch')) {
      const [eventId, eventType, country, correlation, recipient, role, channel, template] =
        p as string[];
      const exists = this.dispatches.some(
        (d) => d.event_id === eventId && d.recipient_user_id === recipient && d.channel === channel,
      );
      if (exists) return result([]);
      const row: MemoryDispatch = {
        id: randomUUID(),
        event_id: eventId as string,
        event_type: eventType as string,
        country_code: (country ?? null) as string | null,
        correlation_id: correlation as string,
        recipient_user_id: recipient as string,
        recipient_role: role as string,
        channel: channel as MessageChannelKind,
        template_key: template as string,
        template_version: p[8] as number,
        variables: JSON.parse(p[9] as string) as Record<string, unknown>,
        status: 'QUEUED',
        attempts: 0,
        locale: null,
        provider_message_id: null,
        rendered_hash: null,
        last_error: null,
        fallback_of: (p[10] ?? null) as string | null,
      };
      this.dispatches.push(row);
      return result([{ id: row.id }]);
    }
    if (sql.startsWith('SELECT id::text, event_id::text')) {
      const row = this.dispatches.find((d) => d.id === p[0] && d.status === 'QUEUED');
      return result(row ? [{ ...row }] : []);
    }
    if (sql.startsWith('SELECT id::text AS id FROM core.ntf_notification_dispatch')) {
      const row = this.dispatches.find(
        (d) => d.event_id === p[0] && d.recipient_user_id === p[1] && d.channel === p[2],
      );
      return result(row ? [{ id: row.id }] : []);
    }
    if (sql.startsWith('UPDATE core.ntf_notification_dispatch')) {
      const row = this.dispatches.find((d) => d.id === p[0]);
      if (!row || row.status !== 'QUEUED') return result([]);
      row.status = p[1] as string;
      row.attempts = p[2] as number;
      row.locale = p[3] as string | null;
      row.provider_message_id = p[4] as string | null;
      row.rendered_hash = p[5] as Buffer | null;
      row.last_error = p[6] as string | null;
      return result([]);
    }
    if (sql.startsWith('SELECT core.outbox_enqueue')) {
      const key = (p[2] ?? null) as string | null;
      if (key !== null && this.jobs.some((j) => j.name === p[0] && j.singletonKey === key)) {
        return result([{ added: false }]);
      }
      this.jobs.push({
        name: p[0] as string,
        payload: JSON.parse(p[1] as string) as JsonObject,
        singletonKey: key,
        delaySeconds: p[5] as number,
      });
      return result([{ added: true }]);
    }
    if (sql.startsWith('SELECT platform.uuid_v7()')) return result([{ id: randomUUID() }]);
    if (sql.startsWith('INSERT INTO core.outbox_outbox_event')) {
      this.events.push({
        type: p[1] as string,
        payload: JSON.parse(p[11] as string) as JsonObject,
        correlationId: p[9] as string,
        causationId: (p[10] ?? null) as string | null,
      });
      return result([]);
    }
    throw new Error(`MemoryDb : requête non prise en charge : ${sql.slice(0, 60)}`);
  }

  /** Tâches `ntf_sender` pas encore exécutées par `drain`. */
  pendingSends(): MemoryJob[] {
    return this.jobs.filter((j) => j.name === 'ntf_sender' && !this.#done.has(j));
  }

  readonly #done = new Set<MemoryJob>();
  markDone(job: MemoryJob): void {
    this.#done.add(job);
  }
}

/** Plafond SMS en mémoire (US-052) : `cap` envois non critiques par pays ; critiques comptés. */
export class MemorySmsBudget implements SmsBudget {
  readonly sent = new Map<string, number>();
  readonly alerts: string[] = [];
  cap: number;
  fail = false;

  constructor(cap = Number.MAX_SAFE_INTEGER) {
    this.cap = cap;
  }

  reserve(
    _tx: unknown,
    input: { readonly country: string; readonly critical: boolean },
  ): Promise<SmsReserveResult> {
    if (this.fail) return Promise.reject(new Error('compteur indisponible'));
    const n = this.sent.get(input.country) ?? 0;
    if (!input.critical && n >= this.cap) {
      const alert = !this.alerts.includes(input.country);
      if (alert) this.alerts.push(input.country);
      return Promise.resolve({ allowed: false, alert });
    }
    this.sent.set(input.country, n + 1);
    return Promise.resolve({ allowed: true, alert: false });
  }
}

export interface SenderHarness {
  readonly email: FakeMessagingChannel;
  readonly sms: FakeMessagingChannel;
  readonly directory: MemoryDirectory;
  readonly smsBudget: MemorySmsBudget;
  readonly logs: NtfLogEntry[];
  readonly deps: NotificationSenderDeps;
}

export function senderHarness(): SenderHarness {
  const clock = new FakeClock('2026-11-03T12:00:00Z');
  const email = new FakeMessagingChannel({ clock, channel: 'EMAIL' });
  const sms = new FakeMessagingChannel({ clock, channel: 'SMS' });
  const directory = new MemoryDirectory();
  const smsBudget = new MemorySmsBudget();
  const logs: NtfLogEntry[] = [];
  return {
    email,
    sms,
    directory,
    smsBudget,
    logs,
    deps: {
      channels: { EMAIL: email, SMS: sms },
      directory,
      smsBudget,
      countryOf: COUNTRY_DATA.countryOf,
      exponentOf: COUNTRY_DATA.exponentOf,
      localeConfig: LOCALE_CONFIG,
      brand: TEST_BRAND,
      log: (entry) => logs.push(entry),
    },
  };
}
