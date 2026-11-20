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
  /**
   * phrase des numéros du support et de l'assistance de l'assureur du pays de l'événement
   * (US-213 critère 2, ADR-174), relue à l'envoi dans la configuration pays (CFG) : avec les
   * numéros s'ils sont fournis, sinon un renvoi à la réservation dans l'appli (hors production
   * seulement : la production refuse de démarrer sans eux, `ASSISTANCE_CONTACTS_MISSING`).
   * Jamais le téléphone de l'hôte.
   */
  | { readonly from: 'assistance'; readonly audience: AssistanceAudience }
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

/** Destinataire de la phrase d'assistance : le voyageur (deux numéros) ou l'hôte (le support). */
export type AssistanceAudience = 'GUEST' | 'HOST';

/** Forme de la phrase d'assistance : avec les numéros, ou renvoi à l'appli s'ils manquent. */
export type AssistanceForm = 'numbers' | 'inApp';

/**
 * Clé `@rueda/i18n` de la phrase d'assistance : `ntf.assistance.<guest|host>.<email|sms>.<forme>`
 * (es, en, fr, pt) ; ses emplacements : `{support_phone}`, `{insurer_phone}` et `{brand}`.
 */
export function assistanceKeyOf(
  audience: AssistanceAudience,
  channel: MessageChannelKind,
  form: AssistanceForm,
): string {
  return `ntf.assistance.${audience.toLowerCase()}.${channel === 'EMAIL' ? 'email' : 'sms'}.${form}`;
}

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
  /**
   * Message CRITIQUE de trip (US-052) : un SMS part même si le plafond journalier SMS du pays
   * est atteint. PROPOSÉ : confirmation, annulation et retard d'un trip ; les autres (KYC,
   * versements) sont basculés sur l'e-mail ou refusés au-delà du plafond.
   */
  readonly critical: boolean;
}

export type RecipientRole = 'GUEST' | 'HOST';

export interface RecipientSpec {
  readonly role: RecipientRole;
  /** Champ de la charge utile qui porte l'identifiant du compte destinataire. */
  readonly field: string;
}

/**
 * Sujet dont les parties sont lues en base par le port `NotificationParties` (US-213, ADR-157) :
 * trip (`booking_trip`) ou hold (`booking_checkout_hold`).
 */
export type PartySubject = 'TRIP' | 'HOLD';

/**
 * Parties d'une réservation lues en base au moment de la résolution (fonction
 * `core.booking_notification_parties`, migration 0133) : identifiants et codes seulement.
 */
export interface PartyFacts {
  readonly guestUserId: string;
  /** Titulaire du compte d'hôte (`organization.holder_user_id`). */
  readonly hostUserId: string;
  /** Hold seulement (`CHECKOUT` ou `REQUEST`) ; `null` pour un trip. */
  readonly holdKind: string | null;
  readonly holdStatus: string | null;
  readonly releaseReason: string | null;
  /** Hold seulement : demande autorisée (heure limite de réponse posée, 0126). */
  readonly requestAuthorized: boolean | null;
}

export interface PartiesSpec {
  readonly subject: PartySubject;
  /** Champ UUID de la charge utile qui désigne le sujet (`trip_id`, `hold_id`). */
  readonly field: string;
  /** Condition sur les faits lus en base ; absente : la règle s'applique toujours. */
  readonly when?: (facts: PartyFacts) => boolean;
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
  /**
   * Destinataires lus EN BASE par le port `NotificationParties` (US-213, ADR-157) : les
   * producteurs de `booking.trip.booked`, `trip.status_changed` et `booking.request.*` ne portent
   * pas les identifiants des parties. Le voyageur (`guest_user_id`) et le titulaire du compte
   * d'hôte (`host_user_id`) viennent alors de la base ; si la charge utile porte aussi l'un de ces
   * champs, il doit être identique (sinon erreur de contrat). Sujet introuvable ou port absent :
   * erreur de contrat (lettre morte et alerte), jamais un envoi deviné.
   */
  readonly parties?: PartiesSpec;
}

