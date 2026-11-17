/**
 * Ordonnanceur des remboursements planifiés (US-224, partie 224c ; ADR-150 ; 19 US-224 critères 1
 * et 4 ; 08 SM-8, E4, BR-PAY-08 ; 17 §2.8, §4.3 points 1 à 4).
 *
 * Un remboursement naît `PLANNED` avec son ordre `REFUND` PENDING (instance d'US-224b, créée par
 * le règlement d'une annulation, US-215). Ce service, tâche périodique `refund_scheduler` (10 s),
 * traite chaque instance de la file `core.payment_refunds_due` dans SA transaction du travailleur
 * `payment_command` :
 *
 * 1. `PLANNED` : sans connecteur pour le fournisseur de l'ordre (production avant le lot C : aucun),
 *    RIEN n'est autorisé ni envoyé ; sinon envoi autorisé (`core.payment_cmd_submit_refund`) :
 *    `SUBMITTED` (date d'émission), `BLOCKED` (avance de Kmino sans décision FINANCE à deux
 *    personnes : alerte FIN `FIN_REFUND_BLOCKED`, critère 4), `SUPERSEDED`, déjà fait ;
 * 2. `SUBMITTED` / `SENT` : l'ordre STOCKÉ est relu sous le verrou du trip PUIS de l'ordre
 *    (`core.payment_cmd_refund_order_for_send`), verrous gardés jusqu'au COMMIT, donc PENDANT
 *    l'appel au PSP ; statut et version en tête relus (un ordre jamais envoyé d'une version
 *    remplacée ne part pas : revue FIN) ; `MoneyCommandSender` (lecture d'abord si l'issue est
 *    inconnue, même clé d'idempotence, montant explicite de chaque jambe, jamais recalculé) ;
 *    l'instance suit le statut de l'ordre (déclencheur de 0127 : `SENT`, `CONFIRMED`, `FAILED`) ;
 * 3. `CONFIRMED` prouvé : report sur les soldes des jambes (`core.settlement_cmd_apply_leg_movement`,
 *    l'avance de Kmino décidée devient `OPEN`) ;
 * 4. `FAILED` : alerte FIN `FIN_REFUND_FAILED` (une fois). Nouvelle tentative et choix du rail :
 *    suite (SM-8 `PENDING_CUSTOMER_CHOICE`).
 *
 * Une instance ne bloque jamais les suivantes (`process` ne lève pas). Chaque état n'est signalé
 * qu'une fois (`fin_alert`, posé APRÈS l'envoi de l'alerte : une alerte perdue est rejouée). Les
 * alertes et le journal ne portent que des comptes et des codes (17 §6.3).
 */
import type { AlertChannel, BusRegistry, SqlClient, WorkerTransactions } from '../../bus/index.js';
import {
  MoneyCommandSender,
  PgOperationRecorder,
  PgRefundOrders,
  PgRefundPlanner,
  isPaymentError,
  type DueRefund,
  type PaymentConnectorRegistry,
  type PaymentProvider,
} from '../../pay/index.js';

/** Nom de la tâche périodique (file du travailleur). */
export const REFUND_SCHEDULER_WORKER = 'refund_scheduler';
/** Travailleur des commandes d'argent : nom exigé par la base pour chaque commande appelée. */
const PAYMENT_COMMAND_WORKER = 'payment_command';
/** Période (PROPOSÉ, ADR-150) : comme la conversion et les annulations (10 s). */
export const REFUND_SCHEDULER_PERIOD_SECONDS = 10;
/** Instances traitées par passage, une par transaction. */
export const REFUND_SCHEDULER_BATCH = 50;

