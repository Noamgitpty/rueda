/**
 * Port `MessagingChannel` du module NTF (utilisé aussi par MSG ; 17 §5 « SMS », « Email
 * transactionnel », §10 ; ADR-012 ; US-020, ADR-057).
 *
 * Un adaptateur par canal (`EMAIL`, `SMS` ; WhatsApp au lot 5). Le contenu est rendu par NTF
 * (gabarits es / en / fr) : le port transporte un texte déjà rendu. Message d'un autre canal ⇒
 * `UNSUPPORTED_CHANNEL` (capacité inconnue = « non »). `TIMEOUT` = issue inconnue (le message a
 * pu partir) : rejouer la même clé ; NTF dédoublonne par destinataire et canal (US-021).
 * Les accusés de remise (`DeliveryReceipt`) arrivent en double, en retard ou jamais.
 *
 * Adaptateurs : FAKE `@rueda/fake-adapters/messaging` ; fournisseurs réels à choisir.
 */
export type MessagingOutcome<T, R extends string> =
  | { readonly status: 'OK'; readonly value: T; readonly replayed: boolean }
  | { readonly status: 'REFUSED'; readonly reason: R | 'IDEMPOTENCY_CONFLICT' | 'UNSUPPORTED' }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export type MessageChannelKind = 'EMAIL' | 'SMS';

export interface OutboundMessage {
  readonly idempotencyKey: string;
  readonly channel: MessageChannelKind;
  /** Adresse email ou numéro E.164 (C2 : jamais journalisé en clair). */
  readonly to: string;
  readonly locale: string;
  readonly templateKey: string;
  readonly subject: string | null;
  readonly body: string;
}

export interface MessageAccepted {
  readonly messageId: string;
}

export type DeliveryStatus = 'DELIVERED' | 'BOUNCED';

export interface DeliveryReceipt {
  readonly receiptId: string;
  readonly messageId: string;
  readonly status: DeliveryStatus;
  readonly occurredAt: Date;
}

export interface MessagingChannel {
  readonly channel: MessageChannelKind;
  send(
    message: OutboundMessage,
  ): Promise<
    MessagingOutcome<MessageAccepted, 'INVALID_RECIPIENT' | 'BLOCKED' | 'UNSUPPORTED_CHANNEL'>
  >;
}
