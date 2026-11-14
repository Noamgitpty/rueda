/**
 * Tâches du travailleur (US-003, ADR-078 ; ADR-050 « Tâches périodiques ») : ce que `worker.ts`
 * déclare sur le registre du module BUS, sous la connexion `app_worker`. Chaque tâche a son nom
 * de travailleur (`app.worker_name`), celui que la base exige (politiques et gardes des fonctions) :
 *
 * | Travailleur           | Période (PROPOSÉ)                          | Appel                                                     |
 * | --------------------- | ------------------------------------------ | --------------------------------------------------------- |
 * | `hold_expiry`         | 60 s (handoff US-023)                      | `core.booking_expire_due_holds`, `core.booking_release_cancelled_holds` (0037, 0040) |
 * | `disposition_sweeper` | `disposition_sweeper_period_s` (min. pays) | `core.booking_disposition_candidates` puis, une opération par transaction, `core.booking_disposition_repair` (0041, C17) |
 * | `booking_oracle`      | 24 h (ADR-068)                             | `core.booking_production_oracle_alert` (0045, C12)        |
 * | `reconciliation`      | 24 h (ADR-087)                             | contrôles de rapprochement de l'argent, lecture seule (FIN, US-047) ; alerte `FIN_MONEY_RECONCILIATION` |
 * | `risk_pruner`         | 1 h                                        | `core.risk_cmd_prune` (0047, US-052)                      |
 * | `ntf_dispatcher`, `ntf_sender` | événements, minuterie             | NTF (US-021) ; plafond SMS du pays (`ntfSmsBudget`, US-052) |
 * | `ops_monitor`         | 60 s (ADR-080)                             | `core.ops_monitor_metrics` (0051) ; alertes sur le port `AlertChannel` (US-004) |
 * | `iam_otp_sender`      | événement `iam.otp.requested`              | `core.iam_worker_otp_issue` (0066, US-104) puis SMS ; aucun canal SMS avant le lot C |
 * | `iam_otp_pruner`      | 1 h                                        | `core.iam_worker_otp_prune` (0066) : défis OTP de plus de 30 jours (17 §3.2.1) |
 * | `kyc_score_pruner`    | 1 h                                        | `core.kyc_worker_prune` (0072, US-105) : scores [C3] à `retention_until`, rejets de rappels de plus de 90 jours |
 * | `privacy_request`     | 1 h                                        | `core.privacy_worker_retention_sweep`, `core.privacy_worker_dsr_overdue` puis `core.privacy_worker_stale_kyc_erasures` (0090, US-111) : trips clos sans litige pseudonymisés à l'échéance (`evidence_retention_months`), purge journalisée ; demandes des personnes en retard signalées une fois ; demandes d'effacement KYC en attente ou en échec ; alertes `PRIVACY_DSR_OVERDUE` (P1, par pays), `PRIVACY_KYC_ERASURE_STALE` (P1) |
 * | `review_sla_watch`    | 60 s                                       | `core.kyc_worker_auto_review_hosts` (0081, US-108 : dossiers d'hôte propres approuvés sans l'ops), `core.kyc_worker_enqueue_reviews` puis `core.support_worker_review_sla` (0076, US-106) : dossiers KYC en revue remis en file, éléments en retard signalés une fois ; alertes `OPS_REVIEW_SLA_BREACH` (P2), `OPS_KYC_REVIEW_UNQUEUED` (P1, une fois par dossier et par épisode de revue) |
 *
 * Non déclarés ici, faute de port réel (tracé dans docs/team/handoffs/US-003.md) : `booking_conversion`
 * et `payment_intent_sweeper` (lisent le PSP : adaptateurs du lot C, consommateur `payment_command`
 * d'US-061). Aucun canal de notification réel n'existe avant le lot C : `ntf_sender` échoue donc en
 * `CHANNEL_UNAVAILABLE` (fail-closed, rien ne part), mais chaque envoi reste tracé.
 *
 * Les tâches ne journalisent que des comptes, jamais d'identifiant ni de donnée personnelle (17 §6.3).
 */
