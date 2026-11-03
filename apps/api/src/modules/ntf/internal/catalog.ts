/**
 * Catalogue des notifications de la bêta (US-021 ; 16 NTF-001 « Bêta pilote : SIMPLIFIÉ — email et
 * SMS ; catalogue réduit » ; 16 A.8.2 pour les clés `EVT_…` et leurs événements ; 10b §3.9 pour
 * les canaux). PROPOSÉ (ADR-061) : il tient lieu des tables `notification_template` et
 * `notification_rule` de 17 §3.2.12 tant que les gabarits ne sont pas éditables par l'ADMIN.
 *
 * - Un **gabarit** déclare ses variables (nom, origine, type : 10b UX-59) et ses canaux, chacun
 *   avec son canal de repli. Ses textes sont dans `@rueda/i18n` sous `ntf.<slug>.email.subject`,
 *   `ntf.<slug>.email.body` et `ntf.<slug>.sms.body`, en es, en, fr et pt.
 * - Une **règle** relie un type d'événement de 17 §4.5 (et une condition sur sa charge utile) à un
 *   gabarit et à ses destinataires, lus dans la charge utile (identifiants de comptes seulement).
 *
 * Contrat de charge utile (PROPOSÉ, à reporter dans 17 §4.5) : les producteurs ajoutent les
 * identifiants des destinataires (`guest_user_id`, `host_user_id`, `user_id`) et les champs non
 * sensibles cités ici. Un champ absent ou mal formé est une erreur de contrat : la tâche échoue,
 * est réessayée puis part en lettre morte avec alerte (17 §4.2), jamais un message incomplet.
 */
import type { MessageChannelKind } from './messaging-channel.port.js';

/** Type d'une variable (10b UX-59) : chaque type a son format d'affichage par locale. */
export type VariableSource =
  /** prénom du destinataire, relu à l'envoi (jamais stocké dans le journal d'envoi) */
  | { readonly from: 'recipient_first_name' }
  /** nom de marque (DEC-MARQUE, donnée de thème ; US-034) */
  | { readonly from: 'brand' }
  /** référence courte lisible, tirée d'un identifiant UUID de la charge utile */
  | { readonly from: 'payload'; readonly type: 'ref'; readonly field: string }
  /** instant ISO 8601, affiché au fuseau du pays de l'événement (10b UX-53) */
  | { readonly from: 'payload'; readonly type: 'instant'; readonly field: string }
  /** montant en unités mineures (chaîne) et sa devise, affiché par `formatMoney` */
  | {
      readonly from: 'payload';
      readonly type: 'money';
      readonly field: string;
      readonly currencyField: string;
    };

export interface ChannelSpec {
  readonly channel: MessageChannelKind;
  /** Canal de repli après échec définitif (17 §2.13) ; `null` : aucun repli. */
  readonly fallback: MessageChannelKind | null;
}

export interface TemplateSpec {
  readonly key: TemplateKey;
  /** Segment des clés `@rueda/i18n` : `ntf.<slug>.<canal>.<partie>`. */
  readonly slug: string;
  readonly variables: Readonly<Record<string, VariableSource>>;
  /** Canaux envoyés **en parallèle** pour chaque destinataire, chacun avec son repli. */
  readonly channels: readonly ChannelSpec[];
}

export type RecipientRole = 'GUEST' | 'HOST';

export interface RecipientSpec {
  readonly role: RecipientRole;
  /** Champ de la charge utile qui porte l'identifiant du compte destinataire. */
  readonly field: string;
}

export interface RuleSpec {
  readonly eventType: string;
  readonly template: TemplateKey;
  /**
   * Condition sur un champ de statut de la charge utile, nommé comme dans 17 §4.5 (`to` pour
   * `kyc.verification.status_changed` et `trip.status_changed`, `status` pour
   * `payout.batch.status_changed`). Champ absent ou non textuel ⇒ erreur de contrat (lettre
   * morte et alerte), **jamais** un événement ignoré en silence (revue architecture US-021,
   * constat 1). Absente : la règle s'applique toujours.
   */
  readonly condition?: {
    readonly field: string;
    readonly matches: (value: string) => boolean;
  };
  readonly recipients: readonly RecipientSpec[];
}

