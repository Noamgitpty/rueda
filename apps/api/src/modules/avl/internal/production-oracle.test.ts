/**
 * Tâche de l'oracle C12 (US-025, ADR-068), sans base : lecture fail-closed du rapport, journal sans
 * identifiant, déclaration périodique sur le module BUS. La preuve sur PostgreSQL réel, sous les
 * rôles de production, est dans packages/db/test/l0/l0-c11-fuzz.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { BusRegistry } from '../../bus/index.js';
import type { SqlClient, SqlResult } from '../../bus/index.js';
import {
  BOOKING_ORACLE_WORKER,
  C12_CHECKS,
  oracleLogLine,
  parseOracleReport,
  PRODUCTION_ORACLE_PERIOD_SECONDS,
  ProductionOracleContractError,
  registerProductionOracle,
  runProductionOracle,
} from './production-oracle.js';

const zeros = Object.fromEntries(C12_CHECKS.map((c) => [c, 0]));

class OneRowSql implements SqlClient {
  readonly texts: string[] = [];
  constructor(private readonly report: unknown) {}
  query<R>(text: string): Promise<SqlResult<R>> {
    this.texts.push(text);
    return Promise.resolve({ rows: [{ report: this.report } as R], rowCount: 1 });
  }
}

describe('oracle de production C12 — tâche', () => {
  it('rapport nul : cinq contrôles à 0, pas d’alerte', async () => {
    const sql = new OneRowSql({ checks: zeros, violations: 0, alerted: false, alert_id: null });
    const report = await runProductionOracle(sql);
    expect(sql.texts).toEqual(['SELECT core.booking_production_oracle_alert() AS report']);
    expect(report.violations).toBe(0n);
    expect(report.alerted).toBe(false);
    expect(Object.keys(report.checks)).toEqual([...C12_CHECKS]);
  });

  it('violation : alerte, journal en comptes seulement', () => {
    const report = parseOracleReport({
      checks: { ...zeros, SUCCEEDED_WITHOUT_DISPOSITION: 2, HOLD_WITH_TWO_CONVERSIONS: 1 },
      violations: 3,
      alerted: true,
      alert_id: '2f1b7e0c-6a43-4c55-9a83-0d3f7f1c1e10',
    });
    expect(report.checks.SUCCEEDED_WITHOUT_DISPOSITION).toBe(2n);
    const line = JSON.parse(oracleLogLine(report)) as Record<string, unknown>;
    expect(line).toMatchObject({
      level: 'error',
      alert: 'booking.production_oracle',
      worker: BOOKING_ORACLE_WORKER,
      violations: '3',
    });
    expect(JSON.stringify(line)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it.each([
    ['absent', undefined],
    ['sans contrôles', { violations: 0, alerted: false }],
    [
      'contrôle manquant',
      { checks: { TRIP_WITHOUT_ACTIVE_OCCUPANCY: 0 }, violations: 0, alerted: false },
    ],
    [
      'compte négatif',
      { checks: { ...zeros, COMPENSATED_HOLD_WITH_TRIP: -1 }, violations: -1, alerted: false },
    ],
    [
      'somme incohérente',
      { checks: { ...zeros, COMPENSATED_HOLD_WITH_TRIP: 1 }, violations: 0, alerted: false },
    ],
    [
      'violation sans alerte',
      { checks: { ...zeros, COMPENSATED_HOLD_WITH_TRIP: 1 }, violations: 1, alerted: false },
    ],
  ])('rapport %s : refusé (fail-closed)', (_name, raw) => {
    expect(() => parseOracleReport(raw)).toThrow(ProductionOracleContractError);
  });

  it('déclaration périodique : file booking_oracle, toutes les 24 h', async () => {
    const registry = new BusRegistry();
    const lines: string[] = [];
    registerProductionOracle(registry, (l) => lines.push(l));
    expect(registry.periodicTasks()).toEqual([
      {
        name: BOOKING_ORACLE_WORKER,
        spec: { periodSeconds: PRODUCTION_ORACLE_PERIOD_SECONDS, maxAttempts: 5 },
      },
    ]);
    expect(PRODUCTION_ORACLE_PERIOD_SECONDS).toBe(24 * 3600);
    const handler = registry.handlerOf(BOOKING_ORACLE_WORKER);
    if (handler?.kind !== 'timer') throw new Error('minuterie attendue');
    await handler.handle({}, new OneRowSql({ checks: zeros, violations: 0, alerted: false }));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ level: 'info', violations: '0' });
  });
});
