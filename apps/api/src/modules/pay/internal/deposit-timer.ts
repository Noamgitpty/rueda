/**
 * Minuterie de ré-autorisation de la caution (US-701, ADR-169 ; 08 BR-PAY-06 « Mécanisme » (a) ;
 * 19 US-225 critère 3 « une ré-autorisation est demandée avant l'échéance et, refusée, le trip est
 * signalé à l'ops sans débit » ; suite S-2 d'US-225).
 *
 * Tâche périodique `deposit_timer`, sous le nom de travailleur `payment_command` (exigé par la
 * base) : la file `core.payment_deposit_reauth_due` rend les cautions `REAUTH` AUTORISÉES dont la
 * ré-autorisation est échue (`reauth_due_at ≤ platform.now()`) ; pour chacune :
 * 1. configuration du pays relue (`V`, `deposit_safety_h`, `deposit_reauth_lead_h`) ; un paramètre
 *    absent ⇒ rien n'est envoyé (fail-closed, revu au passage suivant) ;
 * 2. ré-autorisation par le port (`DepositRailExecutor.reauthorize`), rang `reauth_seq + 1`, clé de
 *    08 E4 ; HORS transaction de la base ;
 * 3. issue reportée par `core.payment_cmd_deposit_transition` (machine d'état de la base) :
 *    acceptée ⇒ nouvelle expiration, prochaine ré-autorisation éventuelle, décision ramenée avant
 *    l'expiration ; refusée ⇒ aucune nouvelle ré-autorisation, décision AVANT l'expiration en cours,
 *    alerte ops `DEPOSIT_REAUTH_FAILED`, AUCUN débit ; en cours ou inconnue (`REAUTH_PENDING`) ⇒
 *    aucun changement, la MÊME clé est rejouée au passage suivant (lecture de l'état d'abord, 17
 *    §4.3).
 * Aucun connecteur pour le fournisseur (production jusqu'au lot C) ⇒ rien n'est envoyé.
 * Journal : comptes et codes seulement, jamais un identifiant (17 §6.3).
 */
import type { AlertChannel, BusRegistry, SqlClient, WorkerTransactions } from '../../bus/index.js';
import { createCurrencyRegistry } from '@rueda/money';
import {
  completeRailParams,
  depositHoldValidityHours,
  depositScheduleAfterReauth,
} from './deposit-rails.js';
import { DepositRailExecutor } from './deposit-executor.js';
import { PgDepositRailConfigReader } from './pg-deposit-config.js';
import type { DepositRailConfig } from './pg-deposit-config.js';
import type { PaymentConnectorRegistry } from './production.js';
import type { SqlExecutor } from './pg-stores.js';

export const DEPOSIT_TIMER_WORKER = 'deposit_timer';
/** Nom de travailleur exigé par la base pour la file et la transition. */
const PAYMENT_COMMAND_WORKER = 'payment_command';
/** Période (PROPOSÉ) : la ré-autorisation est planifiée 24 h avant l'expiration. */
export const DEPOSIT_TIMER_PERIOD_SECONDS = 60;
export const DEPOSIT_TIMER_BATCH = 50;

/** Caution dont la ré-autorisation est échue (aucune donnée [C2]). */
export interface DueDepositReauth {
  readonly depositId: string;
  readonly tripId: string;
  readonly segmentId: string;
  readonly tenderId: string;
  readonly country: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly provider: string;
  readonly providerReference: string;
  readonly authExpiryAt: Date;
  readonly releaseAt: Date;
  readonly reauthSeq: number;
  /** `platform.now()` à la lecture de la file. */
  readonly now: Date;
}

export type DepositTimerStep =
  'NO_CONNECTOR' | 'PARAM_MISSING' | 'REAUTHORIZED' | 'REFUSED' | 'PENDING' | 'STALE' | 'ERROR';

const instant = (v: unknown): Date => {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new TypeError('instant illisible');
  return d;
};
const str = (v: unknown): string => {
  if (typeof v !== 'string' || v === '') throw new TypeError('colonne inattendue');
  return v;
};

/** File et transition de la base (fonctions SECURITY DEFINER, `payment_command`). */
export class PgDepositTimerStore {
  constructor(private readonly db: SqlExecutor) {}

  async due(limit: number): Promise<DueDepositReauth[]> {
    const { rows } = await this.db.query(
      `SELECT d.*, c.exponent AS currency_exponent
         FROM core.payment_deposit_reauth_due($1::integer) AS d
         JOIN core.config_currency AS c ON c.code = d.currency`,
      [limit],
    );
    return rows.map((r) => ({
      depositId: str(r['deposit_id']),
      tripId: str(r['trip_id']),
      segmentId: str(r['segment_id']),
      tenderId: str(r['tender_id']),
      country: str(r['country_code']),
      currency: str(r['currency']),
      currencyExponent: Number(r['currency_exponent']),
      provider: str(r['provider']),
      providerReference: str(r['provider_reference']),
      authExpiryAt: instant(r['auth_expiry_at']),
      releaseAt: instant(r['release_at']),
      reauthSeq: Number(r['reauth_seq']),
      now: instant(r['now']),
    }));
  }

