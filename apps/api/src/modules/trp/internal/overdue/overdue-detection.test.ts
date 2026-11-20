import { describe, expect, it } from 'vitest';
import { assertSafeAlert, BusRegistry } from '../../../bus/index.js';
import type {
  AlertChannel,
  DomainEvent,
  OpsAlert,
  SqlClient,
  WorkerTransactions,
} from '../../../bus/index.js';
import { CountryConfigService } from '../../../cfg/index.js';
import {
  alertOps,
  OverdueDetector,
  parseDetection,
  registerOverdueDetection,
  TRIP_AT_RISK_FLAGGED_EVENT,
  TRIP_OVERDUE_ALERT_WORKER,
  TRIP_OVERDUE_DEFAULTS,
  TRIP_OVERDUE_DETECTED_EVENT,
  TRIP_OVERDUE_WORKER,
} from './overdue-detection.js';

/** Deux pays de la configuration (données CFG, jamais une constante du code). */
const [C1 = '', C2 = ''] = [...new CountryConfigService().config.countries.keys()];

class RecordingAlerts implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  send(alert: OpsAlert): Promise<void> {
    // même contrôle que tout canal : comptes et codes seulement (17 §6.3)
    assertSafeAlert(alert);
    this.sent.push(alert);
    return Promise.resolve();
  }
}

const TRIPS = [
  '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a61',
  '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a62',
  '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a63',
  '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a64',
];

const pgError = (code: string): Error => Object.assign(new Error(`sql ${code}`), { code });

/** Base simulée : liste des trips puis une réponse (ou une erreur) par appel de la commande. */
function fakeDb(answers: readonly (Record<string, unknown> | Error)[]) {
  const calls: { worker: string; sql: string; params: readonly unknown[] }[] = [];
  const queue = [...answers];
  const listTx: SqlClient = {
    query: <R>(text: string, params?: readonly unknown[]) => {
      calls.push({ worker: 'list', sql: text, params: params ?? [] });
      const rows = TRIPS.slice(0, answers.length).map((trip_id) => ({ trip_id })) as R[];
      return Promise.resolve({ rows, rowCount: rows.length });
    },
  };
  const transactions: WorkerTransactions = {
    run: async (worker, fn) =>
      fn({
        query: <R>(text: string, params?: readonly unknown[]) => {
          calls.push({ worker, sql: text, params: params ?? [] });
          const next = queue.shift();
          if (next instanceof Error) return Promise.reject(next);
          const rows = [{ r: next }] as R[];
          return Promise.resolve({ rows, rowCount: 1 });
        },
      }),
  };
  return { calls, listTx, transactions };
}

const event = (type: string, countryCode: string | null): DomainEvent =>
  ({
    eventId: '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a70',
    type,
    schemaVersion: 1,
    occurredAt: '2036-06-04T15:30:00.000Z',
    aggregateType: 'trip',
    aggregateId: TRIPS[0],
    aggregateVersion: 3n,
    countryCode,
    actor: 'SYSTEM',
    correlationId: '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a71',
    causationId: null,
    payload: { trip_id: TRIPS[0] ?? '', stage: 'T30M' },
    partitionKey: null,
  }) as DomainEvent;