import { LogAlertChannel, registerOpsMonitor } from './modules/bus/index.js';
import type {
  AlertChannel,
  BusRegistry,
  SqlClient,
  WorkerTransactions,
} from './modules/bus/index.js';
import { registerProductionOracle } from './modules/avl/index.js';
import { resolveParam } from './modules/cfg/index.js';
import { registerMoneyReconciliation } from './modules/fin/index.js';
import type { CountryConfig } from './modules/cfg/index.js';
import { OtpSender, postgresNotificationContacts, registerPhoneOtp } from './modules/iam/index.js';
import type { OtpCodeHasher } from './modules/iam/index.js';
import {
  notificationCountryData,
  NotificationSender,
  registerNotifications,
  repositoryLocaleConfig,
} from './modules/ntf/index.js';
import { ntfSmsBudget } from './modules/risk/index.js';

export const HOLD_EXPIRY_WORKER = 'hold_expiry';
export const DISPOSITION_SWEEPER_WORKER = 'disposition_sweeper';
export const RISK_PRUNER_WORKER = 'risk_pruner';
/** Purge des scores biométriques à échéance et des rejets de rappels KYC (US-105, ADR-102). */
export const KYC_SCORE_PRUNER_WORKER = 'kyc_score_pruner';
/**
 * Rétention et demandes des personnes (US-111, ADR-118) : pseudonymisation des trips clos, retards
 * des demandes, effacements KYC en souffrance. Nom de travailleur de 17 §2.3 (`privacy_request`).
 */
export const PRIVACY_REQUEST_WORKER = 'privacy_request';
/** Alerte de délai des files de revue et remise en file des dossiers KYC (US-106, ADR-106). */
export const REVIEW_SLA_WATCH_WORKER = 'review_sla_watch';
export { IAM_OTP_PRUNER_WORKER, IAM_OTP_SENDER_WORKER } from './modules/iam/index.js';

/** Valeurs PROPOSÉES (ADR-078) ; les périodes de 17 qui sont des paramètres pays sont lues en CFG. */
export const WORKER_TASK_DEFAULTS = {
  holdExpiryPeriodSeconds: 60,
  holdExpiryBatch: 500,
  dispositionBatch: 100,
  riskPrunerPeriodSeconds: 3_600,
  riskPrunerBatch: 5_000,
  /** Conservation des événements d'abus (`risk_abuse_event`) : 90 jours (handoff US-052). */
  riskEventRetentionDays: 90,
  /** Purge des défis OTP de plus de 30 jours (US-104) : toutes les heures, par lots. */
  otpPrunerPeriodSeconds: 3_600,
  otpPrunerBatch: 5_000,
  /** Purge KYC (US-105) : toutes les heures, par lots. */
  kycPrunerPeriodSeconds: 3_600,
  kycPrunerBatch: 5_000,
  /**
   * Files de revue (US-106) : passe chaque minute (délai le plus court : `review_hold_minutes`,
   * en minutes ; 16 ADM-002 « SLA dépassé ⇒ alerte »), par lots.
   */
  reviewSlaWatchPeriodSeconds: 60,
  reviewSlaWatchBatch: 500,
  /**
   * Rétention (US-111) : toutes les heures, par lots ; une demande d'effacement KYC encore en
   * attente une heure après le retrait (ou en échec) est signalée à l'ops (PROPOSÉ, ADR-118).
   */
  privacyPeriodSeconds: 3_600,
  privacyBatch: 1_000,
  kycErasureStaleMinutes: 60,
  /** Reprise d'un interblocage (SQLSTATE 40P01) : 3 essais au plus (handoff US-024). */
  deadlockAttempts: 3,
} as const;

export type WorkerLog = (line: string) => void;

const count = (value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new Error('compte attendu');
  }
  return n;
};

const isDeadlock = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '40P01';