export const TEMPLATE_KEYS = [
  'EVT_KYC_APPROVED',
  'EVT_BOOKING_CONFIRMED',
  'EVT_BOOKING_CANCELLED',
  'EVT_TRIP_OVERDUE',
  'EVT_PAYOUT_SENT',
  'EVT_PAYOUT_ON_HOLD',
  'EVT_CATALOG_ADDITION_APPROVED',
  'EVT_CATALOG_ADDITION_REJECTED',
  'EVT_TRIP_HOST_RESTRICTED',
  'EVT_TRIP_HOST_RESTRICTION_LIFTED',
  // signalement du no-show de l'hôte par le voyageur (US-307, ADR-191) : l'hôte est prévenu
  'EVT_TRIP_NO_SHOW_REPORTED',
  // confirmation et demandes de réservation (US-213, ADR-157)
  'EVT_BOOKING_CONFIRMED_HOST',
  'EVT_BOOKING_REQUEST_RECEIVED',
  'EVT_BOOKING_REQUEST_DECLINED',
  'EVT_BOOKING_REQUEST_EXPIRED',
  'EVT_BOOKING_REQUEST_FAILED',
  'EVT_BOOKING_REQUEST_FAILED_HOST',
  // décision de la caution (US-702, ADR-172) : libération entière, ou frais annoncés capturés
  'EVT_DEPOSIT_RELEASED',
  'EVT_DEPOSIT_PARTIALLY_CAPTURED',
  // US-702b (08 E3 repli 4) : VOID refusé ⇒ montant bloqué jusqu'à l'expiration de l'autorisation
  'EVT_DEPOSIT_BLOCKED_UNTIL_EXPIRY',
  // réponse automatique à une demande d'aide reçue hors plage (US-310, ADR-182)
  'EVT_HELP_REQUEST_OFF_HOURS',
  'EVT_HELP_REQUEST_OFF_HOURS_HOST',
  // rendez-vous de remise ou de retour accepté par le voyageur (US-316, ADR-186)
  'EVT_TRIP_MEETING_CONFIRMED_PICKUP',
  'EVT_TRIP_MEETING_CONFIRMED_RETURN',
  // trip suivant à risque : le véhicule du trip précédent n'est pas rendu (US-305, ADR-188)
  'EVT_TRIP_AT_RISK_HOST',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const FIRST_NAME: VariableSource = { from: 'recipient_first_name' };
const BRAND: VariableSource = { from: 'brand' };
const BOOKING_REF: VariableSource = { from: 'payload', type: 'ref', field: 'trip_id' };
/** Référence d'une demande : celle de S06, S07 et A05 (`hold_id`, US-223d). */
const REQUEST_REF: VariableSource = { from: 'payload', type: 'ref', field: 'hold_id' };
const START_AT: VariableSource = { from: 'payload', type: 'instant', field: 'scheduled_start' };
const END_AT: VariableSource = { from: 'payload', type: 'instant', field: 'scheduled_end' };
/** Heure du rendez-vous accepté (US-316) ; le lieu n'est JAMAIS dans la charge utile (ADR-186). */
const MEET_AT: VariableSource = { from: 'payload', type: 'instant', field: 'meet_at' };
/** Support et assistance de l'assureur au voyageur ; support seul à l'hôte (US-213, ADR-174). */
const GUEST_ASSISTANCE: VariableSource = { from: 'assistance', audience: 'GUEST' };
const HOST_ASSISTANCE: VariableSource = { from: 'assistance', audience: 'HOST' };
/** Part de la caution libérée (VOID, expiration ou remboursement), US-702. */
const RELEASED: VariableSource = {
  from: 'payload',
  type: 'money',
  field: 'released_minor',
  currencyField: 'currency',
};

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
    critical: false,
  },
  EVT_BOOKING_CONFIRMED: {
    key: 'EVT_BOOKING_CONFIRMED',
    slug: 'bookingConfirmed',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      booking_ref: BOOKING_REF,
      start_at: START_AT,
      end_at: END_AT,
      assistance: GUEST_ASSISTANCE,
    },
    channels: EMAIL_THEN_SMS,
    critical: true,
  },
  EVT_BOOKING_CANCELLED: {
    key: 'EVT_BOOKING_CANCELLED',
    slug: 'bookingCancelled',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: BOOKING_REF },
    channels: EMAIL_THEN_SMS,
    critical: true,
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
    critical: true,
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
    critical: false,
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
    critical: false,
  },
  // file d'ajout au catalogue (US-114, 16 ADM-036 « notification à l'hôte ») : PROPOSÉ (ADR-104)
  EVT_CATALOG_ADDITION_APPROVED: {
    key: 'EVT_CATALOG_ADDITION_APPROVED',
    slug: 'catalogAdditionApproved',
    variables: { first_name: FIRST_NAME, brand: BRAND },
    channels: EMAIL_THEN_SMS,
    critical: false,
  },
  EVT_CATALOG_ADDITION_REJECTED: {
    key: 'EVT_CATALOG_ADDITION_REJECTED',
    slug: 'catalogAdditionRejected',
    variables: { first_name: FIRST_NAME, brand: BRAND },
    channels: EMAIL_THEN_SMS,
    critical: false,
  },
  // hôte défaillant (08 BR-TRUST-09 « prévenir les voyageurs concernés » ; US-122, ADR-124) :
  // voyageur d'un trip à venir dont l'hôte vient d'être restreint. PROPOSÉ ; message de trip
  EVT_TRIP_HOST_RESTRICTED: {
    key: 'EVT_TRIP_HOST_RESTRICTED',
    slug: 'tripHostRestricted',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: BOOKING_REF },
    channels: EMAIL_THEN_SMS,
    critical: true,
  },
  // levée de la dernière restriction de l'hôte (08 BR-TRUST-09 ; US-215c, ADR-156, N-126) : le
  // voyageur prévenu de la restriction apprend que sa réservation tient. PROPOSÉ ; message de trip
  EVT_TRIP_HOST_RESTRICTION_LIFTED: {
    key: 'EVT_TRIP_HOST_RESTRICTION_LIFTED',
    slug: 'tripHostRestrictionLifted',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: BOOKING_REF },
    channels: EMAIL_THEN_SMS,
    critical: true,
  },
  // signalement du no-show de l'hôte par le voyageur (16 TRP-015 ; US-307, ADR-191, PROPOSÉ) :
  // l'hôte apprend que le voyageur l'a signalé absent et que Kmino vérifie ; aucune donnée du
  // voyageur, aucun montant ni pénalité annoncés (la décision appartient à l'ops)
  EVT_TRIP_NO_SHOW_REPORTED: {
    key: 'EVT_TRIP_NO_SHOW_REPORTED',
    slug: 'tripNoShowReported',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: BOOKING_REF },
    channels: EMAIL_THEN_SMS,
    critical: true,
  },
  // Confirmation à l'hôte (16 BKG-022, NTF-007 « hôte : notification » ; US-213, ADR-157) : la
  // référence est celle du trip (A03, contrat) ; aucune donnée du voyageur (minimisation)
  EVT_BOOKING_CONFIRMED_HOST: {
    key: 'EVT_BOOKING_CONFIRMED_HOST',
    slug: 'bookingConfirmedHost',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      booking_ref: BOOKING_REF,
      start_at: START_AT,
      end_at: END_AT,
      assistance: HOST_ASSISTANCE,
    },
    channels: EMAIL_THEN_SMS,
    critical: true,
  },
  // Demandes de réservation (mode REQUEST, US-223c ; 10b S07 « mode REQUEST », HDB-002) : l'hôte
  // reçoit la demande avec l'heure limite de la base ; le voyageur apprend le refus, l'expiration
  // ou l'échec de la capture ; l'hôte apprend l'échec de la capture qu'il a acceptée (N-247).
  // L'acceptation n'a pas de message propre : la confirmation suit au passage BOOKED (comme Turo).
  EVT_BOOKING_REQUEST_RECEIVED: {
    key: 'EVT_BOOKING_REQUEST_RECEIVED',
    slug: 'bookingRequestReceived',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      booking_ref: REQUEST_REF,
      respond_by: { from: 'payload', type: 'instant', field: 'request_respond_by' },
    },
    channels: EMAIL_THEN_SMS,
    critical: true,
  },
  EVT_BOOKING_REQUEST_DECLINED: {
    key: 'EVT_BOOKING_REQUEST_DECLINED',
    slug: 'bookingRequestDeclined',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: REQUEST_REF },
    channels: EMAIL_THEN_SMS,
    critical: false,
  },
  EVT_BOOKING_REQUEST_EXPIRED: {
    key: 'EVT_BOOKING_REQUEST_EXPIRED',
    slug: 'bookingRequestExpired',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: REQUEST_REF },
    channels: EMAIL_THEN_SMS,
    critical: false,
  },
  EVT_BOOKING_REQUEST_FAILED: {
    key: 'EVT_BOOKING_REQUEST_FAILED',
    slug: 'bookingRequestFailed',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: REQUEST_REF },
    channels: EMAIL_THEN_SMS,
    critical: true,
  },
  EVT_BOOKING_REQUEST_FAILED_HOST: {
    key: 'EVT_BOOKING_REQUEST_FAILED_HOST',
    slug: 'bookingRequestFailedHost',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: REQUEST_REF },
    channels: EMAIL_THEN_SMS,
    critical: true,
  },
  // `deposit.decision.executed` (0150 : deposit_id, trip_id, status, captured_minor,
  // released_minor, currency ; 0153 : notice, auth_expiry_at) ; 16 PAY-011 `EVT_DEPOSIT_RELEASED`
  // (PROPOSÉ, ADR-172)
  EVT_DEPOSIT_RELEASED: {
    key: 'EVT_DEPOSIT_RELEASED',
    slug: 'depositReleased',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: BOOKING_REF, amount: RELEASED },
    channels: EMAIL_THEN_SMS,
    critical: false,
  },
  EVT_DEPOSIT_PARTIALLY_CAPTURED: {
    key: 'EVT_DEPOSIT_PARTIALLY_CAPTURED',
    slug: 'depositPartiallyCaptured',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      booking_ref: BOOKING_REF,
      amount: RELEASED,
      captured: {
        from: 'payload',
        type: 'money',
        field: 'captured_minor',
        currencyField: 'currency',
      },
    },
    channels: EMAIL_THEN_SMS,
    critical: false,
  },
  // US-702b (08 E3 repli 4, BR-PAY-06) : l'annulation de l'autorisation a été refusée ou n'est pas
  // prise en charge ; rien n'est prélevé, la banque garde le montant bloqué jusqu'à l'expiration de
  // l'autorisation (jamais « libérée », jamais « gardée » par Kmino ou l'hôte, 10b UX-25)
  EVT_DEPOSIT_BLOCKED_UNTIL_EXPIRY: {
    key: 'EVT_DEPOSIT_BLOCKED_UNTIL_EXPIRY',
    slug: 'depositBlockedUntilExpiry',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      booking_ref: BOOKING_REF,
      amount: RELEASED,
      expires_at: { from: 'payload', type: 'instant', field: 'auth_expiry_at' },
    },
    channels: EMAIL_THEN_SMS,
    critical: false,
  },
  // US-310 (16 SUP-004 « hors horaires, réponse automatique vers l'assistance routière de
  // l'assureur partenaire » ; ADR-182, PROPOSÉ) : demande d'aide reçue hors de la plage publiée du
  // support (ou plage non publiée, SUP-020) ; aucun délai promis ; urgence d'abord (SMS d'abord,
  // e-mail en repli, message critique de trip). Voyageur : support et assistance de l'assureur ;
  // hôte : le support (ADR-174)
  EVT_HELP_REQUEST_OFF_HOURS: {
    key: 'EVT_HELP_REQUEST_OFF_HOURS',
    slug: 'helpOffHours',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      booking_ref: BOOKING_REF,
      assistance: GUEST_ASSISTANCE,
    },
    channels: SMS_THEN_EMAIL,
    critical: true,
  },
  EVT_HELP_REQUEST_OFF_HOURS_HOST: {
    key: 'EVT_HELP_REQUEST_OFF_HOURS_HOST',
    slug: 'helpOffHoursHost',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      booking_ref: BOOKING_REF,
      assistance: HOST_ASSISTANCE,
    },
    channels: SMS_THEN_EMAIL,
    critical: true,
  },
  // US-316 (19 US-316 critère 4 ; ADR-186, PROPOSÉ) : rendez-vous accepté, avis aux deux parties
  // avec l'heure ; le lieu se lit dans l'appli (aperçu sans contenu, L3-PM-45 ; aucun lieu dans
  // le journal d'envoi, L3-PM-50) ; e-mail d'abord, SMS en repli
  EVT_TRIP_MEETING_CONFIRMED_PICKUP: {
    key: 'EVT_TRIP_MEETING_CONFIRMED_PICKUP',
    slug: 'meetingPickupConfirmed',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: BOOKING_REF, meet_at: MEET_AT },
    channels: EMAIL_THEN_SMS,
    critical: false,
  },
  EVT_TRIP_MEETING_CONFIRMED_RETURN: {
    key: 'EVT_TRIP_MEETING_CONFIRMED_RETURN',
    slug: 'meetingReturnConfirmed',
    variables: { first_name: FIRST_NAME, brand: BRAND, booking_ref: BOOKING_REF, meet_at: MEET_AT },
    channels: EMAIL_THEN_SMS,
    critical: false,
  },
  // US-305 (17 §2.5 « Retard et prolongation tacite » : « une notification à l'hôte part » ;
  // ADR-188, PROPOSÉ) : la prolongation du trip en retard est bornée par le trip suivant du même
  // véhicule ; l'hôte de ce trip suivant (le même compte d'hôte) apprend qu'il est à risque.
  // Référence et début du trip SUIVANT ; aucune donnée du voyageur ni du trip en retard
  // (minimisation) ; l'ops reloge ou annule selon BR-CXL (alerte TRIP_NEXT_AT_RISK). Urgent : SMS
  // d'abord, message critique de trip
  EVT_TRIP_AT_RISK_HOST: {
    key: 'EVT_TRIP_AT_RISK_HOST',
    slug: 'tripAtRiskHost',
    variables: {
      first_name: FIRST_NAME,
      brand: BRAND,
      booking_ref: BOOKING_REF,
      start_at: START_AT,
    },
    channels: SMS_THEN_EMAIL,
    critical: true,
  },
};