export type RefundStep =
  /** Aucun connecteur pour le fournisseur : rien n'est autorisé ni envoyé (fail-closed). */
  | 'NO_CONNECTOR'
  /** Avance de Kmino sans décision FINANCE à deux personnes (critère 4). */
  | 'BLOCKED'
  | 'SUPERSEDED'
  /** Rien à faire : déjà autorisée, déjà finale ou déjà reportée. */
  | 'DUPLICATE'
  /** Le PSP a pris l'ordre (en cours ou réussi). */
  | 'SENT'
  /** Issue inconnue, PSP injoignable ou preuve attendue : repris au passage suivant. */
  | 'WAITING'
  /** Refus du PSP : l'instance passe `FAILED`, signalée au passage suivant. */
  | 'FAILED'
  /** Remboursement reporté sur les soldes des jambes. */
  | 'REPORTED'
  /** Revue FIN (alerte) : escalade, envoi refusé, échec, refus de la base. */
  | 'ATTENTION'
  /** Interblocage ou sérialisation : repris au passage suivant. */
  | 'RETRY';

export type RefundAlertCode = 'FIN_REFUND_BLOCKED' | 'FIN_REFUND_FAILED';

export interface RefundOutcome {
  readonly step: RefundStep;
  /** Alerte FIN : `key` (posée dans `fin_alert`) n'est levée qu'une fois par instance. */
  readonly alert?: {
    readonly code: RefundAlertCode;
    readonly key: string;
    readonly errorCode: string;
  };
}

export interface RefundSchedulerDeps {
  readonly transactions: WorkerTransactions;
  readonly alerts: AlertChannel;
  /** Connecteurs PSP par fournisseur (production : aucun avant le lot C). */
  readonly connectors: PaymentConnectorRegistry;
  /** Journal d'exploitation : comptes et codes seulement (17 §6.3). */
  readonly log?: (line: string) => void;
}

const attention = (code: RefundAlertCode, key: string, errorCode: string): RefundOutcome => ({
  step: 'ATTENTION',
  alert: { code, key, errorCode },
});

export class RefundScheduler {
  readonly #deps: RefundSchedulerDeps;

  constructor(deps: RefundSchedulerDeps) {
    this.#deps = deps;
  }