describe('détection des retards (US-305, ADR-188)', () => {
  it('un passage : la base liste, un trip par transaction sous trip_overdue ; issues comptées ; un échec ne bloque pas les suivants et est alerté par son code seul', async () => {
    const alerts = new RecordingAlerts();
    const logs: string[] = [];
    const db = fakeDb([
      { outcome: 'DETECTED', nextAtRisk: false },
      pgError('55000'),
      { outcome: 'UNCHANGED', nextAtRisk: true },
      { outcome: 'EXTENDED', nextAtRisk: false },
    ]);
    const detector = new OverdueDetector({
      transactions: db.transactions,
      alerts,
      log: (l) => logs.push(l),
    });
    const counts = await detector.runPass(db.listTx);
    expect(counts).toEqual({
      candidates: 4,
      detected: 1,
      extended: 1,
      next_at_risk: 1,
      unchanged: 1,
      failed: 1,
    });
    expect(db.calls[0]).toMatchObject({
      worker: 'list',
      sql: 'SELECT trip_id FROM core.trip_overdue_due($1)',
      params: [TRIP_OVERDUE_DEFAULTS.batch],
    });
    expect(db.calls.slice(1).map((c) => [c.worker, c.params[0]])).toEqual(
      TRIPS.map((t) => [TRIP_OVERDUE_WORKER, t]),
    );
    expect(alerts.sent).toEqual([
      {
        code: 'TRIP_OVERDUE_FAILED',
        severity: 'P1',
        counts: { failed: 1 },
        labels: { error_code: 'SQL_55000' },
      },
    ]);
    // journaux : des comptes et des codes, jamais un identifiant (17 §6.3)
    for (const l of logs) for (const t of TRIPS) expect(l).not.toContain(t);
  });

  it('interblocage (40P01) rejoué au plus 3 fois, dans une transaction neuve à chaque essai', async () => {
    const db = fakeDb([pgError('40P01'), pgError('40P01'), { outcome: 'DETECTED' }]);
    const list: SqlClient = {
      query: <R>() => Promise.resolve({ rows: [{ trip_id: TRIPS[0] }] as R[], rowCount: 1 }),
    };
    const alerts = new RecordingAlerts();
    const counts = await new OverdueDetector({
      transactions: db.transactions,
      alerts,
      log: () => undefined,
    }).runPass(list);
    expect(counts).toMatchObject({ detected: 1, failed: 0 });
    expect(db.calls).toHaveLength(3);
    expect(alerts.sent).toEqual([]);
  });

  it('réponse de la base inattendue : erreur, jamais une issue devinée', () => {
    expect(() => parseDetection(null)).toThrow(TypeError);
    expect(() => parseDetection({ outcome: 'OVERDUE_MAYBE' })).toThrow(TypeError);
    expect(parseDetection({ outcome: 'NOT_DUE' })).toEqual({
      outcome: 'NOT_DUE',
      nextAtRisk: false,
    });
  });

  it('alerte de l’ops : une par événement, pays de l’événement ; P2 pour le retard, P1 pour le trip suivant à risque ; pays absent ou type inconnu : erreur de contrat', async () => {
    const alerts = new RecordingAlerts();
    await alertOps(event(TRIP_OVERDUE_DETECTED_EVENT, C1), alerts);
    await alertOps(event(TRIP_AT_RISK_FLAGGED_EVENT, C2), alerts);
    expect(alerts.sent).toEqual([
      {
        code: 'TRIP_OVERDUE_DETECTED',
        severity: 'P2',
        counts: { overdue: 1 },
        labels: { country: C1 },
      },
      {
        code: 'TRIP_NEXT_AT_RISK',
        severity: 'P1',
        counts: { at_risk: 1 },
        labels: { country: C2 },
      },
    ]);
    await expect(alertOps(event(TRIP_OVERDUE_DETECTED_EVENT, null), alerts)).rejects.toThrow(
      TypeError,
    );
    await expect(alertOps(event('trip.status_changed', C1), alerts)).rejects.toThrow(TypeError);
    expect(alerts.sent).toHaveLength(2);
  });

  it('déclarées au registre : tâche périodique de 60 s et consommateur des deux événements', () => {
    const registry = new BusRegistry();
    const db = fakeDb([]);
    registerOverdueDetection(registry, db.transactions, new RecordingAlerts(), () => undefined);
    expect(registry.queueNames()).toEqual([TRIP_OVERDUE_WORKER, TRIP_OVERDUE_ALERT_WORKER]);
    expect(registry.periodicTasks()).toEqual([
      { name: TRIP_OVERDUE_WORKER, spec: { periodSeconds: 60, maxAttempts: 5 } },
    ]);
    expect(registry.consumersOf(TRIP_OVERDUE_DETECTED_EVENT)).toEqual([TRIP_OVERDUE_ALERT_WORKER]);
    expect(registry.consumersOf(TRIP_AT_RISK_FLAGGED_EVENT)).toEqual([TRIP_OVERDUE_ALERT_WORKER]);
  });
});
