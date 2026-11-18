/**
 * Remboursement d'un trip côté site (US-224 partie 224d, ADR-154 ; 19 US-224 critère 1 ; 10b S10,
 * UX-31 ; 08 SM-8, BR-PAY-08) : lecture DÉFENSIVE de `GET /trips/{id}/refunds` (toute forme
 * inattendue ⇒ `null`, l'écran dit l'erreur, jamais un remboursement partiel ou deviné). Le voyageur
 * reçoit le montant, le rail et la date d'émission ; l'hôte la seule part de la jambe HOST. Les
 * états SM-8 sont regroupés pour la personne (jamais un état technique à l'écran) :
 * - `PREPARING` : planifié (PLANNED, PENDING_BANK_DETAILS), la date d'émission n'existe pas encore ;
 * - `ISSUED` : émission autorisée ou envoyée (SUBMITTED, SENT, CREDITED) : « Émis le … » ;
 * - `CONFIRMED` : le prestataire de paiement a confirmé (CONFIRMED) ;
 * - `ATTENTION` : refus du prestataire, contestation bancaire ou autre moyen à convenir (FAILED,
 *   BLOCKED_CHARGEBACK, PENDING_CUSTOMER_CHOICE) : l'équipe s'en occupe, aucune action demandée.
 *   US-224f (ADR-166) : en bêta, PENDING_CUSTOMER_CHOICE ne suit qu'un rejet confirmé du moyen
 *   d'origine et aucun autre rail n'est ouvert au voyageur : rien ne se « prépare », l'équipe le
 *   contacte (aucun choix proposé à l'écran tant que le virement et le crédit sont fermés).
 * Côté serveur seulement ; jamais de donnée personnelle dans une URL ni dans un journal.
 */
import type { ApiResult } from './api-client.ts';

export const REFUND_STATUSES = [
  'PLANNED',
  'BLOCKED_CHARGEBACK',
  'PENDING_CUSTOMER_CHOICE',
  'PENDING_BANK_DETAILS',
  'SUBMITTED',
  'SENT',
  'CONFIRMED',
  'FAILED',
  'CREDITED',
  'CANCELLED',
  'SUPERSEDED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_RAILS = [
  'NATIVE_PARTIAL',
  'ROLLBACK_AND_RECHARGE',
  'BANK_TRANSFER',
  'CREDIT_CASH',
] as const;
export type RefundRail = (typeof REFUND_RAILS)[number];

export type RefundPhase = 'PREPARING' | 'ISSUED' | 'CONFIRMED' | 'ATTENTION';

/** État vu par la personne (voyageur ou hôte) ; `null` : instance à ne pas montrer. */
export function phaseOf(status: RefundStatus): RefundPhase | null {
  switch (status) {
    case 'PLANNED':
    case 'PENDING_BANK_DETAILS':
      return 'PREPARING';
    case 'SUBMITTED':
    case 'SENT':
    case 'CREDITED':
      return 'ISSUED';
    case 'CONFIRMED':
      return 'CONFIRMED';
    case 'FAILED':
    case 'BLOCKED_CHARGEBACK':
    case 'PENDING_CUSTOMER_CHOICE':
      return 'ATTENTION';
    case 'CANCELLED':
    case 'SUPERSEDED':
      return null;
  }
}

export interface GuestRefundView {
  readonly status: RefundStatus;
  readonly amountMinor: string;
  readonly rail: RefundRail;
  readonly plannedAt: string;
  readonly issuedAt: string | null;
}

export interface HostRefundView {
  readonly status: RefundStatus;
  readonly hostLegMinor: string;
  readonly plannedAt: string;
  readonly issuedAt: string | null;
}

interface Common {
  readonly tripId: string;
  readonly tripStatus: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly timezone: string;
}

export type TripRefundsView =
  | (Common & { readonly viewerRole: 'GUEST'; readonly refunds: readonly GuestRefundView[] })
  | (Common & { readonly viewerRole: 'HOST'; readonly refunds: readonly HostRefundView[] });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/;
type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | null =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : null;
const isoOf = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === 'string' && ISO.test(v) ? v : undefined;

/** Remboursements d'une réponse 200 de `GET /trips/{id}/refunds`, sinon `null`. */
export function tripRefundsOf(reply: ApiResult): TripRefundsView | null {
  if (reply.status !== 200 || !isObj(reply.json) || !Array.isArray(reply.json['refunds'])) {
    return null;
  }
  const j = reply.json;
  const role = j['viewerRole'];
  const tripId = j['tripId'];
  const tripStatus = j['tripStatus'];
  const currency = j['currency'];
  const exponent = j['currencyExponent'];
  const timezone = j['timezone'];
  if (
    (role !== 'GUEST' && role !== 'HOST') ||
    typeof tripId !== 'string' ||
    !UUID.test(tripId) ||
    typeof tripStatus !== 'string' ||
    typeof currency !== 'string' ||
    !/^[A-Z]{3}$/.test(currency) ||
    typeof exponent !== 'number' ||
    !Number.isSafeInteger(exponent) ||
    exponent < 0 ||
    exponent > 4 ||
    typeof timezone !== 'string' ||
    !ZONE.test(timezone)
  ) {
    return null;
  }
  const common: Common = { tripId, tripStatus, currency, currencyExponent: exponent, timezone };
  const guest: GuestRefundView[] = [];
  const host: HostRefundView[] = [];
  for (const item of j['refunds'] as unknown[]) {
    if (!isObj(item)) return null;
    const status = oneOf(item['status'], REFUND_STATUSES);
    const plannedAt = isoOf(item['plannedAt']);
    const issuedAt = isoOf(item['issuedAt']);
    if (status === null || typeof plannedAt !== 'string' || issuedAt === undefined) return null;
    if (role === 'GUEST') {
      const amount = item['amountMinor'];
      const rail = oneOf(item['rail'], REFUND_RAILS);
      if (typeof amount !== 'string' || !MINOR.test(amount) || rail === null) return null;
      guest.push({ status, amountMinor: amount, rail, plannedAt, issuedAt });
    } else {
      const leg = item['hostLegMinor'];
      if (typeof leg !== 'string' || !MINOR.test(leg)) return null;
      host.push({ status, hostLegMinor: leg, plannedAt, issuedAt });
    }
  }
  return role === 'GUEST'
    ? { ...common, viewerRole: 'GUEST', refunds: guest }
    : { ...common, viewerRole: 'HOST', refunds: host };
}
