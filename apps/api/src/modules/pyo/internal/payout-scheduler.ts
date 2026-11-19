/**
 * Ordonnanceur des versements à l'hôte (US-708, ADR-185 ; 19 US-708 critères 1 à 3 ; 08 SM-6,
 * BR-PAYOUT-02, E7 règle 6 ; 17 §2.8 `releaseLeg`, `payout`, §0.1 interrupteurs).
 *
 * Tâche périodique `payout_scheduler` (60 s), sous le nom de travailleur `payment_command` (la base
 * l'exige), une transaction par trip ou par lot :
 *
 * 1. préparation des trips COMPLETED (`core.payout_cmd_prepare_trip`) : `payout_at` (J+2 ouvrés du
 *    pays, J+5 au premier versement), `release_at` (écrivain unique), lot, item, montants et motifs
 *    de retenue — tout est calculé et gardé par la base ; aucun appel au PSP ;
 * 2. `NET` (échéance atteinte) : compensation du `host_ledger`, READY / ZERO_NET, ou ON_HOLD ;
 * 3. `RELEASE` : sans connecteur pour le fournisseur (production avant le lot C : aucun), RIEN ;
 *    sinon motifs RELUS sous les verrous des trips et du lot (gardés pendant les appels), puis, pour
 *    chaque item, l'ordre `LEG_RELEASE` vivant ou un nouvel ordre au rang suivant (après un refus
 *    reçu seulement), envoyé par `MoneyCommandSender` (lecture d'abord si l'issue est inconnue ou
 *    sans en-tête d'idempotence, même clé, montant explicite) puis reporté sur les soldes ;
 * 4. `PAYOUT` : quand chaque item est libéré, émission du lot (`core.payout_cmd_initiate_batch`,
 *    motifs relus À L'ENVOI, garde de la table sur `payouts_enabled`), puis `payout` du connecteur
 *    avec la clé `payout:{lot}:r{n}` ; un lot déjà émis est LU avant tout renvoi.
 *
 * Variante B (`PLATFORM_MOR`) : retenue par la base (`FUNDS_HOLDING_DISABLED`,
 * `VARIANT_B_UNAVAILABLE`) avant tout ordre ; rien n'est appelé. `process` ne lève jamais : une
 * erreur ne bloque pas les lots suivants. Le journal ne porte que des comptes et des codes.
 */
import { randomUUID } from 'node:crypto';
import type { BusRegistry, SqlClient, WorkerTransactions } from '../../bus/index.js';
import { idempotencyKeyToSend, isPaymentError, MoneyCommandSender } from '../../pay/index.js';
import type {
  OperationStatus,
  PaymentConnectorRegistry,
  PaymentProvider,
  ProviderOperation,
} from '../../pay/index.js';
import type { DueBatch, PayoutBatchStore, PayoutOrder, ReleaseItem } from './payout-batch-store.js';
import { PgPayoutBatchStore } from './pg-payout-batch-store.js';

/** Nom de la tâche périodique (file du travailleur). */
export const PAYOUT_SCHEDULER_WORKER = 'payout_scheduler';
/** Travailleur des commandes d'argent : nom exigé par la base pour chaque commande appelée. */
const PAYMENT_COMMAND_WORKER = 'payment_command';
/** Période (PROPOSÉ, ADR-185) : lot quotidien à heure locale, préparation au fil de l'eau. */
export const PAYOUT_SCHEDULER_PERIOD_SECONDS = 60;
/** Trips préparés et lots traités par passage, un par transaction. */
export const PAYOUT_SCHEDULER_BATCH = 50;

export type PayoutBatchStep =
  /** Aucun connecteur pour le fournisseur : rien n'est envoyé (fail-closed). */
  | 'NO_CONNECTOR'
  /** Motif de retenue lu par la base (interrupteur, gel, compte, variante B…). */
  | 'ON_HOLD'
  /** Lot compensé : READY ou ZERO_NET. */
  | 'NETTED'
  /** Échéance non atteinte, déjà fait, rien à faire. */
  | 'IDLE'
  /** Libérations envoyées ou en attente d'une issue. */
  | 'RELEASING'
  /** Versement émis ou en cours au PSP. */
  | 'PAYOUT_SENT'
  | 'PAID'
  | 'FAILED'
  /** Issue inconnue, PSP injoignable : repris au passage suivant (lecture d'abord). */
  | 'WAITING'
  /** Revue FIN : aucune lecture possible, refus de la base ou du connecteur. */
  | 'ATTENTION'
  /** Interblocage ou sérialisation : repris au passage suivant. */
  | 'RETRY';

export interface PayoutSchedulerDeps {
  readonly transactions: WorkerTransactions;
  /** Connecteurs PSP par fournisseur (production : aucun avant le lot C). */
  readonly connectors: PaymentConnectorRegistry;
  /** Stockage de la transaction (production : PostgreSQL). */
  readonly storeOf?: (db: SqlClient) => PayoutBatchStore;
  /** Journal d'exploitation : comptes et codes seulement (17 §6.3). */
  readonly log?: (line: string) => void;
  readonly newId?: () => string;
}

