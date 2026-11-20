/**
 * Ordonnanceur des débits post-trip par MIT (US-703, ADR-189 ; 19 US-703 critère 1 ; 16 PAY-015 /
 * PAY-037 ; 08 BR-PAY-09 bis, E4 ; 17 §2.8 `chargeMIT`, §4.3 points 2 à 4 ; L3-PM-21, L3-PM-22).
 *
 * Un débit post-trip naît NOTIFIÉ avec le montant explicite de chaque jambe (décision amont). La
 * tâche périodique `mit_charge_scheduler` (60 s) traite chaque débit de la file
 * `core.payment_post_trip_charges_due` sous le travailleur `payment_command` :
 *
 * 1. sans connecteur pour le fournisseur du débit (production avant le lot C : aucun), RIEN n'est
 *    planifié ni envoyé (fail-closed) ;
 * 2. transaction A : `core.payment_cmd_plan_mit_attempt` juge TOUT (consentement du checkout,
 *    rappel à la remise, carte consentie toujours ACTIVE, règle du réseau en données, préavis,
 *    accord écrit, délai, `SUPPORTS_MIT` inconnue = non, échéancier J0 / J+3 / J+7) et écrit la
 *    tentative et son ordre `MIT_CHARGE` PENDING (clé de 08 E4 stockée AVANT l'envoi) ; ou rend
 *    NOT_DUE (`MIT_NOTICE_PERIOD_NOT_ELAPSED`…), BLOCKED, DEBT (dette et `UNPAID_BALANCE`),
 *    IN_FLIGHT (tentative sans statut : la MÊME clé), SETTLE ;
 * 3. transaction B : l'ordre STOCKÉ est relu sous les verrous du trip puis du débit
 *    (`core.payment_mit_attempt_for_send`), gardés jusqu'au COMMIT donc pendant l'appel au PSP ;
 *    `MoneyCommandSender` l'envoie (lecture d'abord si l'issue est inconnue ou sans en-tête
 *    d'idempotence validé, même clé, montant explicite de chaque jambe, jamais recalculé), puis
 *    `core.payment_cmd_settle_mit_attempt` reporte l'issue : débité ; refus REÇU ⇒ relance planifiée
 *    (`attempt_no` + 1 au passage suivant) ou dette (« ne pas réessayer », tentatives épuisées) ;
 *    issue inconnue ⇒ rien, relue au passage suivant. PSP injoignable : transaction B ANNULÉE,
 *    l'ordre reste PENDING avec sa clé.
 *
 * Un débit ne bloque jamais les suivants (`process` ne lève pas). Le journal ne porte que des comptes
 * et des codes (17 §6.3) ; jamais un jeton, un identifiant ni un montant. La caution n'est jamais
 * touchée ici (aucun `DEPOSIT_*`) : un débit post-trip est toujours un `MIT_CHARGE` séparé.
 */
import { randomUUID } from 'node:crypto';
import type { BusRegistry, SqlClient, WorkerTransactions } from '../../bus/index.js';
import { isPaymentError } from './errors.js';
import { MoneyCommandSender } from './money-command-sender.js';
import type { SendOutcome } from './money-command-sender.js';
import type { DueCharge, MitChargeStore, SettleResult } from './mit-charge-store.js';
import { PgMitChargeStore } from './pg-mit-charge-store.js';
import type { PaymentProvider } from './port.js';
import type { PaymentConnectorRegistry } from './production.js';

/** Nom de la tâche périodique (file du travailleur). */
export const MIT_CHARGE_SCHEDULER_WORKER = 'mit_charge_scheduler';
/** Travailleur des commandes d'argent : nom exigé par la base pour chaque commande appelée. */
const PAYMENT_COMMAND_WORKER = 'payment_command';
/** Période (PROPOSÉ, ADR-189) : préavis en heures et en jours, une minute suffit. */
export const MIT_CHARGE_SCHEDULER_PERIOD_SECONDS = 60;
/** Débits traités par passage, deux transactions chacun au plus. */
export const MIT_CHARGE_SCHEDULER_BATCH = 50;

