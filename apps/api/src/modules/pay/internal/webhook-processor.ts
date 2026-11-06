/**
 * Traitement asynchrone de la boîte de réception (17 §4.4 points 5 à 8), travailleur
 * `webhook_ingest` :
 *
 * - rattachement de chaque événement normalisé à son opération, par référence PSP (ou par notre
 *   clé si le PSP la renvoie) ; opération inconnue (webhook arrivé avant la fin de notre
 *   transaction) ⇒ `QUARANTINED`, nouvelle tentative pendant 15 min, puis `FAILED` et alerte ;
 * - **ordre jamais supposé** : le statut est appliqué par `core.payment_cmd_apply_operation_status`
 *   selon les rangs (rang inférieur ⇒ ignoré et journalisé ; terminal contradictoire ⇒ CONFLICT,
 *   rien ne change, file ops) ; doublons ⇒ `DUPLICATE` ;
 * - **lire puis appliquer** : si l'adaptateur du compte est disponible, l'état faisant foi est lu
 *   chez le PSP (`getOperation`) ; il prime sur le webhook en cas d'écart (source `POLL`).
 */
import { PaymentError } from './errors.js';
import type { PaymentLogger } from './webhook-ingest.js';
import type { NormalizedPaymentEvent, OperationStatus, PaymentProvider } from './port.js';
import type { InboxItem, WebhookWorkStore } from './stores.js';

export interface ProcessorReport {
  readonly processed: number;
  readonly quarantined: number;
  readonly failed: number;
  readonly conflicts: number;
}

/** Élément en quarantaine que le PSP n'a pas pu confirmer (US-049, RT-CONC-53). */
const UNVERIFIED = Symbol('UNVERIFIED');

export class WebhookProcessor {
  readonly #store: WebhookWorkStore;
  readonly #providerFor: (accountId: string) => PaymentProvider | undefined;
  readonly #log: PaymentLogger;

  constructor(
    store: WebhookWorkStore,
    providerFor: (accountId: string) => PaymentProvider | undefined,
    log: PaymentLogger,
  ) {
    this.#store = store;
    this.#providerFor = providerFor;
    this.#log = log;
  }

  async runOnce(limit = 50): Promise<ProcessorReport> {
    const report = { processed: 0, quarantined: 0, failed: 0, conflicts: 0 };
    for (const item of await this.#store.claim(limit)) {
      const result = await this.#processItem(item);
      report.conflicts += result.conflicts;
      if (result.state === 'PROCESSED') report.processed += 1;
      else if (result.state === 'QUARANTINED') report.quarantined += 1;
      else report.failed += 1;
    }
    return report;
  }

  async #processItem(
    item: InboxItem,
  ): Promise<{ state: 'PROCESSED' | 'QUARANTINED' | 'FAILED'; conflicts: number }> {
    let conflicts = 0;
    for (const event of item.events) {
      const operation = await this.#store.findOperation(item.accountId, {
        providerReference: event.providerReference,
        merchantReference: event.merchantReference,
      });
      if (operation === null) {
        if (item.quarantineExpired) {
          await this.#store.mark(item.inboxId, 'FAILED', 'OPERATION_NOT_FOUND');
          this.#log.warn('webhook : opération introuvable après la quarantaine', {
            inboxId: item.inboxId,
            provider: item.provider,
          });
          return { state: 'FAILED', conflicts };
        }
        await this.#store.mark(item.inboxId, 'QUARANTINED', 'OPERATION_NOT_FOUND');
        return { state: 'QUARANTINED', conflicts };
      }
      const decided = await this.#authoritative(item, event);
      if (decided === UNVERIFIED) {
        // US-049 (RT-CONC-53) : un webhook QUARANTINED n'est jamais cru sur parole ; sans lecture
        // du PSP il reste en quarantaine (nouvelle tentative), puis FAILED et alerte après 15 min
        if (item.quarantineExpired) {
          await this.#store.mark(item.inboxId, 'FAILED', 'PSP_READ_UNAVAILABLE');
          this.#log.warn('webhook : quarantaine non confirmée par le PSP', {
            inboxId: item.inboxId,
            provider: item.provider,
          });
          return { state: 'FAILED', conflicts };
        }
        await this.#store.mark(item.inboxId, 'QUARANTINED', 'PSP_READ_UNAVAILABLE');
        return { state: 'QUARANTINED', conflicts };
      }
      if (decided.status === 'PENDING') continue;
      const outcome = await this.#store.apply({
        operationId: operation.operationId,
        status: decided.status,
        source: decided.source,
        rawRef: item.inboxId,
        providerReference: event.providerReference,
      });
      if (outcome === 'CONFLICT') {
        conflicts += 1;
        this.#log.warn('webhook : statut contradictoire, file ops', {
          inboxId: item.inboxId,
          operationId: operation.operationId,
        });
      }
    }
    await this.#store.mark(item.inboxId, 'PROCESSED', null);
    return { state: 'PROCESSED', conflicts };
  }

  /**
   * « Lire puis appliquer » : l'état du PSP prime ; sans lecture possible, le webhook signé, mais
   * seulement s'il a été reçu dans la fenêtre (`RECEIVED`). Un élément `QUARANTINED` (horodatage
   * signé hors de ± 5 min, ou opération d'abord introuvable) exige une lecture réussie du PSP
   * (17 §4.4 point 2 : « QUARANTINED et déclenche getOperation ») ; sinon `UNVERIFIED`.
   */
  async #authoritative(
    item: InboxItem,
    event: NormalizedPaymentEvent,
  ): Promise<{ status: OperationStatus; source: 'WEBHOOK' | 'POLL' } | typeof UNVERIFIED> {
    const provider = this.#providerFor(item.accountId);
    if (provider !== undefined) {
      try {
        const found = await provider.getOperation({ providerReference: event.providerReference });
        if (found !== null && (found.status !== event.status || item.status !== 'RECEIVED')) {
          return { status: found.status, source: 'POLL' };
        }
      } catch (error) {
        if (!(error instanceof PaymentError)) throw error;
        // lecture impossible : seul un webhook RECEIVED reste la preuve (17 §4.4 point 2)
      }
    }
    if (item.status !== 'RECEIVED') return UNVERIFIED;
    return { status: event.status, source: 'WEBHOOK' };
  }
}
