import { describe, expect, it } from 'vitest';
import { BusRegistry } from './modules/bus/index.js';
import type { SqlClient, WorkerTransactions } from './modules/bus/index.js';
import { CountryConfigService } from './modules/cfg/index.js';
import { parseBrandName, parsePoolMax } from './worker-config.js';
import {
  DISPOSITION_SWEEPER_WORKER,
  dispositionSweeperPeriod,
  HOLD_EXPIRY_WORKER,
  registerWorkerTasks,
  RISK_PRUNER_WORKER,
  WORKER_TASK_DEFAULTS,
  withDeadlockRetry,
} from './worker-tasks.js';

const config = new CountryConfigService().config;
const AT = new Date('2026-11-04T12:00:00.000Z');

/** Transaction enregistreuse : SQL et paramètres, réponses programmées par motif. */
function recordingTx(answers: Record<string, unknown[]>): { tx: SqlClient; sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    tx: {
      query: <R>(text: string, params?: readonly unknown[]) => {
        sql.push(`${text.replace(/\s+/g, ' ').trim()} ${JSON.stringify(params ?? [])}`);
        const key = Object.keys(answers).find((k) => text.includes(k));
        const rows = (key === undefined ? [] : answers[key]) as R[];
        return Promise.resolve({ rows, rowCount: rows.length });
      },
    },
  };
}

function transactions(
  tx: SqlClient,
  workers: string[],
  failures: unknown[] = [],
): WorkerTransactions {
  return {
    run: async (worker, fn) => {
      workers.push(worker);
      const f = failures.shift();
      if (f !== undefined) throw f;
      return fn(tx);
    },
  };
}