const RETRY_STATES = new Set(['40P01', '40001']);

export class PayoutScheduler {
  readonly #deps: PayoutSchedulerDeps;
  readonly #storeOf: (db: SqlClient) => PayoutBatchStore;
  readonly #newId: () => string;

  constructor(deps: PayoutSchedulerDeps) {
    this.#deps = deps;
    this.#storeOf = deps.storeOf ?? ((db) => new PgPayoutBatchStore(db));
    this.#newId = deps.newId ?? randomUUID;
  }

  /** Prépare un trip dans sa transaction ; rend l'issue de la base (ou un code d'erreur). */
  async prepare(tripId: string): Promise<string> {
    try {
      const r = await this.#deps.transactions.run(PAYMENT_COMMAND_WORKER, (db) =>
        this.#storeOf(db).prepareTrip(tripId),
      );
      return r.outcome;
    } catch (error) {
      return classify(error) === 'RETRY' ? 'RETRY' : 'ERROR';
    }
  }

  /** Traite un lot dans sa transaction ; ne lève jamais. */
  async process(due: DueBatch): Promise<PayoutBatchStep> {
    try {
      if (due.step === 'NET') {
        const r = await this.#deps.transactions.run(PAYMENT_COMMAND_WORKER, (db) =>
          this.#storeOf(db).netBatch(due.batchId),
        );
        if (r.outcome === 'ON_HOLD') return 'ON_HOLD';
        return r.outcome === 'READY' || r.outcome === 'ZERO_NET' ? 'NETTED' : 'IDLE';
      }
      const connector = this.#deps.connectors.get(due.provider);
      if (connector === undefined) return 'NO_CONNECTOR';
      return await this.#deps.transactions.run(PAYMENT_COMMAND_WORKER, (db) =>
        this.#send(this.#storeOf(db), connector, due),
      );
    } catch (error) {
      const c = classify(error);
      this.#log({ level: c === 'RETRY' ? 'info' : 'warn', event: 'batch', outcome: c });
      return c;
    }
  }

  async #send(
    store: PayoutBatchStore,
    connector: PaymentProvider,
    due: DueBatch,
  ): Promise<PayoutBatchStep> {
    if (due.step === 'RELEASE') {
      // relu À L'ENVOI, sous les verrous des trips puis du lot (L3-PM-30, L3-PM-34)
      const check = await store.recheckBatch(due.batchId);
      if (check.outcome === 'ON_HOLD') return 'ON_HOLD';
      if (check.outcome !== 'READY') return 'IDLE';
      const items = await store.releaseItems(due.batchId);
      let pending = 0;
      for (const item of items) {
        const done = await this.#release(store, connector, item);
        if (done === 'ATTENTION') return 'ATTENTION';
        if (done !== 'RELEASED') pending += 1;
      }
      if (pending > 0) return 'RELEASING';
    }
    return this.#payout(store, connector, await store.initiate(due.batchId), due.batchId);
  }

  /** Une libération par item : l'ordre vivant, ou un nouvel ordre au rang suivant. */
  async #release(
    store: PayoutBatchStore,
    connector: PaymentProvider,
    item: ReleaseItem,
  ): Promise<'RELEASED' | 'PENDING' | 'ATTENTION'> {
    if (item.beneficiaryReference === null) return 'ATTENTION';
    let operationId = item.operationId;
    let status: OperationStatus | null = item.operationStatus;
    let idemSent = item.idemSent;
    if (operationId === null || status === 'FAILED') {
      // nouvel ordre : rang et clé STOCKÉS par la base, la base refuse tout autre rang ou montant
      idemSent = idempotencyKeyToSend(
        item.nextKey,
        connector.capabilities().int('IDEMPOTENCY_KEY_MAX_LEN'),
      );
      operationId = await store.recordRelease({
        operationId: this.#newId(),
        tripId: item.tripId,
        pspAccountId: item.pspAccountId,
        amountMinor: item.amountMinor,
        currency: item.currency,
        attemptNo: item.nextAttempt,
        idemPlain: item.nextKey,
        idemSent,
      });
      status = 'PENDING';
    }
    if (status !== 'SUCCEEDED') {
      const sent = await new MoneyCommandSender(connector, store).send({
        operationId,
        kind: 'LEG_RELEASE',
        status: status ?? 'PENDING',
        idemSent: idemSent ?? '',
        amountMinor: item.amountMinor,
        currency: item.currency,
        legs: { HOST: item.amountMinor, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n },
        targetReference: null,
        providerReference: item.providerReference,
        release: { tripReference: item.tripId, beneficiaryReference: item.beneficiaryReference },
      });
      if (sent.outcome === 'ESCALATE') return 'ATTENTION';
      // en vol, inconnue, refusée (nouveau rang au passage suivant) ou preuve attendue
      if (sent.outcome !== 'SUCCEEDED') return 'PENDING';
    }
    if (!item.applied) await store.applyRelease(operationId);
    return 'RELEASED';
  }

  /** Versement du lot : lecture d'abord pour un lot déjà émis ou sans en-tête d'idempotence. */
  async #payout(
    store: PayoutBatchStore,
    connector: PaymentProvider,
    order: PayoutOrder,
    batchId: string,
  ): Promise<PayoutBatchStep> {
    if (order.outcome === 'ON_HOLD') return 'ON_HOLD';
    if (order.outcome === 'RELEASE_PENDING') return 'RELEASING';
    if (order.outcome !== 'INITIATED' && order.outcome !== 'REPLAY') return 'IDLE';
    const key = order.idempotencyKey;
    if (
      key === null ||
      order.amountMinor === null ||
      order.currency === null ||
      order.submerchantReference === null
    ) {
      return 'ATTENTION';
    }
    const caps = connector.capabilities();
    if (order.outcome === 'REPLAY' || !caps.bool('SUPPORTS_IDEMPOTENCY_HEADER')) {
      const byKey = caps.bool('SUPPORTS_LOOKUP_BY_MERCHANT_REF');
      if (!byKey && order.providerRef === null) return 'ATTENTION';
      let found: ProviderOperation | null;
      try {
        found = await connector.getOperation(
          byKey ? { merchantReference: key } : { providerReference: order.providerRef ?? '' },
        );
      } catch (error) {
        if (isPaymentError(error)) return 'WAITING';
        throw error;
      }
      if (found !== null)
        return this.#result(store, batchId, found.status, found.providerReference);
    }
    try {
      const r = await connector.payout({
        idempotencyKey: key,
        submerchantReference: order.submerchantReference,
        amountMinor: order.amountMinor,
        currency: order.currency,
      });
      return await this.#result(store, batchId, r.status, r.providerReference);
    } catch (error) {
      if (!isPaymentError(error)) throw error;
      if (error.code === 'DECLINED') return this.#result(store, batchId, 'FAILED', null);
      if (error.code === 'UNKNOWN_OUTCOME' || error.code === 'PROVIDER_UNAVAILABLE') {
        return 'WAITING';
      }
      return 'ATTENTION';
    }
  }

  async #result(
    store: PayoutBatchStore,
    batchId: string,
    status: OperationStatus,
    providerRef: string | null,
  ): Promise<PayoutBatchStep> {
    const s = await store.recordPayoutResult(batchId, status, providerRef);
    if (s === 'PAID') return 'PAID';
    if (s === 'FAILED') return 'FAILED';
    return s === 'IN_TRANSIT' ? 'PAYOUT_SENT' : 'WAITING';
  }

  #log(fields: Record<string, string>): void {
    this.#deps.log?.(JSON.stringify({ worker: PAYOUT_SCHEDULER_WORKER, ...fields }));
  }
}