/** Exécute `fn` dans une transaction de `worker`, rejouée sur interblocage (40P01, ≤ `attempts`). */
export async function withDeadlockRetry<T>(
  transactions: WorkerTransactions,
  worker: string,
  fn: (tx: SqlClient) => Promise<T>,
  attempts: number = WORKER_TASK_DEFAULTS.deadlockAttempts,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await transactions.run(worker, fn);
    } catch (error) {
      if (!isDeadlock(error) || attempt >= attempts) throw error;
    }
  }
}

/** Période du balayeur des dispositions : la plus courte des pays configurés (17 §2.5 A6). */
export function dispositionSweeperPeriod(config: CountryConfig, at: Date): number {
  const periods = [...config.countries.keys()].map((country) => {
    const value = resolveParam(config, 'disposition_sweeper_period_s', { country, at }).value;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new Error(`disposition_sweeper_period_s invalide pour ${country}`);
    }
    return value;
  });
  if (periods.length === 0) throw new Error('aucun pays configuré');
  return Math.min(...periods);
}

export interface WorkerTaskDeps {
  readonly transactions: WorkerTransactions;
  readonly config: CountryConfig;
  /** Nom de marque des messages (donnée de thème, DEC-MARQUE ; `RUEDA_BRAND_NAME`). */
  readonly brandName: string;
  readonly log: WorkerLog;
  /** Canal des alertes d'exploitation (US-004) ; par défaut, une ligne JSON sur `log`. */
  readonly alerts?: AlertChannel;
  readonly now?: () => Date;
  /**
   * Empreinte des codes OTP (`RUEDA_OTP_KEY`, US-104) ; absente (`null`) : aucun code émis. Aucun
   * canal SMS réel avant le lot C : le travailleur n'envoie rien en production (fail-closed).
   */
  readonly otpHasher?: OtpCodeHasher | null;
}

