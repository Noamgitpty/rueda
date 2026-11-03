/**
 * Tests unitaires (sans base) du publieur, du relais, de l'exécuteur de files et des transactions
 * de travailleur. Le comportement SQL (RLS, SKIP LOCKED, reçus, lettres mortes) est prouvé sur
 * PostgreSQL réel : packages/db/test (int, l0) et apps/api/test/int.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DeadLetterAlert } from './alerts.js';
import { LogAlerter } from './alerts.js';
import { countryCases, FakeTransactions, ScriptedSql } from './doubles.test-support.js';
import type { DomainEvent, OutboxEventRow } from './envelope.js';
import { EnvelopeError, rowToEnvelope } from './envelope.js';
import { JobRunner } from './job-runner.js';
import { metricsLogLine, toSnapshot } from './metrics.js';
import { PeriodicScheduler } from './periodic.js';
import { publishEvent } from './publisher.js';
import { BUS_SCHEDULER_WORKER, BusRegistry, OUTBOX_RELAY_WORKER } from './registry.js';
import { OutboxRelay } from './relay.js';
import { scheduleJob } from './scheduler.js';
import { workerTransactions } from './sql.js';

// Pays configurés (données CFG) : USD et PYG sans décimale (CLAUDE.md point 3).
const CASES = countryCases();

const EVENT_ID = '0190a5c4-3333-7000-8000-000000000003';
const JOB_ID = '0190a5c4-7777-7000-8000-000000000007';

const row = (
  country: string,
  currency: string,
  amountMinor: string,
  partitionKey: string | null = null,
): OutboxEventRow => ({
  id: EVENT_ID,
  type: 'booking.trip.booked',
  schema_version: 1,
  occurred_at: new Date('2031-07-01T08:00:00.000Z'),
  aggregate_type: 'trip',
  aggregate_id: '0190a5c4-4444-7000-8000-000000000004',
  aggregate_version: '1',
  country_code: country,
  actor_user_id: null,
  actor_role: 'SYSTEM',
  correlation_id: '0190a5c4-6666-7000-8000-000000000006',
  causation_id: null,
  payload: { currency, amount_minor: amountMinor },
  partition_key: partitionKey,
});

class RecordingAlerter {
  readonly alerts: DeadLetterAlert[] = [];
  deadLetter(alert: DeadLetterAlert): void {
    this.alerts.push(alert);
  }
}

describe.each(CASES)('BUS — $country ($currency)', ({ country, currency, amountMinor }) => {
  describe('publishEvent', () => {
    it("demande l'identifiant à la base puis insère l'enveloppe dans la transaction donnée", async () => {
      const sql = new ScriptedSql().on(/platform\.uuid_v7/, [{ id: EVENT_ID }]);
      const id = await publishEvent(sql, {
        type: 'booking.trip.booked',
        schemaVersion: 1,
        aggregateType: 'trip',
        aggregateId: '0190a5c4-4444-7000-8000-000000000004',
        aggregateVersion: 7n,
        countryCode: country,
        actor: { userId: '0190a5c4-5555-7000-8000-000000000005', role: 'HOST' },
        correlationId: '0190a5c4-6666-7000-8000-000000000006',
        payload: { currency, amount_minor: amountMinor },
      });
      expect(id).toBe(EVENT_ID);
      expect(sql.calls).toHaveLength(2);
      const insert = sql.calls[1];
      expect(insert?.text).toMatch(/INSERT INTO core\.outbox_outbox_event/);
      expect(insert?.text).not.toMatch(/occurred_at|published_at|created_at/);
      expect(insert?.params).toEqual([
        EVENT_ID,
        'booking.trip.booked',
        1,
        'trip',
        '0190a5c4-4444-7000-8000-000000000004',
        '7',
        country,
        '0190a5c4-5555-7000-8000-000000000005',
        'HOST',
        '0190a5c4-6666-7000-8000-000000000006',
        null,
        JSON.stringify({ currency, amount_minor: amountMinor }),
        null,
      ]);
    });

    it('enveloppe invalide : aucune requête', async () => {
      const sql = new ScriptedSql();
      await expect(
        publishEvent(sql, {
          type: 'BAD',
          schemaVersion: 1,
          aggregateType: 'trip',
          aggregateId: '0190a5c4-4444-7000-8000-000000000004',
          aggregateVersion: 1n,
          countryCode: country,
          actor: 'SYSTEM',
          correlationId: '0190a5c4-6666-7000-8000-000000000006',
          payload: {},
        }),
      ).rejects.toBeInstanceOf(EnvelopeError);
      expect(sql.calls).toEqual([]);
    });
  });

  describe('OutboxRelay', () => {
    it("une tâche par consommateur abonné (clé = event_id), puis publication, dans la transaction d'outbox_relay", async () => {
      const registry = new BusRegistry();
      registry.registerConsumer('ntf_trip_booked', ['booking.trip.booked'], () =>
        Promise.resolve(),
      );
      registry.registerConsumer('ctr_contract', ['booking.trip.booked'], () => Promise.resolve());
      registry.registerConsumer('rpt_other', ['review.published'], () => Promise.resolve());
      const sql = new ScriptedSql()
        .on(/outbox_relay_claim/, [
          row(country, currency, amountMinor) as unknown as Record<string, unknown>,
        ])
        .on(/outbox_enqueue/, [{ added: true }]);
      const tx = new FakeTransactions(sql);
      const result = await new OutboxRelay(tx, registry).runOnce();

      expect(result).toEqual({ published: 1, deliveries: 2 });
      expect(new Set(sql.calls.map((c) => c.worker))).toEqual(new Set([OUTBOX_RELAY_WORKER]));
      const enqueues = sql.matching(/outbox_enqueue/);
      expect(enqueues.map((c) => c.params[0])).toEqual(['ctr_contract', 'ntf_trip_booked']);
      for (const call of enqueues) {
        expect(call.params.slice(2)).toEqual([EVENT_ID, EVENT_ID, 5]);
        expect(JSON.parse(call.params[1] as string)).toEqual({
          event: rowToEnvelope(row(country, currency, amountMinor)),
        });
      }
      expect(sql.matching(/outbox_mark_published/).map((c) => c.params)).toEqual([[[EVENT_ID]]]);
      expect(tx.log).toEqual([{ worker: OUTBOX_RELAY_WORKER, outcome: 'commit' }]);
    });

    it('outbox vide : ni tâche ni publication', async () => {
      const sql = new ScriptedSql();
      const result = await new OutboxRelay(new FakeTransactions(sql), new BusRegistry()).runOnce();
      expect(result).toEqual({ published: 0, deliveries: 0 });
      expect(sql.matching(/outbox_mark_published|outbox_enqueue/)).toEqual([]);
    });

    it("échec : rien n'est publié (ROLLBACK), échec consigné à part avec un code court, erreur relancée", async () => {
      const registry = new BusRegistry();
      registry.registerConsumer('ntf_trip_booked', ['booking.trip.booked'], () =>
        Promise.resolve(),
      );
      const boom = Object.assign(new Error('détail sensible'), { code: '40P01' });
      const sql = new ScriptedSql()
        .on(/outbox_relay_claim/, [
          row(country, currency, amountMinor) as unknown as Record<string, unknown>,
        ])
        .on(/outbox_enqueue/, () => boom);
      const tx = new FakeTransactions(sql);
      await expect(new OutboxRelay(tx, registry).runOnce()).rejects.toBe(boom);
      expect(tx.log.map((l) => l.outcome)).toEqual(['rollback', 'commit']);
      expect(sql.matching(/outbox_record_relay_failure/).map((c) => c.params)).toEqual([
        [[EVENT_ID], 'SQLSTATE_40P01'],
      ]);
    });
  });

  describe('JobRunner', () => {
    const job = (partitionKey: string | null = null) => ({
      id: JOB_ID,
      event_id: EVENT_ID,
      attempts: 1,
      payload: { event: rowToEnvelope(row(country, currency, amountMinor, partitionKey)) },
    });

    const setup = (fresh: boolean, failOutcome = 'RETRY', partitionKey: string | null = null) => {
      const registry = new BusRegistry();
      const seen: DomainEvent[] = [];
      let fail = false;
      registry.registerConsumer('ntf_trip_booked', ['booking.trip.booked'], (event) => {
        seen.push(event);
        return fail ? Promise.reject(new TypeError('panne')) : Promise.resolve();
      });
      const sql = new ScriptedSql()
        .on(/outbox_claim_jobs/, [job(partitionKey)])
        .on(/outbox_begin_receipt/, [{ fresh }])
        .on(/outbox_complete_job/, [{ ok: true }])
        .on(/outbox_fail_job/, [{ outcome: failOutcome }]);
      const tx = new FakeTransactions(sql);
      const alerter = new RecordingAlerter();
      const runner = new JobRunner(tx, registry, alerter, { backoffBaseSeconds: 30 });
      return {
        sql,
        tx,
        seen,
        alerter,
        runner,
        failNext: () => {
          fail = true;
        },
      };
    };

    it('premier traitement : reçu, gestionnaire dans la même transaction, tâche terminée', async () => {
      const { sql, seen, runner, tx } = setup(true);
      const result = await runner.runOnce('ntf_trip_booked');
      expect(result.outcomes).toEqual([{ jobId: JOB_ID, outcome: 'PROCESSED' }]);
      expect(seen.map((e) => [e.eventId, e.countryCode, e.payload])).toEqual([
        [EVENT_ID, country, { currency, amount_minor: amountMinor }],
      ]);
      expect(sql.matching(/outbox_begin_receipt/).map((c) => c.params)).toEqual([[EVENT_ID]]);
      expect(new Set(sql.calls.map((c) => c.worker))).toEqual(new Set(['ntf_trip_booked']));
      expect(tx.log.every((l) => l.outcome === 'commit')).toBe(true);
    });

    it('événement rejoué (reçu existant) : gestionnaire non appelé, tâche terminée', async () => {
      const { sql, seen, runner } = setup(false);
      const result = await runner.runOnce('ntf_trip_booked');
      expect(result.outcomes).toEqual([{ jobId: JOB_ID, outcome: 'DUPLICATE' }]);
      expect(seen).toEqual([]);
      expect(sql.matching(/outbox_complete_job/)).toHaveLength(1);
    });

    it('échec avec tentatives restantes : ROLLBACK, outbox_fail_job (code court, attente de base), aucune alerte', async () => {
      const { sql, runner, alerter, failNext, tx } = setup(true, 'RETRY');
      failNext();
      const result = await runner.runOnce('ntf_trip_booked');
      expect(result.outcomes).toEqual([{ jobId: JOB_ID, outcome: 'RETRY' }]);
      expect(tx.log.map((l) => l.outcome)).toEqual(['commit', 'commit', 'rollback', 'commit']);
      expect(sql.matching(/outbox_fail_job/).map((c) => c.params)).toEqual([
        [JOB_ID, 'TypeError', 30],
      ]);
      expect(sql.matching(/outbox_complete_job/)).toEqual([]);
      expect(alerter.alerts).toEqual([]);
    });

    it('dernière tentative échouée : DEAD_LETTER et une alerte (identifiants seulement)', async () => {
      const { runner, alerter, failNext } = setup(true, 'DEAD_LETTER');
      failNext();
      const result = await runner.runOnce('ntf_trip_booked');
      expect(result.outcomes).toEqual([{ jobId: JOB_ID, outcome: 'DEAD_LETTER' }]);
      expect(alerter.alerts).toEqual([
        {
          consumer: 'ntf_trip_booked',
          eventId: EVENT_ID,
          jobId: JOB_ID,
          attempts: 1,
          errorCode: 'TypeError',
        },
      ]);
    });

    it("clé de partition : verrou consultatif de l'agrégat avant le reçu (F32)", async () => {
      const key = '0190a5c4-4444-7000-8000-000000000004';
      const { sql, runner } = setup(true, 'RETRY', key);
      await runner.runOnce('ntf_trip_booked');
      const texts = sql.calls.map((c) => c.text);
      const lock = texts.findIndex((t) => /pg_advisory_xact_lock/.test(t));
      const receipt = texts.findIndex((t) => /outbox_begin_receipt/.test(t));
      expect(lock).toBeGreaterThan(-1);
      expect(lock).toBeLessThan(receipt);
      expect(sql.matching(/pg_advisory_xact_lock/)[0]?.params).toEqual([`bus:${key}`]);
    });

    it('bail expiré sur la dernière tentative : alerte pour chaque lettre morte récupérée', async () => {
      const { sql, runner, alerter } = setup(true);
      sql.on(/outbox_reap_expired_jobs/, [
        {
          consumer: 'ntf_trip_booked',
          event_id: EVENT_ID,
          job_id: JOB_ID,
          attempts: 5,
          last_error: 'LEASE_EXPIRED',
        },
      ]);
      // la règle de réclamation, déclarée avant, ne correspond pas au texte du balayage
      const result = await runner.runOnce('ntf_trip_booked');
      expect(result.reaped).toBe(1);
      expect(alerter.alerts).toEqual([
        {
          consumer: 'ntf_trip_booked',
          eventId: EVENT_ID,
          jobId: JOB_ID,
          attempts: 5,
          errorCode: 'LEASE_EXPIRED',
        },
      ]);
    });

    it('une alerte qui échoue ne bloque pas la file', async () => {
      const registry = new BusRegistry();
      registry.registerConsumer('ntf_trip_booked', ['booking.trip.booked'], () =>
        Promise.reject(new TypeError('panne')),
      );
      const sql = new ScriptedSql()
        .on(/outbox_claim_jobs/, [job()])
        .on(/outbox_begin_receipt/, [{ fresh: true }])
        .on(/outbox_fail_job/, [{ outcome: 'DEAD_LETTER' }]);
      const runner = new JobRunner(new FakeTransactions(sql), registry, {
        deadLetter: () => Promise.reject(new Error('canal indisponible')),
      });
      await expect(runner.runOnce('ntf_trip_booked')).resolves.toMatchObject({
        outcomes: [{ jobId: JOB_ID, outcome: 'DEAD_LETTER' }],
      });
    });

    it('minuterie : gestionnaire avec la charge utile, sans reçu', async () => {
      const registry = new BusRegistry();
      const payloads: unknown[] = [];
      registry.registerTimer('trp_checkin_open', (payload) => {
        payloads.push(payload);
        return Promise.resolve();
      });
      const sql = new ScriptedSql()
        .on(/outbox_claim_jobs/, [
          { id: JOB_ID, event_id: null, attempts: 1, payload: { trip_id: 'x' } },
        ])
        .on(/outbox_complete_job/, [{ ok: true }]);
      const result = await new JobRunner(
        new FakeTransactions(sql),
        registry,
        new RecordingAlerter(),
      ).runOnce('trp_checkin_open');
      expect(result.outcomes).toEqual([{ jobId: JOB_ID, outcome: 'PROCESSED' }]);
      expect(payloads).toEqual([{ trip_id: 'x' }]);
      expect(sql.matching(/outbox_begin_receipt/)).toEqual([]);
    });
  });
});

describe('BusRegistry', () => {
  it('refuse le nom du relais, un doublon, un nom hors format, un type mal formé', () => {
    const r = new BusRegistry();
    const noop = () => Promise.resolve();
    expect(() => {
      r.registerConsumer(OUTBOX_RELAY_WORKER, ['booking.trip.booked'], noop);
    }).toThrow();
    r.registerConsumer('ntf_a', ['booking.trip.booked'], noop);
    expect(() => {
      r.registerTimer('ntf_a', noop);
    }).toThrow();
    expect(() => {
      r.registerConsumer('Ntf-B', ['booking.trip.booked'], noop);
    }).toThrow();
    expect(() => {
      r.registerConsumer('ntf_c', ['Booking'], noop);
    }).toThrow();
    expect(r.queueNames()).toEqual(['ntf_a']);
  });
});

describe('scheduleJob', () => {
  it('délai calculé par la base (make_interval), clé et tentatives transmises', async () => {
    const sql = new ScriptedSql().on(/outbox_enqueue/, [{ added: true }]);
    await expect(
      scheduleJob(sql, {
        name: 'trp_overdue',
        payload: { trip_id: 't' },
        singletonKey: 't',
        delaySeconds: 1800,
      }),
    ).resolves.toBe(true);
    expect(sql.calls[0]?.text).toMatch(/make_interval/);
    expect(sql.calls[0]?.params).toEqual([
      'trp_overdue',
      '{"trip_id":"t"}',
      't',
      null,
      null,
      1800,
      5,
    ]);
  });
  it('refuse un délai négatif ou un nombre de tentatives hors bornes', async () => {
    const sql = new ScriptedSql();
    await expect(
      scheduleJob(sql, { name: 'trp_overdue', payload: {}, delaySeconds: -1 }),
    ).rejects.toThrow();
    await expect(
      scheduleJob(sql, { name: 'trp_overdue', payload: {}, maxAttempts: 0 }),
    ).rejects.toThrow();
    expect(sql.calls).toEqual([]);
  });
});

describe('workerTransactions', () => {
  const leased = () => {
    const sql = new ScriptedSql();
    const release = vi.fn();
    return { sql, release, client: Object.assign(sql, { release }) };
  };

  it('BEGIN, contexte WORKER local (set_config … true), fn, COMMIT, connexion rendue', async () => {
    const { sql, release, client } = leased();
    const tx = workerTransactions(() => Promise.resolve(client));
    await expect(tx.run('outbox_relay', () => Promise.resolve(42))).resolves.toBe(42);
    expect(sql.calls.map((c) => c.text.trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'COMMIT',
    ]);
    expect(sql.calls[1]?.text).toMatch(/set_config\('app\.actor_kind', 'WORKER', true\)/);
    expect(sql.calls[1]?.params).toEqual(['outbox_relay']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('échec de fn : ROLLBACK, erreur relancée, connexion rendue', async () => {
    const { sql, release, client } = leased();
    const tx = workerTransactions(() => Promise.resolve(client));
    await expect(tx.run('outbox_relay', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(sql.calls.at(-1)?.text).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it("nom de travailleur hors format : refusé avant d'emprunter une connexion", async () => {
    const connect = vi.fn();
    await expect(
      workerTransactions(connect).run("x'; --", () => Promise.resolve()),
    ).rejects.toThrow(TypeError);
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('LogAlerter', () => {
  it('une ligne JSON, identifiants et code seulement', () => {
    const lines: string[] = [];
    new LogAlerter((l) => lines.push(l)).deadLetter({
      consumer: 'ntf_trip_booked',
      eventId: EVENT_ID,
      jobId: JOB_ID,
      attempts: 5,
      errorCode: 'TypeError',
    });
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      level: 'error',
      alert: 'bus.dead_letter',
      consumer: 'ntf_trip_booked',
      event_id: EVENT_ID,
      job_id: JOB_ID,
      attempts: 5,
      error_code: 'TypeError',
    });
  });
});

describe('PeriodicScheduler', () => {
  it("garantit une occurrence vivante par tâche périodique (clé 'periodic', période, tentatives), sous bus_scheduler", async () => {
    const registry = new BusRegistry();
    const noop = () => Promise.resolve();
    registry.registerPeriodic('disposition_sweeper', 60, noop);
    registry.registerPeriodic('payment_intent_sweeper', 30, noop, { maxAttempts: 3 });
    registry.registerTimer('trp_overdue', noop);
    const sql = new ScriptedSql().on(/outbox_enqueue/, (params) => [
      { added: params[0] === 'disposition_sweeper' },
    ]);
    const tx = new FakeTransactions(sql);
    await expect(new PeriodicScheduler(tx, registry).tick()).resolves.toEqual([
      'disposition_sweeper',
    ]);
    expect(sql.calls.map((c) => c.params)).toEqual([
      ['disposition_sweeper', '{}', 'periodic', null, null, 60, 5],
      ['payment_intent_sweeper', '{}', 'periodic', null, null, 30, 3],
    ]);
    expect(tx.log).toEqual([{ worker: BUS_SCHEDULER_WORKER, outcome: 'commit' }]);
  });

  it('aucune tâche périodique : aucune transaction', async () => {
    const sql = new ScriptedSql();
    const tx = new FakeTransactions(sql);
    await expect(new PeriodicScheduler(tx, new BusRegistry()).tick()).resolves.toEqual([]);
    expect(tx.log).toEqual([]);
  });

  it('refuse une période négative et les noms réservés du module', () => {
    const r = new BusRegistry();
    const noop = () => Promise.resolve();
    expect(() => {
      r.registerPeriodic('x_sweeper', -1, noop);
    }).toThrow();
    expect(() => {
      r.registerPeriodic('bus_scheduler', 60, noop);
    }).toThrow();
    expect(() => {
      r.registerTimer('bus_monitor', noop);
    }).toThrow();
  });
});

describe('métriques', () => {
  it('toSnapshot : outbox et profondeur par file ; ligne JSON sans données métier', () => {
    const snap = toSnapshot([
      { metric: 'outbox_unpublished', queue: null, value: '3' },
      { metric: 'outbox_oldest_age_s', queue: null, value: '125' },
      { metric: 'queue_ready', queue: 'ntf_a', value: '2' },
      { metric: 'queue_oldest_ready_age_s', queue: 'ntf_a', value: '40' },
      { metric: 'dead_letter_open', queue: 'stl_b', value: '1' },
    ]);
    expect(snap).toEqual({
      outboxUnpublished: 3,
      outboxOldestAgeSeconds: 125,
      queues: {
        ntf_a: {
          ready: 2,
          scheduled: 0,
          active: 0,
          failed: 0,
          deadLetters: 0,
          oldestReadyAgeSeconds: 40,
        },
        stl_b: {
          ready: 0,
          scheduled: 0,
          active: 0,
          failed: 0,
          deadLetters: 1,
          oldestReadyAgeSeconds: 0,
        },
      },
    });
    expect(JSON.parse(metricsLogLine(snap))).toMatchObject({
      metric: 'bus.metrics',
      outboxOldestAgeSeconds: 125,
    });
  });
});