/** Interblocage ou sérialisation ⇒ reprise ; toute autre erreur ⇒ revue (jamais un message). */
function classify(error: unknown): 'RETRY' | 'ATTENTION' {
  const e = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  return typeof e['code'] === 'string' && RETRY_STATES.has(e['code']) ? 'RETRY' : 'ATTENTION';
}

/**
 * Tâche périodique `payout_scheduler` : les files sont lues sous le nom `payment_command`, puis
 * chaque trip et chaque lot sont traités dans leur propre transaction ; seuls des comptes sont
 * journalisés (aucun identifiant, 17 §6.3).
 */
export function registerPayoutScheduler(
  registry: BusRegistry,
  transactions: WorkerTransactions,
  log: (line: string) => void,
  connectors: PaymentConnectorRegistry,
): void {
  const scheduler = new PayoutScheduler({ transactions, connectors, log });
  registry.registerPeriodic(
    PAYOUT_SCHEDULER_WORKER,
    PAYOUT_SCHEDULER_PERIOD_SECONDS,
    async (_payload, tx) => {
      await tx.query(`SELECT pg_catalog.set_config('app.worker_name', $1, true)`, [
        PAYMENT_COMMAND_WORKER,
      ]);
      const store = new PgPayoutBatchStore(tx);
      const trips = await store.tripsToPrepare(PAYOUT_SCHEDULER_BATCH);
      const due = await store.dueBatches(PAYOUT_SCHEDULER_BATCH);
      const counts: Record<string, number> = {};
      for (const trip of trips) {
        const key = `prepare_${(await scheduler.prepare(trip)).toLowerCase()}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      for (const d of due) {
        // `process` ne lève pas : un lot ne bloque jamais les suivants
        const key = (await scheduler.process(d)).toLowerCase();
        counts[key] = (counts[key] ?? 0) + 1;
      }
      log(
        JSON.stringify({
          level: 'info',
          worker: PAYOUT_SCHEDULER_WORKER,
          trips: trips.length,
          due: due.length,
          ...counts,
        }),
      );
    },
  );
}
