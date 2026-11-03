/**
 * US-008 — module BUS de bout en bout sur PostgreSQL réel, sous les rôles de production
 * (CLAUDE.md point 6 : `connectAs` exécute l'assertion L0-05 en tête de chaque test).
 *
 * Critères (19 US-008 ; 17 §4.2) :
 * - « Given une transaction annulée, When elle publie un événement, Then aucun événement n'est
 *   émis » : publishEvent dans une transaction app_api annulée ⇒ le relais ne livre rien ;
 * - « Given un événement rejoué, When il est reçu, Then inbox_receipt empêche le double
 *   traitement ; après N échecs, il passe en dead_letter avec alerte » : N = 5 (17 §4.2).
 * Chaque cas tourne en USD (PA) et en PYG sans décimale (PY) ; montants en unités mineures.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { connectAs, releaseClient } from '@rueda/db/testing';
import type {
  DeadLetterAlert,
  DomainEvent,
  LeasedSqlClient,
  NewDomainEvent,
  SqlClient,
} from '../../src/modules/bus/index.js';
import {
  BusRegistry,
  JobRunner,
  OutboxRelay,
  publishEvent,
  scheduleJob,
  SPEC_MAX_ATTEMPTS,
  workerTransactions,
} from '../../src/modules/bus/index.js';

const CASES = [
  { country: 'PA', currency: 'USD', amountMinor: '12000' },
  { country: 'PY', currency: 'PYG', amountMinor: '850000' },
] as const;

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

/** Transaction de l'API (acteur GUEST), validée ou annulée. */
async function apiTx<T>(
  client: pg.Client,
  commit: boolean,
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT pg_catalog.set_config('app.actor_kind', 'GUEST', true)`);
    const out = await fn(asSql(client));
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

const consumerName = (prefix: string): string => `${prefix}_${randomBytes(6).toString('hex')}`;
/** Type propre au test : les événements des autres tests n'ont pas d'abonné ici. */
const eventType = (): string => `booking.trip.booked_${randomBytes(4).toString('hex')}`;

const newEvent = (type: string, c: (typeof CASES)[number]): NewDomainEvent => {
  const tripId = randomUUID();
  return {
    type,
    schemaVersion: 1,
    aggregateType: 'trip',
    aggregateId: tripId,
    aggregateVersion: 1n,
    countryCode: c.country,
    actor: { userId: randomUUID(), role: 'GUEST' },
    correlationId: randomUUID(),
    payload: { trip_id: tripId, currency: c.currency, amount_minor: c.amountMinor },
  };
};

class RecordingAlerter {
  readonly alerts: DeadLetterAlert[] = [];
  deadLetter(alert: DeadLetterAlert): void {
    this.alerts.push(alert);
  }
}

describe.each(CASES)('BUS sur PostgreSQL réel — $country ($currency)', (c) => {
  it('transaction annulée : aucun événement émis ; transaction validée : livré une fois au consommateur', async () => {
    const api = await open('app_api');
    const worker = await open('app_worker');
    const tx = workerTransactions(() => Promise.resolve(asSql(worker)));
    const type = eventType();
    const consumer = consumerName('ntf_it');
    const seen: DomainEvent[] = [];
    const registry = new BusRegistry();
    registry.registerConsumer(consumer, [type], (event) => {
      seen.push(event);
      return Promise.resolve();
    });

    const rolledBack = await apiTx(api, false, (sql) => publishEvent(sql, newEvent(type, c)));
    const committed = await apiTx(api, true, (sql) => publishEvent(sql, newEvent(type, c)));
    expect(rolledBack).toMatch(/^[0-9a-f-]{36}$/);

    const relay = new OutboxRelay(tx, registry);
    let deliveries = 0;
    for (let r = await relay.runOnce(); r.published > 0; r = await relay.runOnce()) {
      deliveries += r.deliveries;
    }
    expect(deliveries).toBe(1);

    const runner = new JobRunner(tx, registry, new RecordingAlerter());
    const result = await runner.runOnce(consumer);
    expect(result.outcomes.map((o) => o.outcome)).toEqual(['PROCESSED']);
    expect(seen.map((e) => e.eventId)).toEqual([committed]);
    expect(seen[0]?.payload).toEqual(
      expect.objectContaining({ currency: c.currency, amount_minor: c.amountMinor }),
    );
    expect(seen[0]?.countryCode).toBe(c.country);
    expect(seen.map((e) => e.eventId)).not.toContain(rolledBack);
    // rien d'autre à traiter
    expect((await runner.runOnce(consumer)).outcomes).toEqual([]);
  });

  it('événement rejoué : inbox_receipt empêche le double traitement', async () => {
    const api = await open('app_api');
    const worker = await open('app_worker');
    const tx = workerTransactions(() => Promise.resolve(asSql(worker)));
    const type = eventType();
    const consumer = consumerName('ctr_it');
    let calls = 0;
    const registry = new BusRegistry();
    registry.registerConsumer(consumer, [type], () => {
      calls++;
      return Promise.resolve();
    });

    const eventId = await apiTx(api, true, (sql) => publishEvent(sql, newEvent(type, c)));
    const relay = new OutboxRelay(tx, registry);
    while ((await relay.runOnce()).published > 0) {
      /* vider l'outbox */
    }
    const runner = new JobRunner(tx, registry, new RecordingAlerter());
    expect((await runner.runOnce(consumer)).outcomes.map((o) => o.outcome)).toEqual(['PROCESSED']);

    // rejeu : nouvelle livraison du même événement (même enveloppe), comme un relais rejoué
    await tx.run(consumer, async (sql) => {
      const { rows } = await sql.query<{ payload: { event: unknown } }>(
        'SELECT payload FROM core.outbox_scheduled_job WHERE event_id = $1::uuid LIMIT 1',
        [eventId],
      );
      expect(rows).toHaveLength(1);
      const added = await scheduleJob(sql, {
        name: consumer,
        payload: rows[0]?.payload as never,
        singletonKey: eventId,
        eventId,
      });
      expect(added).toBe(true);
    });
    expect((await runner.runOnce(consumer)).outcomes.map((o) => o.outcome)).toEqual(['DUPLICATE']);
    expect(calls).toBe(1);

    const receipts = await tx.run(consumer, (sql) =>
      sql.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM core.outbox_inbox_receipt WHERE event_id = $1::uuid',
        [eventId],
      ),
    );
    expect(receipts.rows[0]?.n).toBe(1);
  });

  it(`après ${SPEC_MAX_ATTEMPTS} échecs : dead_letter et une seule alerte ; aucun reçu, aucune écriture du gestionnaire`, async () => {
    const api = await open('app_api');
    const worker = await open('app_worker');
    const tx = workerTransactions(() => Promise.resolve(asSql(worker)));
    const type = eventType();
    const consumer = consumerName('stl_it');
    let calls = 0;
    const registry = new BusRegistry();
    registry.registerConsumer(consumer, [type], async (_event, sql) => {
      calls++;
      // écriture du gestionnaire (un reçu d'un autre événement) : doit être annulée avec l'échec
      await sql.query('SELECT core.outbox_begin_receipt($1::uuid)', [randomUUID()]);
      throw new RangeError('panne simulée');
    });

    const eventId = await apiTx(api, true, (sql) => publishEvent(sql, newEvent(type, c)));
    const relay = new OutboxRelay(tx, registry);
    while ((await relay.runOnce()).published > 0) {
      /* vider l'outbox */
    }
    const alerter = new RecordingAlerter();
    // attente de base 0 s : chaque nouvelle tentative est échue tout de suite
    const runner = new JobRunner(tx, registry, alerter, { backoffBaseSeconds: 0 });
    const outcomes: string[] = [];
    for (let i = 0; i < SPEC_MAX_ATTEMPTS + 1; i++) {
      outcomes.push(...(await runner.runOnce(consumer)).outcomes.map((o) => o.outcome));
    }
    expect(outcomes).toEqual(['RETRY', 'RETRY', 'RETRY', 'RETRY', 'DEAD_LETTER']);
    expect(calls).toBe(SPEC_MAX_ATTEMPTS);
    expect(alerter.alerts).toEqual([
      expect.objectContaining({
        consumer,
        eventId,
        attempts: SPEC_MAX_ATTEMPTS,
        errorCode: 'RangeError',
      }),
    ]);

    await tx.run(consumer, async (sql) => {
      const dead = await sql.query<{ attempts: number; last_error: string }>(
        'SELECT attempts, last_error FROM core.outbox_dead_letter WHERE event_id = $1::uuid',
        [eventId],
      );
      expect(dead.rows).toEqual([{ attempts: SPEC_MAX_ATTEMPTS, last_error: 'RangeError' }]);
      const receipts = await sql.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM core.outbox_inbox_receipt',
      );
      expect(receipts.rows[0]?.n).toBe(0);
    });
  });
});