/** Déclare toutes les tâches du travailleur sur `registry` (voir l'en-tête). */
export function registerWorkerTasks(registry: BusRegistry, deps: WorkerTaskDeps): void {
  const d = WORKER_TASK_DEFAULTS;
  const line = (worker: string, counts: Record<string, number>): void => {
    deps.log(JSON.stringify({ level: 'info', worker, ...counts }));
  };

  registry.registerPeriodic(HOLD_EXPIRY_WORKER, d.holdExpiryPeriodSeconds, async (_p, tx) => {
    const expired = await tx.query<{ n: unknown }>(
      'SELECT core.booking_expire_due_holds($1) AS n',
      [d.holdExpiryBatch],
    );
    const released = await tx.query<{ n: unknown }>(
      'SELECT core.booking_release_cancelled_holds($1) AS n',
      [d.holdExpiryBatch],
    );
    line(HOLD_EXPIRY_WORKER, {
      expired: count(expired.rows[0]?.n),
      released: count(released.rows[0]?.n),
    });
  });

  // Une opération par transaction (handoff US-024 : jamais les verrous de plusieurs voyageurs) :
  // l'occurrence périodique tient seulement son bail ; chaque réparation a sa propre transaction.
  registry.registerPeriodic(
    DISPOSITION_SWEEPER_WORKER,
    dispositionSweeperPeriod(deps.config, (deps.now ?? (() => new Date()))()),
    async (_p, tx) => {
      const { rows } = await tx.query<{ operation_id: string }>(
        'SELECT operation_id FROM core.booking_disposition_candidates($1)',
        [d.dispositionBatch],
      );
      let repaired = 0;
      for (const row of rows) {
        await withDeadlockRetry(deps.transactions, DISPOSITION_SWEEPER_WORKER, (repairTx) =>
          repairTx.query('SELECT core.booking_disposition_repair($1::uuid)', [row.operation_id]),
        );
        repaired++;
      }
      line(DISPOSITION_SWEEPER_WORKER, { candidates: rows.length, repaired });
    },
  );

  registerProductionOracle(registry, deps.log);

  const alerts = deps.alerts ?? new LogAlertChannel(deps.log);
  registerOpsMonitor(registry, alerts, deps.log);
  registerMoneyReconciliation(registry, alerts, deps.log);

  // Files de revue (US-106) : dossiers KYC en revue remis en file s'il le faut, puis chaque élément
  // en retard signalé UNE fois par la base ; une alerte par (file, pays). Un envoi en échec annule
  // la passe (marques comprises) : rejouée par le bus, livraison « au moins une fois ».
  registry.registerPeriodic(
    REVIEW_SLA_WATCH_WORKER,
    d.reviewSlaWatchPeriodSeconds,
    async (_p, tx) => {
      // US-108 (ADR-111) : revue de l'hôte PAR EXCEPTION — dossiers complets et propres approuvés
      // sans l'ops ; retenue de sanctions et pays qui imposent la revue laissés à l'ops
      // (délai uniforme avant toute approbation). Isolée par un point de sauvegarde : une erreur de
      // cette partie ne fait tomber ni la remise en file KYC ni les alertes de retard (revues
      // code et architecture d'US-108) ; la base isole déjà chaque dossier (`failed`).
      let hostsApproved = 0;
      let hostsKept = 0;
      let hostsSkipped = 0;
      let hostsFailed: number;
      await tx.query('SAVEPOINT host_auto_review');
      try {
        const hosts = await tx.query<{
          approved: unknown;
          kept: unknown;
          skipped: unknown;
          failed: unknown;
        }>(
          'SELECT approved, kept, skipped, failed FROM core.kyc_worker_auto_review_hosts($1, NULL)',
          [d.reviewSlaWatchBatch],
        );
        hostsApproved = count(hosts.rows[0]?.approved);
        hostsKept = count(hosts.rows[0]?.kept);
        hostsSkipped = count(hosts.rows[0]?.skipped);
        hostsFailed = count(hosts.rows[0]?.failed);
        await tx.query('RELEASE SAVEPOINT host_auto_review');
      } catch {
        await tx.query('ROLLBACK TO SAVEPOINT host_auto_review');
        hostsFailed = -1;
      }
      // `unqueued` : dossiers dont l'échec est NOUVEAU (une alerte par épisode de revue, marque en
      // base) ; `waiting` : échecs déjà signalés ; `skipped` : personne verrouillée ailleurs
      const k = await tx.query<{
        enqueued: unknown;
        unqueued: unknown;
        waiting: unknown;
        skipped: unknown;
      }>('SELECT enqueued, unqueued, waiting, skipped FROM core.kyc_worker_enqueue_reviews($1)', [
        d.reviewSlaWatchBatch,
      ]);
      const enqueued = count(k.rows[0]?.enqueued);
      const unqueued = count(k.rows[0]?.unqueued);
      const waiting = count(k.rows[0]?.waiting);
      const skipped = count(k.rows[0]?.skipped);
      const { rows } = await tx.query<{ queue: string; country_code: string; breached: unknown }>(
        'SELECT queue, country_code, breached FROM core.support_worker_review_sla($1)',
        [d.reviewSlaWatchBatch],
      );
      let breached = 0;
      for (const r of rows) {
        const n = count(r.breached);
        breached += n;
        await alerts.send({
          code: 'OPS_REVIEW_SLA_BREACH',
          severity: 'P2',
          counts: { breached: n },
          labels: { queue: r.queue, country: r.country_code },
        });
      }
      if (unqueued > 0) {
        await alerts.send({
          code: 'OPS_KYC_REVIEW_UNQUEUED',
          severity: 'P1',
          counts: { unqueued },
          labels: { queue: 'KYC' },
        });
      }
      line(REVIEW_SLA_WATCH_WORKER, {
        hostsApproved,
        hostsKept,
        hostsSkipped,
        hostsFailed,
        enqueued,
        unqueued,
        waiting,
        skipped,
        breached,
      });
    },
  );

  registry.registerPeriodic(RISK_PRUNER_WORKER, d.riskPrunerPeriodSeconds, async (_p, tx) => {
    const { rows } = await tx.query<{ n: unknown }>('SELECT core.risk_cmd_prune($1, $2) AS n', [
      d.riskPrunerBatch,
      d.riskEventRetentionDays,
    ]);
    line(RISK_PRUNER_WORKER, { pruned: count(rows[0]?.n) });
  });

  // Rétention et demandes des personnes (US-111) : trips clos pseudonymisés à l'échéance (purge
  // journalisée en base), retards des demandes signalés UNE fois par la base (une alerte par pays),
  // demandes d'effacement KYC en souffrance (reprise par l'ops tant qu'aucun fournisseur réel
  // n'est branché au travailleur). Un envoi en échec annule la passe (marques comprises).
  registry.registerPeriodic(PRIVACY_REQUEST_WORKER, d.privacyPeriodSeconds, async (_p, tx) => {
    const swept = await tx.query<{ n: unknown }>(
      'SELECT core.privacy_worker_retention_sweep($1) AS n',
      [d.privacyBatch],
    );
    const late = await tx.query<{ country_code: string; overdue: unknown }>(
      'SELECT country_code, overdue FROM core.privacy_worker_dsr_overdue($1)',
      [d.privacyBatch],
    );
    let overdue = 0;
    for (const r of late.rows) {
      const n = count(r.overdue);
      overdue += n;
      await alerts.send({
        code: 'PRIVACY_DSR_OVERDUE',
        severity: 'P1',
        counts: { overdue: n },
        labels: { country: r.country_code },
      });
    }
    const stale = count(
      (
        await tx.query<{ n: unknown }>('SELECT core.privacy_worker_stale_kyc_erasures($1) AS n', [
          d.kycErasureStaleMinutes,
        ])
      ).rows[0]?.n,
    );
    if (stale > 0) {
      await alerts.send({
        code: 'PRIVACY_KYC_ERASURE_STALE',
        severity: 'P1',
        counts: { stale },
      });
    }
    line(PRIVACY_REQUEST_WORKER, { pseudonymised: count(swept.rows[0]?.n), overdue, stale });
  });

  // Vérification d'identité (US-105) : scores [C3] effacés à leur échéance (0 jour sans paramètre)
  registry.registerPeriodic(KYC_SCORE_PRUNER_WORKER, d.kycPrunerPeriodSeconds, async (_p, tx) => {
    const { rows } = await tx.query<{ n: unknown }>('SELECT core.kyc_worker_prune($1) AS n', [
      d.kycPrunerBatch,
    ]);
    line(KYC_SCORE_PRUNER_WORKER, { pruned: count(rows[0]?.n) });
  });

  // OTP du téléphone (US-104) : émission asynchrone, aucun canal SMS réel avant le lot C (F-03)
  registerPhoneOtp(
    registry,
    new OtpSender({
      hasher: deps.otpHasher ?? null,
      sms: null,
      localeConfig: repositoryLocaleConfig(),
      countryOf: (code) => deps.config.countries.get(code),
      brand: deps.brandName,
      log: (entry) => {
        deps.log(JSON.stringify({ level: 'info', ...entry }));
      },
    }),
    {
      periodSeconds: d.otpPrunerPeriodSeconds,
      batch: d.otpPrunerBatch,
      log: (n) => {
        line('iam_otp_pruner', { pruned: n });
      },
    },
  );

  const countryData = notificationCountryData(deps.config);
  registerNotifications(
    registry,
    new NotificationSender({
      // Aucun canal réel avant le lot C (F-03) : fail-closed, CHANNEL_UNAVAILABLE.
      channels: {},
      directory: postgresNotificationContacts,
      smsBudget: ntfSmsBudget(deps.config),
      countryOf: countryData.countryOf,
      exponentOf: countryData.exponentOf,
      localeConfig: repositoryLocaleConfig(),
      brand: deps.brandName,
      log: (entry) => {
        deps.log(JSON.stringify({ level: 'info', ...entry }));
      },
    }),
  );
}