export type MitChargeStep =
  /** Aucun connecteur pour le fournisseur : rien n'est planifié ni envoyé (fail-closed). */
  | 'NO_CONNECTOR'
  /** Préavis, accord écrit ou échéancier : rien n'est envoyé. */
  | 'NOT_DUE'
  /** Capacité SUPPORTS_MIT inconnue ou compte inactif : aucun ordre. */
  | 'BLOCKED'
  /** Dette ouverte (consentement, rappel, carte, règle, délai, refus définitif). */
  | 'DEBT'
  /** Débit réussi (et reporté, ou en attente de sa preuve). */
  | 'CHARGED'
  /** Refus reçu : relance planifiée par la base. */
  | 'RETRY_DUE'
  /** Issue inconnue, PSP injoignable ou preuve attendue : repris au passage suivant. */
  | 'WAITING'
  /** Rien à faire : déjà débité ou en dette. */
  | 'DONE'
  /** Revue FIN : aucune lecture possible, montant reçu différent, refus de la base. */
  | 'ATTENTION'
  /** Interblocage ou sérialisation : repris au passage suivant. */
  | 'RETRY';

export interface MitChargeOutcome {
  readonly step: MitChargeStep;
  /** Code de la base ou du connecteur, jamais un message. */
  readonly code: string | null;
}

export interface MitChargeSchedulerDeps {
  readonly transactions: WorkerTransactions;
  /** Connecteurs PSP par fournisseur (production : aucun avant le lot C). */
  readonly connectors: PaymentConnectorRegistry;
  /** Stockage de la transaction (production : PostgreSQL). */
  readonly storeOf?: (db: SqlClient) => MitChargeStore;
  /** Journal d'exploitation : comptes et codes seulement (17 §6.3). */
  readonly log?: (line: string) => void;
  readonly newId?: () => string;
}

/** Rien n'a atteint le PSP : la transaction B est annulée (l'ordre reste PENDING). */
class NotSent extends Error {
  override readonly name = 'NotSent';
}

const RETRY_STATES = new Set(['40P01', '40001']);
const SQLSTATE = /^[0-9A-Z]{5}$/;
const CONSTRAINT = /^[a-z][a-z0-9_]{1,62}$/;

/** Issue d'une erreur : rejeu (interblocage) ; sinon revue, avec un code borné, jamais un message. */
export function classifyMitError(error: unknown): MitChargeOutcome {
  if (isPaymentError(error)) return { step: 'ATTENTION', code: error.code };
  const e = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const state = typeof e['code'] === 'string' && SQLSTATE.test(e['code']) ? e['code'] : null;
  if (state === null) return { step: 'ATTENTION', code: 'UNEXPECTED_ERROR' };
  if (RETRY_STATES.has(state)) return { step: 'RETRY', code: state };
  const constraint =
    typeof e['constraint'] === 'string' && CONSTRAINT.test(e['constraint'])
      ? e['constraint'].toUpperCase()
      : `DB_${state}`;
  return { step: 'ATTENTION', code: constraint };
}

function settledStep(r: SettleResult): MitChargeOutcome {
  switch (r.outcome) {
    case 'CHARGED':
      return { step: 'CHARGED', code: null };
    case 'AWAITING_PROOF':
      return { step: 'CHARGED', code: 'AWAITING_PROOF' };
    case 'RETRY_DUE':
      return { step: 'RETRY_DUE', code: r.code };
    case 'DEBT':
      return { step: 'DEBT', code: r.code };
    case 'IN_FLIGHT':
      return { step: 'WAITING', code: r.code };
    case 'DONE':
    case 'NOT_FOUND':
      return { step: 'DONE', code: r.code };
  }
}

export class MitChargeScheduler {
  readonly #deps: MitChargeSchedulerDeps;
  readonly #storeOf: (db: SqlClient) => MitChargeStore;
  readonly #newId: () => string;

  constructor(deps: MitChargeSchedulerDeps) {
    this.#deps = deps;
    this.#storeOf = deps.storeOf ?? ((db) => new PgMitChargeStore(db));
    this.#newId = deps.newId ?? randomUUID;
  }