  /** `APPLIED` ; `STALE` : la caution a changé entre-temps (rang ou état), rien n'est écrit. */
  async transition(
    depositId: string,
    event: 'REAUTHORIZED' | 'REAUTH_REFUSED',
    expectedSeq: number,
    schedule: { authExpiryAt: Date; decisionAt: Date; reauthDueAt: Date | null },
  ): Promise<'APPLIED' | 'STALE'> {
    const { rows } = await this.db.query<{ r: unknown }>(
      `SELECT core.payment_cmd_deposit_transition($1::uuid, $2, $3::integer, $4::timestamptz,
                                                  $5::timestamptz, $6::timestamptz, NULL) AS r`,
      [
        depositId,
        event,
        expectedSeq,
        schedule.authExpiryAt.toISOString(),
        schedule.decisionAt.toISOString(),
        schedule.reauthDueAt === null ? null : schedule.reauthDueAt.toISOString(),
      ],
    );
    const r = String(rows[0]?.r ?? '');
    if (r !== 'APPLIED' && r !== 'STALE') throw new TypeError('issue inattendue de la transition');
    return r;
  }
}

export interface DepositTimerDeps {
  /** Configuration du pays et du fournisseur (`PgDepositRailConfigReader`, transaction propre). */
  readonly config: (country: string, provider: string) => Promise<DepositRailConfig>;
  /** Transition de la base (`PgDepositTimerStore.transition`, transaction propre). */
  readonly transition: PgDepositTimerStore['transition'];
  readonly alerts: Pick<AlertChannel, 'send'>;
  readonly connectors: PaymentConnectorRegistry;
}

/** Dépendances de production : chaque lecture et chaque écriture dans sa transaction. */
export function postgresDepositTimerDeps(
  transactions: WorkerTransactions,
  alerts: Pick<AlertChannel, 'send'>,
  connectors: PaymentConnectorRegistry,
): DepositTimerDeps {
  return {
    config: (country, provider) =>
      transactions.run(PAYMENT_COMMAND_WORKER, (db) =>
        new PgDepositRailConfigReader(db).read(country, provider),
      ),
    transition: (depositId, event, expectedSeq, schedule) =>
      transactions.run(PAYMENT_COMMAND_WORKER, (db) =>
        new PgDepositTimerStore(db).transition(depositId, event, expectedSeq, schedule),
      ),
    alerts,
    connectors,
  };
}

export class DepositReauthTimer {
  constructor(private readonly deps: DepositTimerDeps) {}

  /** Une caution ; ne lève jamais (une caution ne bloque pas les suivantes). */
  async process(due: DueDepositReauth): Promise<DepositTimerStep> {
    try {
      const provider = this.deps.connectors.get(due.provider);
      if (provider === undefined) return 'NO_CONNECTOR';
      const config = await this.deps.config(due.country, due.provider);
      const params = completeRailParams(config.railParams);
      const vHours = depositHoldValidityHours(config.railParams, {
        capabilities: config.capabilities,
      });
      if (params === null || vHours === 0) return 'PARAM_MISSING';
      const executor = new DepositRailExecutor(provider);
      const outcome = await executor.reauthorize(
        {
          depositId: due.depositId,
          tripReference: due.tripId,
          tripId: due.tripId,
          segmentId: due.segmentId,
          tenderId: due.tenderId,
          currency: createCurrencyRegistry([
            { code: due.currency, exponent: due.currencyExponent },
          ]).get(due.currency),
        },
        due.providerReference,
        due.reauthSeq + 1,
        1,
      );
      if (outcome.kind === 'REAUTH_PENDING') return 'PENDING';
      const event = outcome.kind === 'REAUTHORIZED' ? 'REAUTHORIZED' : 'REAUTH_REFUSED';
      const schedule = depositScheduleAfterReauth(
        event,
        { authExpiryAt: due.authExpiryAt, releaseAt: due.releaseAt },
        due.now,
        vHours,
        params,
      );
      const applied = await this.deps.transition(due.depositId, event, due.reauthSeq, schedule);
      if (applied === 'STALE') return 'STALE';
      if (event === 'REAUTH_REFUSED') {
        await this.deps.alerts.send({
          code: 'DEPOSIT_REAUTH_FAILED',
          severity: 'P1',
          counts: { deposits: 1 },
          labels: { country: due.country, provider: due.provider },
        });
        return 'REFUSED';
      }
      return 'REAUTHORIZED';
    } catch {
      return 'ERROR';
    }
  }
}

/** Tâche périodique `deposit_timer` (comptes seulement dans le journal). */
export function registerDepositTimers(
  registry: BusRegistry,
  transactions: WorkerTransactions,
  alerts: AlertChannel,
  log: (line: string) => void,
  connectors: PaymentConnectorRegistry,
): void {
  const timer = new DepositReauthTimer(postgresDepositTimerDeps(transactions, alerts, connectors));
  registry.registerPeriodic(
    DEPOSIT_TIMER_WORKER,
    DEPOSIT_TIMER_PERIOD_SECONDS,
    async (_payload, tx: SqlClient) => {
      await tx.query(`SELECT pg_catalog.set_config('app.worker_name', $1, true)`, [
        PAYMENT_COMMAND_WORKER,
      ]);
      const due = await new PgDepositTimerStore(tx).due(DEPOSIT_TIMER_BATCH);
      const counts: Record<string, number> = {};
      for (const d of due) {
        const step = (await timer.process(d)).toLowerCase();
        counts[step] = (counts[step] ?? 0) + 1;
      }
      log(
        JSON.stringify({ level: 'info', worker: DEPOSIT_TIMER_WORKER, due: due.length, ...counts }),
      );
    },
  );
}