  /** Traite une instance de la file ; ne lève jamais : toute issue est rendue. */
  async process(due: DueRefund): Promise<RefundOutcome> {
    let outcome: RefundOutcome;
    try {
      outcome =
        (await this.#precheck(due)) ??
        (await this.#deps.transactions.run(PAYMENT_COMMAND_WORKER, (db) => this.#step(db, due)));
    } catch (error) {
      outcome =
        error instanceof NotSent
          ? error.outcome
          : classifyRefundError(error, due.status === 'CONFIRMED' ? 'REPORT' : 'SEND');
      if (outcome.alert?.errorCode === UNEXPECTED_CODE) {
        this.#log({ level: 'error', event: 'unexpected', error_class: errorClass(error) });
      }
    }
    const alert = outcome.alert;
    if (alert !== undefined && alert.key !== due.finAlert) {
      try {
        await this.#deps.alerts.send({
          code: alert.code,
          severity: 'P1',
          counts: { refunds: 1 },
          labels: { country: due.country, error_code: alert.errorCode },
        });
        await this.#deps.transactions.run(PAYMENT_COMMAND_WORKER, (db) =>
          new PgRefundOrders(db).markAlerted(due.instanceId, alert.key),
        );
      } catch (error) {
        // alerte ou marque impossible : rejouée au passage suivant (jamais perdue en silence)
        this.#log({ level: 'warn', event: 'alert_deferred', error_class: errorClass(error) });
      }
    }
    return outcome;
  }

  /**
   * Avant toute transaction : sans connecteur, rien (aucune transaction ouverte) ; encaissement
   * sans référence PSP, rien ne peut partir : l'envoi n'est jamais autorisé (revue FIN).
   */
  #precheck(due: DueRefund): Promise<RefundOutcome | null> {
    if (due.status !== 'PLANNED' && due.status !== 'SUBMITTED' && due.status !== 'SENT') {
      return Promise.resolve(null);
    }
    if (this.#deps.connectors.get(due.provider) === undefined) {
      return Promise.resolve({ step: 'NO_CONNECTOR' });
    }
    if (due.status === 'PLANNED' && !due.targetKnown) {
      return Promise.resolve(attention('FIN_REFUND_FAILED', 'SEND:NO_TARGET', 'NO_TARGET'));
    }
    return Promise.resolve(null);
  }

  async #step(db: SqlClient, due: DueRefund): Promise<RefundOutcome> {
    switch (due.status) {
      case 'PLANNED': {
        const connector = this.#deps.connectors.get(due.provider);
        if (connector === undefined) return { step: 'NO_CONNECTOR' };
        const submitted = await new PgRefundPlanner(db).submit(due.instanceId);
        if (submitted.outcome === 'BLOCKED') {
          return {
            step: 'BLOCKED',
            alert: {
              code: 'FIN_REFUND_BLOCKED',
              key: `BLOCKED:${submitted.blockedReason}`,
              errorCode: submitted.blockedReason,
            },
          };
        }
        if (submitted.outcome !== 'SUBMITTED') return { step: submitted.outcome };
        // même transaction : l'envoi autorisé et l'appel au PSP sous les mêmes verrous. Rien n'a
        // atteint le PSP (injoignable, aucune lecture possible, ordre non envoyable) ⇒ la
        // transaction est ANNULÉE : l'instance reste PLANNED, sans date d'émission (ADR-150)
        const sent = await this.#send(db, due.instanceId, connector);
        if (sent.unsent) throw new NotSent(sent.outcome);
        return sent.outcome;
      }
      case 'SUBMITTED':
      case 'SENT': {
        const connector = this.#deps.connectors.get(due.provider);
        if (connector === undefined) return { step: 'NO_CONNECTOR' };
        return (await this.#send(db, due.instanceId, connector)).outcome;
      }
      case 'CONFIRMED': {
        const orders = new PgRefundOrders(db);
        const outcome = await orders.applyLegMovement(await orders.operationOf(due.instanceId));
        return { step: outcome === 'APPLIED' ? 'REPORTED' : 'DUPLICATE' };
      }
      case 'FAILED':
        return attention('FIN_REFUND_FAILED', 'FAILED', 'REFUND_FAILED');
      default:
        return { step: 'DUPLICATE' };
    }
  }

  async #send(
    db: SqlClient,
    instanceId: string,
    connector: PaymentProvider,
  ): Promise<{ readonly outcome: RefundOutcome; readonly unsent: boolean }> {
    const order = await new PgRefundOrders(db).orderForSend(instanceId);
    if (!order.sendable) {
      if (order.reason === 'SUPERSEDED_UNSENT' || order.reason === 'NO_TARGET') {
        return {
          outcome: attention('FIN_REFUND_FAILED', `SEND:${order.reason}`, order.reason),
          unsent: true,
        };
      }
      return { outcome: { step: 'DUPLICATE' }, unsent: true };
    }
    const sender = new MoneyCommandSender(connector, new PgOperationRecorder(db));
    const sent = await sender.send({
      operationId: order.operationId,
      kind: 'REFUND',
      status: order.status,
      idemSent: order.idemSent,
      amountMinor: order.amountMinor,
      currency: order.currency,
      legs: order.legs,
      targetReference: order.targetReference,
      providerReference: order.providerReference,
    });
    switch (sent.outcome) {
      case 'SUCCEEDED':
      case 'SUBMITTED':
        return { outcome: { step: 'SENT' }, unsent: false };
      case 'FAILED':
        // refus REÇU du PSP : l'ordre est parti (l'instance passe FAILED)
        return { outcome: { step: 'FAILED' }, unsent: false };
      case 'UNKNOWN':
        // issue inconnue : l'ordre a pu partir ; lu au passage suivant, jamais renvoyé sans lecture
        return { outcome: { step: 'WAITING' }, unsent: false };
      case 'NOT_SENT':
        // PSP injoignable : rien n'est parti
        return { outcome: { step: 'WAITING' }, unsent: true };
      case 'ALREADY_FINAL':
        return { outcome: { step: 'DUPLICATE' }, unsent: false };
      case 'ESCALATE':
        // aucune lecture possible : rien n'est envoyé
        return {
          outcome: attention('FIN_REFUND_FAILED', `SEND:${sent.reason}`, sent.reason),
          unsent: true,
        };
      case 'AWAITING_PROOF':
        // le PSP a répondu : UNPROVEN, la preuve signée (webhook) décide ; MISMATCH : montant
        // reçu ≠ ordre
        return {
          outcome:
            sent.refused === 'MISMATCH'
              ? attention('FIN_REFUND_FAILED', 'SEND:MISMATCH', 'MISMATCH')
              : { step: 'WAITING' },
          unsent: false,
        };
    }
  }

  #log(fields: Record<string, string>): void {
    this.#deps.log?.(JSON.stringify({ worker: REFUND_SCHEDULER_WORKER, ...fields }));
  }
}

