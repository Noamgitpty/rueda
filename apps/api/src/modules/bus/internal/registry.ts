/**
 * Abonnements : quel consommateur reçoit quels types d'événements (17 §4.5, colonne
 * « Consommateurs »), et quelles minuteries (17 §2.11) existent. Un consommateur = un travailleur
 * nommé (`app.worker_name`) = une file : la RLS lui réserve ses tâches et ses reçus (0102).
 */
import type { DomainEvent, JsonObject } from './envelope.js';
import { EVENT_TYPE_PATTERN } from './envelope.js';
import type { SqlClient } from './sql.js';
import { assertWorkerName } from './sql.js';

/** Nom réservé du relais (politiques de 0102). */
export const OUTBOX_RELAY_WORKER = 'outbox_relay';

/**
 * Traitement d'un événement, **dans la transaction** qui écrit le reçu `inbox_receipt` : ses
 * écritures et le reçu sont validés ensemble, ou rien. Aucun appel externe non idempotent ici.
 */
export type EventHandler = (event: DomainEvent, tx: SqlClient) => Promise<void>;

/**
 * Minuterie : idempotente, elle revérifie l'état avant d'agir (17 §2.11 : une minuterie en retard
 * n'agit pas sur un trip déjà annulé). Charge utile = références seulement.
 */
export type TimerHandler = (payload: JsonObject, tx: SqlClient) => Promise<void>;

export type QueueHandler =
  | {
      readonly kind: 'consumer';
      readonly eventTypes: ReadonlySet<string>;
      readonly handle: EventHandler;
    }
  | { readonly kind: 'timer'; readonly handle: TimerHandler };

export class BusRegistry {
  readonly #queues = new Map<string, QueueHandler>();

  /** Abonne le consommateur `consumer` aux types d'événements donnés. */
  registerConsumer(consumer: string, eventTypes: readonly string[], handle: EventHandler): void {
    this.#reserve(consumer);
    if (eventTypes.length === 0) throw new TypeError(`${consumer} : aucun type d'événement`);
    for (const type of eventTypes) {
      if (!EVENT_TYPE_PATTERN.test(type))
        throw new TypeError(`type d'événement invalide : ${type}`);
    }
    this.#queues.set(consumer, { kind: 'consumer', eventTypes: new Set(eventTypes), handle });
  }

  /** Déclare la minuterie `name` (file du même nom). */
  registerTimer(name: string, handle: TimerHandler): void {
    this.#reserve(name);
    this.#queues.set(name, { kind: 'timer', handle });
  }

  /** Consommateurs abonnés à `type`, triés (fan-out déterministe). */
  consumersOf(type: string): string[] {
    const out: string[] = [];
    for (const [name, q] of this.#queues) {
      if (q.kind === 'consumer' && q.eventTypes.has(type)) out.push(name);
    }
    return out.sort();
  }

  handlerOf(name: string): QueueHandler | undefined {
    return this.#queues.get(name);
  }

  queueNames(): string[] {
    return [...this.#queues.keys()].sort();
  }

  #reserve(name: string): void {
    assertWorkerName(name);
    if (name === OUTBOX_RELAY_WORKER) throw new TypeError(`${name} : nom réservé au relais`);
    if (this.#queues.has(name)) throw new TypeError(`${name} : déjà déclaré`);
  }
}
