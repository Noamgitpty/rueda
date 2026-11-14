import { describe, expect, it } from 'vitest';
import { assertSafeAlert, BusRegistry } from './modules/bus/index.js';
import type { AlertChannel, OpsAlert, SqlClient, WorkerTransactions } from './modules/bus/index.js';
import { CountryConfigService } from './modules/cfg/index.js';
import { parseBrandName, parsePoolMax } from './worker-config.js';
import {
  DISPOSITION_SWEEPER_WORKER,
  dispositionSweeperPeriod,
  HOLD_EXPIRY_WORKER,
  PRIVACY_REQUEST_WORKER,
  registerWorkerTasks,
  REVIEW_SLA_WATCH_WORKER,
  RISK_PRUNER_WORKER,
  WORKER_TASK_DEFAULTS,
  withDeadlockRetry,
} from './worker-tasks.js';

const config = new CountryConfigService().config;
/** Deux pays de la configuration (données CFG, jamais une constante du code). */
const [C1 = '', C2 = ''] = [...config.countries.keys()];

/**
 * Canal d'alerte enregistreur (port AlertChannel du module BUS) ; `failing` : envoi en échec.
 */
class RecordingAlerts implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  failing = false;

  send(alert: OpsAlert): Promise<void> {
    // même contrôle que tout canal : comptes et codes seulement (17 §6.3)
    assertSafeAlert(alert);
    if (this.failing) return Promise.reject(new Error('canal d’alerte indisponible'));
    this.sent.push(alert);
    return Promise.resolve();
  }
}
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
      'privacy_request',
      'reconciliation',
      'review_sla_watch',
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
      ['privacy_request', 3_600, 5],
      ['reconciliation', 86_400, 5],
      ['review_sla_watch', 60, 5],
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

  // US-106 (16 ADM-002 « SLA dépassé ⇒ alerte au responsable ops ») : comptes de la base relayés,
  // une alerte P2 par (file, pays), une alerte P1 si un dossier KYC en revue reste hors file
  it('review_sla_watch : revue de l’hôte par exception, remise en file KYC puis retards signalés ; une alerte par file et pays', async () => {
    const registry = new BusRegistry();
    const alerts = new RecordingAlerts();
    const logs: string[] = [];
    const { tx, sql } = recordingTx({
      kyc_worker_auto_review_hosts: [{ approved: 2, kept: '1', skipped: 0, failed: 0 }],
      kyc_worker_enqueue_reviews: [{ enqueued: 1, unqueued: '2', waiting: 3, skipped: '1' }],
      support_worker_review_sla: [
        { queue: 'KYC', country_code: C1, breached: 3 },
        { queue: 'LISTING', country_code: C2, breached: '1' },
      ],
    });
    registerWorkerTasks(registry, {
      transactions: transactions(tx, []),
      config,
      brandName: 'x',
      log: (l) => logs.push(l),
      alerts,
      now: () => AT,
    });
    const h = registry.handlerOf(REVIEW_SLA_WATCH_WORKER);
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    await h.handle({}, tx);
    const batch = WORKER_TASK_DEFAULTS.reviewSlaWatchBatch;
    expect(sql).toEqual([
      // US-108 : revue de l'hôte par exception, d'abord (tous les comptes : NULL)
      'SAVEPOINT host_auto_review []',
      `SELECT approved, kept, skipped, failed FROM core.kyc_worker_auto_review_hosts($1, NULL) [${batch}]`,
      'RELEASE SAVEPOINT host_auto_review []',
      `SELECT enqueued, unqueued, waiting, skipped FROM core.kyc_worker_enqueue_reviews($1) [${batch}]`,
      `SELECT queue, country_code, breached FROM core.support_worker_review_sla($1) [${batch}]`,
    ]);
    expect(alerts.sent).toEqual([
      {
        code: 'OPS_REVIEW_SLA_BREACH',
        severity: 'P2',
        counts: { breached: 3 },
        labels: { queue: 'KYC', country: C1 },
      },
      {
        code: 'OPS_REVIEW_SLA_BREACH',
        severity: 'P2',
        counts: { breached: 1 },
        labels: { queue: 'LISTING', country: C2 },
      },
      {
        code: 'OPS_KYC_REVIEW_UNQUEUED',
        severity: 'P1',
        counts: { unqueued: 2 },
        labels: { queue: 'KYC' },
      },
    ]);
    expect(logs).toEqual([
      JSON.stringify({
        level: 'info',
        worker: 'review_sla_watch',
        hostsApproved: 2,
        hostsKept: 1,
        hostsSkipped: 0,
        hostsFailed: 0,
        enqueued: 1,
        unqueued: 2,
        waiting: 3,
        skipped: 1,
        breached: 4,
      }),
    ]);
  });

  // US-111 (16 LEG-009 « tâche de purge → pseudonymisation tracée », LEG-010) : comptes de la base
  // relayés, une alerte P1 par pays en retard, une alerte P1 si un effacement KYC est en souffrance
  it('privacy_request : pseudonymisation, retards des demandes par pays, effacements KYC en souffrance ; alertes P1 ; comptes journalisés', async () => {
    const registry = new BusRegistry();
    const alerts = new RecordingAlerts();
    const logs: string[] = [];
    const { tx, sql } = recordingTx({
      privacy_worker_retention_sweep: [{ n: '3' }],
      privacy_worker_dsr_overdue: [
        { country_code: C1, overdue: 2 },
        { country_code: C2, overdue: '1' },
      ],
      privacy_worker_stale_kyc_erasures: [{ n: 4 }],
    });
    registerWorkerTasks(registry, {
      transactions: transactions(tx, []),
      config,
      brandName: 'x',
      log: (l) => logs.push(l),
      alerts,
      now: () => AT,
    });
    const h = registry.handlerOf(PRIVACY_REQUEST_WORKER);
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    await h.handle({}, tx);
    const d = WORKER_TASK_DEFAULTS;
    expect(sql).toEqual([
      `SELECT core.privacy_worker_retention_sweep($1) AS n [${d.privacyBatch}]`,
      `SELECT country_code, overdue FROM core.privacy_worker_dsr_overdue($1) [${d.privacyBatch}]`,
      `SELECT core.privacy_worker_stale_kyc_erasures($1) AS n [${d.kycErasureStaleMinutes}]`,
    ]);
    expect(alerts.sent).toEqual([
      {
        code: 'PRIVACY_DSR_OVERDUE',
        severity: 'P1',
        counts: { overdue: 2 },
        labels: { country: C1 },
      },
      {
        code: 'PRIVACY_DSR_OVERDUE',
        severity: 'P1',
        counts: { overdue: 1 },
        labels: { country: C2 },
      },
      { code: 'PRIVACY_KYC_ERASURE_STALE', severity: 'P1', counts: { stale: 4 } },
    ]);
    expect(logs).toEqual([
      JSON.stringify({
        level: 'info',
        worker: 'privacy_request',
        pseudonymised: 3,
        overdue: 3,
        stale: 4,
      }),
    ]);
  });

  it('privacy_request : rien en retard ni en souffrance ⇒ aucune alerte ; canal en échec ⇒ la passe échoue (rejouée)', async () => {
    const quiet = recordingTx({
      privacy_worker_retention_sweep: [{ n: 0 }],
      privacy_worker_stale_kyc_erasures: [{ n: 0 }],
    });
    const alerts = new RecordingAlerts();
    const registry = new BusRegistry();
    registerWorkerTasks(registry, {
      transactions: transactions(quiet.tx, []),
      config,
      brandName: 'x',
      log: () => undefined,
      alerts,
      now: () => AT,
    });
    const h = registry.handlerOf(PRIVACY_REQUEST_WORKER);
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    await h.handle({}, quiet.tx);
    expect(alerts.sent).toEqual([]);
    const late = recordingTx({
      privacy_worker_retention_sweep: [{ n: 0 }],
      privacy_worker_dsr_overdue: [{ country_code: C1, overdue: 1 }],
      privacy_worker_stale_kyc_erasures: [{ n: 0 }],
    });
    alerts.failing = true;
    await expect(h.handle({}, late.tx)).rejects.toThrow('canal d’alerte indisponible');
  });

  // US-108 (revues code et architecture) : une erreur de la partie hôtes est isolée par un point
  // de sauvegarde ; la remise en file KYC et les alertes de retard continuent
  it('review_sla_watch : erreur de l’approbation automatique des hôtes isolée, alertes de retard envoyées', async () => {
    const registry = new BusRegistry();
    const alerts = new RecordingAlerts();
    const logs: string[] = [];
    const base = recordingTx({
      kyc_worker_enqueue_reviews: [{ enqueued: 0, unqueued: 0, waiting: 0, skipped: 0 }],
      support_worker_review_sla: [{ queue: 'KYC', country_code: C1, breached: 1 }],
    });
    const tx: SqlClient = {
      query: <R>(text: string, params?: readonly unknown[]) =>
        text.includes('kyc_worker_auto_review_hosts')
          ? Promise.reject(new Error('dossier en échec'))
          : base.tx.query<R>(text, params),
    };
    registerWorkerTasks(registry, {
      transactions: transactions(tx, []),
      config,
      brandName: 'x',
      log: (l) => logs.push(l),
      alerts,
      now: () => AT,
    });
    const h = registry.handlerOf(REVIEW_SLA_WATCH_WORKER);
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    await h.handle({}, tx);
    expect(base.sql).toContain('ROLLBACK TO SAVEPOINT host_auto_review []');
    expect(alerts.sent.map((a) => a.code)).toEqual(['OPS_REVIEW_SLA_BREACH']);
    expect(logs[0]).toContain('"hostsFailed":-1');
  });

  it('review_sla_watch : rien en retard ni hors file ⇒ aucune alerte ; canal en échec ⇒ la passe échoue (rejouée)', async () => {
    // échecs déjà signalés (`waiting`) : aucune nouvelle alerte P1 (une par dossier, revue US-106)
    const quiet = recordingTx({
      kyc_worker_auto_review_hosts: [{ approved: 0, kept: 0, skipped: 0, failed: 0 }],
      kyc_worker_enqueue_reviews: [{ enqueued: 0, unqueued: 0, waiting: 5, skipped: 0 }],
    });
    const alerts = new RecordingAlerts();
    const registry = new BusRegistry();
    registerWorkerTasks(registry, {
      transactions: transactions(quiet.tx, []),
      config,
      brandName: 'x',
      log: () => undefined,
      alerts,
      now: () => AT,
    });
    const h = registry.handlerOf(REVIEW_SLA_WATCH_WORKER);
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    await h.handle({}, quiet.tx);
    expect(alerts.sent).toEqual([]);
    const late = recordingTx({
      kyc_worker_auto_review_hosts: [{ approved: 0, kept: 0, skipped: 0, failed: 0 }],
      kyc_worker_enqueue_reviews: [{ enqueued: 0, unqueued: 0, waiting: 0, skipped: 0 }],
      support_worker_review_sla: [{ queue: 'KYC', country_code: C2, breached: 1 }],
    });
    alerts.failing = true;
    await expect(h.handle({}, late.tx)).rejects.toThrow(/indisponible/);
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
