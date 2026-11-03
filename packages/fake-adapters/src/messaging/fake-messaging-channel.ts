/**
 * FAKE du port `MessagingChannel` (modules NTF et MSG ; 17 §5 « SMS », « Email transactionnel »,
 * §10 ; US-020). Un adaptateur par canal (`EMAIL` ou `SMS`), comme un fournisseur par canal en
 * production. Message d'un autre canal ⇒ `UNSUPPORTED_CHANNEL` (capacité inconnue = « non »).
 *
 * Contrôles : destinataire mal formé (email, numéro E.164) ⇒ `INVALID_RECIPIENT` ; destinataire
 * bloqué par le test (`block`) ⇒ `BLOCKED`. Le contenu est rendu par NTF (gabarits es / en / fr,
 * US-021) : le FAKE transporte le texte reçu et n'en fabrique aucun.
 *
 * Cas difficiles : scénario `send` (panne, délai, issue inconnue, refus, **doublon** : le message
 * part deux fois) et scénario `receipt` appliqué à chaque accusé (`DUPLICATE` ⇒ deux accusés,
 * `REFUSE` ⇒ accusé `BOUNCED`, `UNAVAILABLE` ⇒ accusé perdu, `DELAY` ⇒ accusé en retard).
 *
 * Données personnelles : `sent()` garde le destinataire en mémoire du test seulement (C2) ; rien
 * n'est écrit ni journalisé.
 */
import { assertFakeAllowed } from '../guard.ts';
import type { EnvironmentVariables } from '../guard.ts';
import type { FakeClock } from '../core/clock.ts';
import type { Outcome } from '../core/outcome.ts';
import { FakeRuntime, Sequence } from '../core/runtime.ts';

export type MessageChannelKind = 'EMAIL' | 'SMS';

export interface OutboundMessage {
  readonly idempotencyKey: string;
  readonly channel: MessageChannelKind;
  /** Adresse email ou numéro E.164. */
  readonly to: string;
  /** Langue du gabarit rendu (es, en, fr, ou locale régionale de la configuration). */
  readonly locale: string;
  readonly templateKey: string;
  readonly subject: string | null;
  readonly body: string;
}

export interface MessageAccepted {
  readonly messageId: string;
}

export type MessagingRefusal = 'INVALID_RECIPIENT' | 'BLOCKED' | 'UNSUPPORTED_CHANNEL';

export type DeliveryStatus = 'DELIVERED' | 'BOUNCED';

export interface DeliveryReceipt {
  readonly receiptId: string;
  readonly messageId: string;
  readonly status: DeliveryStatus;
  readonly occurredAt: Date;
}

export interface SentMessage extends OutboundMessage {
  readonly messageId: string;
  readonly sentAt: Date;
}

export interface FakeMessagingChannelOptions {
  readonly clock: FakeClock;
  readonly channel: MessageChannelKind;
  readonly env?: EnvironmentVariables;
}

type MessagingOp = 'send' | 'receipt';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

export class FakeMessagingChannel {
  readonly channel: MessageChannelKind;
  readonly runtime: FakeRuntime<MessagingOp, MessagingRefusal | 'BOUNCED'>;
  readonly #sent: SentMessage[] = [];
  readonly #blocked = new Set<string>();
  readonly #receipts: { readonly dueAtMs: number; readonly receipt: DeliveryReceipt }[] = [];
  readonly #messageIds: Sequence;
  readonly #receiptIds: Sequence;

  constructor(options: FakeMessagingChannelOptions) {
    assertFakeAllowed('FakeMessagingChannel', options.env);
    this.channel = options.channel;
    this.runtime = new FakeRuntime(options.clock);
    const prefix = options.channel === 'EMAIL' ? 'fk_mail' : 'fk_sms';
    this.#messageIds = new Sequence(prefix);
    this.#receiptIds = new Sequence(`${prefix}_rcpt`);
  }

  async send(message: OutboundMessage): Promise<Outcome<MessageAccepted, MessagingRefusal>> {
    return this.runtime.execute(
      'send',
      { idempotencyKey: message.idempotencyKey, content: message },
      (times) => {
        if (message.channel !== this.channel) {
          return { ok: false, reason: 'UNSUPPORTED_CHANNEL' as const };
        }
        if (!(this.channel === 'EMAIL' ? EMAIL : E164).test(message.to)) {
          return { ok: false, reason: 'INVALID_RECIPIENT' as const };
        }
        if (this.#blocked.has(message.to)) return { ok: false, reason: 'BLOCKED' as const };
        const messageId = this.#messageIds.next();
        for (let i = 0; i < times; i++) {
          this.#sent.push({ ...message, messageId, sentAt: this.runtime.clock.now() });
        }
        this.#emitReceipt(messageId);
        return { ok: true, value: { messageId } };
      },
    );
  }

  // --- Pilotage par le test -------------------------------------------------------------------

  /** Le destinataire refuse les messages (liste d'opposition, numéro bloqué). */
  block(to: string): void {
    this.#blocked.add(to);
  }

  /** Messages réellement partis (un doublon y figure deux fois). */
  sent(): readonly SentMessage[] {
    return [...this.#sent];
  }

  /** Accusés arrivés à échéance, dans l'ordre ; retirés de la file. */
  takeReceipts(): DeliveryReceipt[] {
    const now = this.runtime.clock.nowMs();
    const due = this.#receipts.filter((r) => r.dueAtMs <= now);
    for (const r of due) this.#receipts.splice(this.#receipts.indexOf(r), 1);
    return due.map((r) => r.receipt);
  }

  #emitReceipt(messageId: string): void {
    const step = this.runtime.script.next('receipt');
    if (
      step.kind === 'UNAVAILABLE' ||
      step.kind === 'TIMEOUT_BEFORE' ||
      step.kind === 'TIMEOUT_AFTER'
    ) {
      return; // accusé perdu
    }
    const dueAtMs = this.runtime.clock.nowMs() + (step.kind === 'DELAY' ? step.ms : 0);
    const receipt: DeliveryReceipt = {
      receiptId: this.#receiptIds.next(),
      messageId,
      status: step.kind === 'REFUSE' ? 'BOUNCED' : 'DELIVERED',
      occurredAt: new Date(dueAtMs),
    };
    const times = step.kind === 'DUPLICATE' ? 2 : 1;
    for (let i = 0; i < times; i++) this.#receipts.push({ dueAtMs, receipt });
  }
}