/** Rien n'a atteint le PSP après l'envoi autorisé : la transaction est annulée (instance PLANNED). */
class NotSent extends Error {
  override readonly name = 'NotSent';
  constructor(readonly outcome: RefundOutcome) {
    super('remboursement non envoyé : envoi autorisé annulé');
  }
}

/** Code d'une erreur sans SQLSTATE ni code de PAY (programme, réseau). */
export const UNEXPECTED_CODE = 'UNEXPECTED_ERROR';

const RETRY_STATES = new Set(['40P01', '40001']);
const SQLSTATE = /^[0-9A-Z]{5}$/;
const CONSTRAINT = /^[a-z][a-z0-9_]{1,62}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,62}$/;

/**
 * Issue d'une erreur levée pendant le traitement d'une instance (la transaction est annulée) :
 * interblocage ou sérialisation ⇒ reprise ; refus de PAY (jambes, capacité, requête) ou de la base
 * (nom de contrainte en majuscules, à défaut `DB_<SQLSTATE>`) ⇒ revue FIN ; toute autre erreur ⇒
 * `UNEXPECTED_ERROR`. Jamais un message ni une valeur.
 */
export function classifyRefundError(error: unknown, phase: 'SEND' | 'REPORT'): RefundOutcome {
  if (isPaymentError(error)) {
    return attention('FIN_REFUND_FAILED', `${phase}:${error.code}`, error.code);
  }
  const e = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const state = typeof e['code'] === 'string' && SQLSTATE.test(e['code']) ? e['code'] : null;
  if (state === null)
    return attention('FIN_REFUND_FAILED', `${phase}:${UNEXPECTED_CODE}`, UNEXPECTED_CODE);
  if (RETRY_STATES.has(state)) return { step: 'RETRY' };
  const constraint =
    typeof e['constraint'] === 'string' && CONSTRAINT.test(e['constraint'])
      ? e['constraint'].toUpperCase()
      : `DB_${state}`;
  const code = CODE.test(constraint) ? constraint : `DB_${state}`;
  return attention('FIN_REFUND_FAILED', `${phase}:${code}`, code);
}

/** Classe d'une erreur (nom du constructeur borné), jamais son message (17 §6.3). */
function errorClass(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'Unknown';
}

/**
 * Tâche périodique `refund_scheduler` : la file est lue sous le nom `payment_command` (la base
 * l'exige), puis chaque instance est traitée dans sa propre transaction ; seuls des comptes sont
 * journalisés (aucun identifiant, 17 §6.3).
 */
export function registerRefundScheduler(
  registry: BusRegistry,
  transactions: WorkerTransactions,
  alerts: AlertChannel,
  log: (line: string) => void,
  connectors: PaymentConnectorRegistry,
): void {
  const scheduler = new RefundScheduler({ transactions, alerts, connectors, log });
  registry.registerPeriodic(
    REFUND_SCHEDULER_WORKER,
    REFUND_SCHEDULER_PERIOD_SECONDS,
    async (_payload, tx) => {
      await tx.query(`SELECT pg_catalog.set_config('app.worker_name', $1, true)`, [
        PAYMENT_COMMAND_WORKER,
      ]);
      const due = await new PgRefundOrders(tx).due(REFUND_SCHEDULER_BATCH);
      const counts: Record<string, number> = {};
      for (const d of due) {
        // `process` ne lève pas : une instance ne bloque jamais les suivantes
        const r = await scheduler.process(d);
        const key = r.step.toLowerCase();
        counts[key] = (counts[key] ?? 0) + 1;
      }
      log(
        JSON.stringify({
          level: 'info',
          worker: REFUND_SCHEDULER_WORKER,
          due: due.length,
          ...counts,
        }),
      );
    },
  );
}