export const TEMPLATE_KEYS = [
  'EVT_KYC_APPROVED',
  'EVT_BOOKING_CONFIRMED',
  'EVT_BOOKING_CANCELLED',
  'EVT_TRIP_OVERDUE',
  'EVT_PAYOUT_SENT',
  'EVT_PAYOUT_ON_HOLD',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const FIRST_NAME: VariableSource = { from: 'recipient_first_name' };
const BRAND: VariableSource = { from: 'brand' };
const BOOKING_REF: VariableSource = { from: 'payload', type: 'ref', field: 'trip_id' };

/** Documents et confirmations : e-mail d'abord (preuve écrite), SMS en repli (16 A.8 « Notifications »). */
const EMAIL_THEN_SMS: readonly ChannelSpec[] = [{ channel: 'EMAIL', fallback: 'SMS' }];
/** Urgent : SMS d'abord, e-mail en repli (10b §3.9 « Retard détecté »). */
const SMS_THEN_EMAIL: readonly ChannelSpec[] = [{ channel: 'SMS', fallback: 'EMAIL' }];

export const TEMPLATES: Readonly<Record<TemplateKey, TemplateSpec>> = {
  EVT_KYC_APPROVED: {
    key: 'EVT_KYC_APPROVED',
    slug: 'kycApproved',
    variables: { first_name: FIRST_NAME, brand: BRAND },
    channels: EMAIL_THEN_SMS,
  },
  EVT_BOOKING_CONFIRMED: {
    key: 'EVT_BOOKING_CONFIRMED',
    slug: 'bookingConfirmed',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      booking_ref: BOOKING_REF,
      start_at: { from: 'payload', type: 'instant', field: 'scheduled_start' },
      end_at: { from: 'payload', type: 'instant', field: 'scheduled_end' },
    },
    channels: EMAIL_THEN_SMS,
  },
  EVT_BOOKING_CANCELLED: {
    key: 'EVT_BOOKING_CANCELLED',
    slug: 'bookingCancelled',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: BOOKING_REF },
    channels: EMAIL_THEN_SMS,
  },
  EVT_TRIP_OVERDUE: {
    key: 'EVT_TRIP_OVERDUE',
    slug: 'tripOverdue',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      booking_ref: BOOKING_REF,
      end_at: { from: 'payload', type: 'instant', field: 'scheduled_end' },
    },
    channels: SMS_THEN_EMAIL,
  },
  EVT_PAYOUT_SENT: {
    key: 'EVT_PAYOUT_SENT',
    slug: 'payoutSent',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      amount: { from: 'payload', type: 'money', field: 'net_minor', currencyField: 'currency' },
    },
    channels: EMAIL_THEN_SMS,
  },
  EVT_PAYOUT_ON_HOLD: {
    key: 'EVT_PAYOUT_ON_HOLD',
    slug: 'payoutOnHold',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      amount: { from: 'payload', type: 'money', field: 'net_minor', currencyField: 'currency' },
    },
    channels: EMAIL_THEN_SMS,
  },
};

const GUEST: RecipientSpec = { role: 'GUEST', field: 'guest_user_id' };
const HOST: RecipientSpec = { role: 'HOST', field: 'host_user_id' };
const fieldIs = (field: string, value: string): NonNullable<RuleSpec['condition']> => ({
  field,
  matches: (v) => v === value,
});

/** Règles de la bêta (16 NTF-001, catalogue réduit) ; événements et statuts : 17 §4.5, 08 SM-1/SM-3/SM-6. */
export const RULES: readonly RuleSpec[] = [
  {
    eventType: 'kyc.verification.status_changed',
    template: 'EVT_KYC_APPROVED',
    condition: fieldIs('to', 'APPROVED'),
    recipients: [{ role: 'GUEST', field: 'user_id' }],
  },
  {
    eventType: 'booking.trip.booked',
    template: 'EVT_BOOKING_CONFIRMED',
    recipients: [GUEST, HOST],
  },
  {
    eventType: 'trip.status_changed',
    template: 'EVT_BOOKING_CANCELLED',
    condition: { field: 'to', matches: (v) => v.startsWith('CANCELLED_') },
    recipients: [GUEST, HOST],
  },
  { eventType: 'trip.overdue.detected', template: 'EVT_TRIP_OVERDUE', recipients: [GUEST, HOST] },
  {
    eventType: 'payout.batch.status_changed',
    template: 'EVT_PAYOUT_SENT',
    condition: fieldIs('status', 'INITIATED'),
    recipients: [HOST],
  },
  {
    eventType: 'payout.batch.status_changed',
    template: 'EVT_PAYOUT_ON_HOLD',
    condition: fieldIs('status', 'ON_HOLD'),
    recipients: [HOST],
  },
];

/** Types d'événements consommés par NTF (abonnement du travailleur `ntf_dispatcher`). */
export function subscribedEventTypes(rules: readonly RuleSpec[] = RULES): string[] {
  return [...new Set(rules.map((r) => r.eventType))].sort();
}

/** Clé `@rueda/i18n` d'une partie d'un gabarit. */
export function messageKeyOf(
  template: TemplateSpec,
  channel: MessageChannelKind,
  part: 'subject' | 'body',
): string {
  return `ntf.${template.slug}.${channel === 'EMAIL' ? 'email' : 'sms'}.${part}`;
}