describe('tâches du travailleur (US-003)', () => {
  it('déclarées au registre : noms de travailleur exigés par la base, périodes PROPOSÉES', () => {
    const registry = new BusRegistry();
    const { tx } = recordingTx({});
    registerWorkerTasks(registry, {
      transactions: transactions(tx, []),
      config,
      brandName: 'Marque de test',
      log: () => undefined,
      now: () => AT,
    });
    expect(registry.queueNames()).toEqual([
      'booking_oracle',
      'disposition_sweeper',
      'hold_expiry',
      'iam_otp_pruner',
      'iam_otp_sender',
      'kyc_score_pruner',
      'ntf_dispatcher',
      'ntf_sender',
      'ops_monitor',
      'reconciliation',
      'risk_pruner',
    ]);
    expect(
      registry.periodicTasks().map((t) => [t.name, t.spec.periodSeconds, t.spec.maxAttempts]),
    ).toEqual([
      ['booking_oracle', 86_400, 5],
      ['disposition_sweeper', 60, 5],
      ['hold_expiry', 60, 5],
      ['iam_otp_pruner', 3_600, 5],
      ['kyc_score_pruner', 3_600, 5],
      ['ops_monitor', 60, 5],
      ['reconciliation', 86_400, 5],
      ['risk_pruner', 3_600, 5],
    ]);
    // aucun travailleur qui lirait le PSP (lot C, US-061)
    expect(registry.queueNames()).not.toContain('booking_conversion');
    expect(registry.queueNames()).not.toContain('payment_intent_sweeper');
  });

  it('hold_expiry : expiration puis libération des holds annulés, par lots ; comptes journalisés', async () => {
    const registry = new BusRegistry();
    const logs: string[] = [];
    const { tx, sql } = recordingTx({
      booking_expire_due_holds: [{ n: 2 }],
      booking_release_cancelled_holds: [{ n: '1' }],
    });
    registerWorkerTasks(registry, {
      transactions: transactions(tx, []),
      config,
      brandName: 'x',
      log: (l) => logs.push(l),
      now: () => AT,
    });
    const h = registry.handlerOf(HOLD_EXPIRY_WORKER);
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    await h.handle({}, tx);
    expect(sql).toEqual([
      `SELECT core.booking_expire_due_holds($1) AS n [${WORKER_TASK_DEFAULTS.holdExpiryBatch}]`,
      `SELECT core.booking_release_cancelled_holds($1) AS n [${WORKER_TASK_DEFAULTS.holdExpiryBatch}]`,
    ]);
    expect(logs).toEqual([
      JSON.stringify({ level: 'info', worker: 'hold_expiry', expired: 2, released: 1 }),
    ]);
  });

  it('disposition_sweeper : une transaction disposition_sweeper par opération', async () => {
    const registry = new BusRegistry();
    const workers: string[] = [];
    const { tx, sql } = recordingTx({
      booking_disposition_candidates: [{ operation_id: 'op-1' }, { operation_id: 'op-2' }],
    });
    registerWorkerTasks(registry, {
      transactions: transactions(tx, workers),
      config,
      brandName: 'x',
      log: () => undefined,
      now: () => AT,
    });
    const h = registry.handlerOf(DISPOSITION_SWEEPER_WORKER);
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    await h.handle({}, tx);
    expect(workers).toEqual([DISPOSITION_SWEEPER_WORKER, DISPOSITION_SWEEPER_WORKER]);
    expect(sql).toEqual([
      `SELECT operation_id FROM core.booking_disposition_candidates($1) [${WORKER_TASK_DEFAULTS.dispositionBatch}]`,
      'SELECT core.booking_disposition_repair($1::uuid) ["op-1"]',
      'SELECT core.booking_disposition_repair($1::uuid) ["op-2"]',
    ]);
  });

  it('risk_pruner : purge bornée, conservation de 90 jours', async () => {
    const registry = new BusRegistry();
    const { tx, sql } = recordingTx({ risk_cmd_prune: [{ n: 0 }] });
    registerWorkerTasks(registry, {
      transactions: transactions(tx, []),
      config,
      brandName: 'x',
      log: () => undefined,
      now: () => AT,
    });
    const h = registry.handlerOf(RISK_PRUNER_WORKER);
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    await h.handle({}, tx);
    expect(sql).toEqual(['SELECT core.risk_cmd_prune($1, $2) AS n [5000,90]']);
  });

  it('interblocage (40P01) rejoué 3 fois au plus ; toute autre erreur remonte aussitôt', async () => {
    const deadlock = Object.assign(new Error('deadlock'), { code: '40P01' });
    const { tx } = recordingTx({});
    const w1: string[] = [];
    await expect(
      withDeadlockRetry(transactions(tx, w1, [deadlock, deadlock]), 'disposition_sweeper', () =>
        Promise.resolve('ok'),
      ),
    ).resolves.toBe('ok');
    expect(w1).toHaveLength(3);
    const w2: string[] = [];
    await expect(
      withDeadlockRetry(transactions(tx, w2, [deadlock, deadlock, deadlock]), 'x', () =>
        Promise.resolve('ok'),
      ),
    ).rejects.toBe(deadlock);
    expect(w2).toHaveLength(3);
    const other = Object.assign(new Error('unique'), { code: '23505' });
    const w3: string[] = [];
    await expect(
      withDeadlockRetry(transactions(tx, w3, [other]), 'x', () => Promise.resolve('ok')),
    ).rejects.toBe(other);
    expect(w3).toHaveLength(1);
  });

  it('période du balayeur : la plus courte des pays configurés (données CFG)', () => {
    expect(dispositionSweeperPeriod(config, AT)).toBe(60);
  });
});

describe('configuration du travailleur (US-003)', () => {
  it('RUEDA_BRAND_NAME : obligatoire, 1 à 60 caractères, sans caractère de contrôle', () => {
    expect(parseBrandName(' Marca ')).toBe('Marca');
    for (const bad of [undefined, '', '   ', 'a'.repeat(61), 'a\nb', 'a\u0007']) {
      expect(() => parseBrandName(bad), JSON.stringify(bad)).toThrow(/RUEDA_BRAND_NAME/);
    }
  });

  it('RUEDA_WORKER_POOL_MAX : 5 par défaut, 2 à 50', () => {
    expect(parsePoolMax(undefined)).toBe(5);
    expect(parsePoolMax('')).toBe(5);
    expect(parsePoolMax('2')).toBe(2);
    for (const bad of ['1', '51', '2.5', 'x']) {
      expect(() => parsePoolMax(bad), bad).toThrow(/RUEDA_WORKER_POOL_MAX/);
    }
  });
});