const GUEST: RecipientSpec = { role: 'GUEST', field: 'guest_user_id' };
const HOST: RecipientSpec = { role: 'HOST', field: 'host_user_id' };
const TRIP_PARTIES: PartiesSpec = { subject: 'TRIP', field: 'trip_id' };
const HOLD_PARTIES: PartiesSpec = { subject: 'HOLD', field: 'hold_id' };

/** Capture refusée d'une demande acceptée : hold REQUEST autorisé, RELEASED pour PAYMENT_DECLINED. */
export function isDeclinedRequestCapture(f: PartyFacts): boolean {
  return (
    f.holdKind === 'REQUEST' &&
    f.holdStatus === 'RELEASED' &&
    f.releaseReason === 'PAYMENT_DECLINED' &&
    f.requestAuthorized === true
  );
}
const CAPTURE_DECLINED_PARTIES: PartiesSpec = {
  subject: 'HOLD',
  field: 'hold_id',
  when: isDeclinedRequestCapture,
};
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
  // `booking.trip.booked` (0126 : trip_id, hold_id, vehicle_id, org_id, scheduled_*) : parties
  // lues en base (US-213, ADR-157) ; un texte par rôle
  {
    eventType: 'booking.trip.booked',
    template: 'EVT_BOOKING_CONFIRMED',
    recipients: [GUEST],
    parties: TRIP_PARTIES,
  },
  {
    eventType: 'booking.trip.booked',
    template: 'EVT_BOOKING_CONFIRMED_HOST',
    recipients: [HOST],
    parties: TRIP_PARTIES,
  },
  // `trip.status_changed` (0099, 0124 : trip_id, from, to, reason, settlement_id) : parties lues
  // en base après la condition (aucune lecture pour un statut non déclenchant)
  {
    eventType: 'trip.status_changed',
    template: 'EVT_BOOKING_CANCELLED',
    condition: { field: 'to', matches: (v) => v.startsWith('CANCELLED_') },
    recipients: [GUEST, HOST],
    parties: TRIP_PARTIES,
  },
  // `trip.overdue.detected` (0168, US-305 : trip_id, stage, guest_user_id, host_user_id,
  // scheduled_end, detected_at) : écrit UNE fois par trip, à l'ouverture du dossier de retard
  { eventType: 'trip.overdue.detected', template: 'EVT_TRIP_OVERDUE', recipients: [GUEST, HOST] },
  // `trip.at_risk.flagged` (0168, US-305, PROPOSÉ, à reporter dans 17 §4.5 : trip_id du trip
  // suivant, reason, host_user_id, scheduled_start) : écrit une fois par trip suivant marqué
  { eventType: 'trip.at_risk.flagged', template: 'EVT_TRIP_AT_RISK_HOST', recipients: [HOST] },
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
  // 17 §4.5 `catalog.addition_request.resolved` (request_id, status, resolved_variant_id) ;
  // extension NTF : `host_user_id` (demandeur), posé par la commande de 0074 (US-114)
  {
    eventType: 'catalog.addition_request.resolved',
    template: 'EVT_CATALOG_ADDITION_APPROVED',
    condition: { field: 'status', matches: (v) => v === 'APPROVED' || v === 'MERGED' },
    recipients: [HOST],
  },
  {
    eventType: 'catalog.addition_request.resolved',
    template: 'EVT_CATALOG_ADDITION_REJECTED',
    condition: fieldIs('status', 'REJECTED'),
    recipients: [HOST],
  },
  // `booking.trip.host_restricted` (PROPOSÉ, à reporter dans 17 §4.5 ; US-122, ADR-124) : un
  // événement par trip à venir de l'hôte restreint (trip_id, guest_user_id, org_id), posé par la
  // commande de restriction de 0097 ; jamais de motif ni de donnée de l'hôte
  {
    eventType: 'booking.trip.host_restricted',
    template: 'EVT_TRIP_HOST_RESTRICTED',
    recipients: [GUEST],
  },
  // `booking.trip.host_restriction_lifted` (PROPOSÉ, à reporter dans 17 §4.5 ; US-215c, ADR-156) :
  // un événement par trip à venir quand la DERNIÈRE restriction de l'hôte est levée, même charge
  // que la pose, posé par la commande de restriction de 0132
  {
    eventType: 'booking.trip.host_restriction_lifted',
    template: 'EVT_TRIP_HOST_RESTRICTION_LIFTED',
    recipients: [GUEST],
  },
  // `trip.no_show.reported` (0171, US-307, ADR-191, PROPOSÉ, à reporter dans 17 §4.5 : trip_id,
  // absent_party, declaration_id) : le voyageur signale l'hôte absent ; parties lues en base
  {
    eventType: 'trip.no_show.reported',
    template: 'EVT_TRIP_NO_SHOW_REPORTED',
    recipients: [HOST],
    parties: TRIP_PARTIES,
  },
  // demandes de réservation (0126, US-223c ; charges utiles : hold_id, vehicle_id, org_id, et
  // request_respond_by pour la réception) : parties du hold lues en base (US-213, ADR-157)
  {
    eventType: 'booking.request.received',
    template: 'EVT_BOOKING_REQUEST_RECEIVED',
    recipients: [HOST],
    parties: HOLD_PARTIES,
  },
  {
    eventType: 'booking.request.declined',
    template: 'EVT_BOOKING_REQUEST_DECLINED',
    recipients: [GUEST],
    parties: HOLD_PARTIES,
  },
  {
    eventType: 'booking.request.expired',
    template: 'EVT_BOOKING_REQUEST_EXPIRED',
    recipients: [GUEST],
    parties: HOLD_PARTIES,
  },
  // capture de l'acceptation jamais confirmée (ADR-146 §6 bis) : voyageur et hôte
  {
    eventType: 'booking.request.capture_unconfirmed',
    template: 'EVT_BOOKING_REQUEST_FAILED',
    recipients: [GUEST],
    parties: HOLD_PARTIES,
  },
  {
    eventType: 'booking.request.capture_unconfirmed',
    template: 'EVT_BOOKING_REQUEST_FAILED_HOST',
    recipients: [HOST],
    parties: HOLD_PARTIES,
  },
  // capture d'une demande acceptée refusée par le PSP (17 §2.5) : `booking.hold.released` de
  // 0126, dont les charges utiles ne portent pas toutes un motif ; la règle ne vise que le hold
  // REQUEST autorisé, libéré pour PAYMENT_DECLINED (faits lus en base : même définition que
  // l'état CAPTURE_FAILED de la lecture de la demande, 0126)
  {
    eventType: 'booking.hold.released',
    template: 'EVT_BOOKING_REQUEST_FAILED',
    recipients: [GUEST],
    parties: CAPTURE_DECLINED_PARTIES,
  },
  {
    eventType: 'booking.hold.released',
    template: 'EVT_BOOKING_REQUEST_FAILED_HOST',
    recipients: [HOST],
    parties: CAPTURE_DECLINED_PARTIES,
  },
  // décision de la caution exécutée (0150, US-702, ADR-172 ; 16 PAY-011 « Notifications ») :
  // voyageur du trip (parties lues en base) ; avis choisi par `notice` (0153, US-702b), posé par la
  // base : libération entière, frais annoncés capturés, ou montant bloqué jusqu'à l'expiration de
  // l'autorisation (VOID refusé, 08 E3 repli 4) ; `notice` absent ⇒ erreur de contrat
  {
    eventType: 'deposit.decision.executed',
    template: 'EVT_DEPOSIT_RELEASED',
    condition: fieldIs('notice', 'RELEASED'),
    recipients: [GUEST],
    parties: TRIP_PARTIES,
  },
  {
    eventType: 'deposit.decision.executed',
    template: 'EVT_DEPOSIT_PARTIALLY_CAPTURED',
    condition: fieldIs('notice', 'PARTIALLY_CAPTURED'),
    recipients: [GUEST],
    parties: TRIP_PARTIES,
  },
  {
    eventType: 'deposit.decision.executed',
    template: 'EVT_DEPOSIT_BLOCKED_UNTIL_EXPIRY',
    condition: fieldIs('notice', 'BLOCKED_UNTIL_EXPIRY'),
    recipients: [GUEST],
    parties: TRIP_PARTIES,
  },
  // demande d'aide du trip (0162, US-310, ADR-182 ; PROPOSÉ, à reporter dans 17 §4.5) : case_id,
  // trip_id, requester_user_id, requester_role, topic, off_hours, auto_reply posé par la base
  // (GUEST ou HOST hors plage, NONE dans la plage) ; destinataire = le demandeur, dans la langue
  // de son compte ; auto_reply absent ⇒ erreur de contrat
  {
    eventType: 'support.help_request.received',
    template: 'EVT_HELP_REQUEST_OFF_HOURS',
    condition: fieldIs('auto_reply', 'GUEST'),
    recipients: [{ role: 'GUEST', field: 'requester_user_id' }],
  },
  {
    eventType: 'support.help_request.received',
    template: 'EVT_HELP_REQUEST_OFF_HOURS_HOST',
    condition: fieldIs('auto_reply', 'HOST'),
    recipients: [{ role: 'HOST', field: 'requester_user_id' }],
  },
  // rendez-vous accepté (0166, US-316, ADR-186 ; PROPOSÉ, à reporter dans 17 §4.5) : trip_id,
  // meeting_id, kind (PICKUP ou RETURN), meet_at ; JAMAIS le lieu ; parties du trip lues en base
  // (voyageur et titulaire du compte d'hôte) ; kind absent ⇒ erreur de contrat
  {
    eventType: 'trip.meeting.confirmed',
    template: 'EVT_TRIP_MEETING_CONFIRMED_PICKUP',
    condition: fieldIs('kind', 'PICKUP'),
    recipients: [GUEST, HOST],
    parties: TRIP_PARTIES,
  },
  {
    eventType: 'trip.meeting.confirmed',
    template: 'EVT_TRIP_MEETING_CONFIRMED_RETURN',
    condition: fieldIs('kind', 'RETURN'),
    recipients: [GUEST, HOST],
    parties: TRIP_PARTIES,
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