  /** Traite un débit de la file ; ne lève jamais : toute issue est rendue. */
  async process(due: DueCharge): Promise<MitChargeOutcome> {
    const connector = this.#deps.connectors.get(due.provider);
    if (connector === undefined) return { step: 'NO_CONNECTOR', code: null };
    try {
      if (due.status !== 'CHARGED') {
        const planned = await this.#deps.transactions.run(PAYMENT_COMMAND_WORKER, (db) =>
          this.#storeOf(db).plan(due.chargeId, this.#newId()),
        );
        switch (planned.outcome) {
          case 'NOT_DUE':
            return { step: 'NOT_DUE', code: planned.code };
          case 'BLOCKED':
            return { step: 'BLOCKED', code: planned.code };
          case 'DEBT':
            return { step: 'DEBT', code: planned.code };
          case 'DONE':
          case 'NOT_FOUND':
            return { step: 'DONE', code: planned.code };
          case 'PLANNED':
          case 'IN_FLIGHT':
          case 'SETTLE':
            break;
        }
      }
      return await this.#deps.transactions.run(PAYMENT_COMMAND_WORKER, (db) =>
        this.#sendAndSettle(this.#storeOf(db), connector, due),
      );
    } catch (error) {
      const outcome =
        error instanceof NotSent
          ? { step: 'WAITING' as const, code: 'NOT_SENT' }
          : classifyMitError(error);
      this.#log({
        level: outcome.step === 'RETRY' || outcome.step === 'WAITING' ? 'info' : 'warn',
        event: 'charge',
        step: outcome.step,
        code: outcome.code ?? '',
      });
      return outcome;
    }
  }

  async #sendAndSettle(
    store: MitChargeStore,
    connector: PaymentProvider,
    due: DueCharge,
  ): Promise<MitChargeOutcome> {
    let doNotRetry = false;
    if (due.status !== 'CHARGED') {
      const order = await store.orderForSend(due.chargeId);
      if (order.sendable) {
        if (
          order.operationId === null ||
          order.status === null ||
          order.idemSent === null ||
          order.amountMinor === null ||
          order.currency === null ||
          order.legs === null ||
          order.instrumentToken === null ||
          order.reason === null
        ) {
          return { step: 'ATTENTION', code: 'ORDER_UNREADABLE' };
        }
        const sent: SendOutcome = await new MoneyCommandSender(connector, store).send({
          operationId: order.operationId,
          kind: 'MIT_CHARGE',
          status: order.status,
          idemSent: order.idemSent,
          amountMinor: order.amountMinor,
          currency: order.currency,
          legs: order.legs,
          targetReference: null,
          providerReference: order.providerReference,
          mit: { reason: order.reason, instrumentToken: order.instrumentToken },
        });
        switch (sent.outcome) {
          case 'NOT_SENT':
            // PSP injoignable avant l'envoi : rien n'est parti ; la transaction est annulée
            throw new NotSent('débit non envoyé');
          case 'ESCALATE':
            // aucune lecture possible : rien n'est envoyé, revue FIN
            return { step: 'ATTENTION', code: sent.reason };
          case 'AWAITING_PROOF':
            if (sent.refused === 'MISMATCH') return { step: 'ATTENTION', code: 'MISMATCH' };
            return { step: 'WAITING', code: 'UNPROVEN' };
          case 'FAILED':
            doNotRetry = sent.doNotRetry;
            break;
          case 'SUCCEEDED':
          case 'SUBMITTED':
          case 'UNKNOWN':
          case 'ALREADY_FINAL':
            break;
        }
      } else if (
        order.operationId !== null &&
        order.status !== 'SUCCEEDED' &&
        order.status !== 'FAILED'
      ) {
        // tentative sans statut mais carte consentie retirée : rien n'est envoyé, revue
        return { step: 'ATTENTION', code: 'NO_INSTRUMENT' };
      }
    }
    return settledStep(await store.settle(due.chargeId, doNotRetry));
  }

  #log(fields: Record<string, string>): void {
    this.#deps.log?.(JSON.stringify({ worker: MIT_CHARGE_SCHEDULER_WORKER, ...fields }));
  }
}

/**
 * Tâche périodique `mit_charge_scheduler` : la file est lue sous le nom `payment_command` (la base
 * l'exige), puis chaque débit est traité dans ses propres transactions ; seuls des comptes sont
 * journalisés (aucun identifiant, 17 §6.3).
 */
export function registerMitChargeScheduler(
  registry: BusRegistry,
  transactions: WorkerTransactions,
  log: (line: string) => void,
  connectors: PaymentConnectorRegistry,
): void {
  const scheduler = new MitChargeScheduler({ transactions, connectors, log });
  registry.registerPeriodic(
    MIT_CHARGE_SCHEDULER_WORKER,
    MIT_CHARGE_SCHEDULER_PERIOD_SECONDS,
    async (_payload, tx) => {
      await tx.query(`SELECT pg_catalog.set_config('app.worker_name', $1, true)`, [
        PAYMENT_COMMAND_WORKER,
      ]);
      const due = await new PgMitChargeStore(tx).due(MIT_CHARGE_SCHEDULER_BATCH);
      const counts: Record<string, number> = {};
      for (const d of due) {
        // `process` ne lève pas : un débit ne bloque jamais les suivants
        const r = await scheduler.process(d);
        const key = r.step.toLowerCase();
        counts[key] = (counts[key] ?? 0) + 1;
      }
      log(
        JSON.stringify({
          level: 'info',
          worker: MIT_CHARGE_SCHEDULER_WORKER,
          due: due.length,
          ...counts,
        }),
      );
    },
  );
}
