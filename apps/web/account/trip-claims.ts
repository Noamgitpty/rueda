/**
 * Sinistres entre particuliers côté site (US-318, ADR-198 ; 16 CLM-002 ; 08 BR-TT-02 à 04 ; 10b
 * S17, A09) : lecture DÉFENSIVE des réponses de `POST /trips/{id}/incidents`,
 * `GET /trips/{id}/claims` et `POST /trips/{id}/traffic-charges` (toute forme inattendue ⇒ `null`,
 * l'écran dit l'erreur), et choix de l'angle libre suivant des séries `incident` / `traffic`.
 * Aucun montant n'est calculé ici : frais et totaux viennent de l'API (unités mineures, chaînes).
 * Suite (0181, ADR-201) : référence du PV obligatoire (format de la base), plafond du pays,
 * échéance et réponse du voyageur lues avec chaque refacturation.
 */
import type { ApiResult } from './api-client.ts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const FREE_SLOT = /^DAMAGE_(0[1-9]|10)$/;

/** Angles des séries libres (`DAMAGE_01` à `DAMAGE_10`, gabarit v1 de 0158). */
export const FREE_SLOTS: readonly string[] = Array.from(
  { length: 10 },
  (_, i) => `DAMAGE_${String(i + 1).padStart(2, '0')}`,
);

/** Premier angle libre non encore photographié ; `null` : série pleine. */
export function nextFreeSlot(taken: readonly string[]): string | null {
  return FREE_SLOTS.find((s) => !taken.includes(s)) ?? null;
}

export const TRAFFIC_KINDS = ['TOLL', 'FINE', 'IMPOUND'] as const;
export type TrafficKind = (typeof TRAFFIC_KINDS)[number];

/** Réponse du voyageur à une refacturation (suite d'US-318, 0181, ADR-201 ; 08 BR-TT-02). */
export const TRAFFIC_GUEST_STATUSES = [
  'AWAITING_GUEST',
  'ACCEPTED',
  'DISPUTED',
  'DECIDED_CHARGE',
  'REJECTED',
] as const;
export type TrafficGuestStatus = (typeof TRAFFIC_GUEST_STATUSES)[number];
/** Exécution du débit (`VOID` : refacturation rejetée, jamais débitée). */
export const TRAFFIC_EXECUTION_STATUSES = ['PENDING', 'DONE', 'BLOCKED', 'VOID'] as const;
export type TrafficExecutionStatus = (typeof TRAFFIC_EXECUTION_STATUSES)[number];

/**
 * Référence d'un avis, d'un PV ou d'un reçu (même format que l'API et la base, 0181) : 3 à 40
 * caractères ASCII (lettres, chiffres, espaces, « . », « / », « - »), lettre ou chiffre au début et
 * à la fin, au moins trois lettres ou chiffres.
 */
export const TRAFFIC_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 ./-]{1,38}[A-Za-z0-9]$/;
export const TRAFFIC_REFERENCE_MAX = 40;

/** Référence saisie, espaces de bord retirés ; `null` si elle ne suit pas le format. */
export function trafficReferenceOf(text: string): string | null {
  const ref = text.trim();
  return TRAFFIC_REFERENCE.test(ref) && ref.replace(/[^A-Za-z0-9]/g, '').length >= 3 ? ref : null;
}

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const timeOrNull = (v: unknown): string | null | undefined =>
  v === null ? null : isTime(v) ? v : undefined;

export interface IncidentReported {
  readonly incidentId: string;
  readonly reportedAt: string;
  readonly photoCount: number;
}

/** Incident ouvert (201) ; `null` si la réponse est illisible. */
export function incidentReportedOf(reply: ApiResult): IncidentReported | null {
  if (reply.status !== 201 || !isObj(reply.json)) return null;
  const j = reply.json;
  const n = j['photoCount'];
  if (
    typeof j['incidentId'] !== 'string' ||
    !UUID.test(j['incidentId']) ||
    !isTime(j['reportedAt']) ||
    typeof n !== 'number' ||
    !Number.isSafeInteger(n) ||
    n < 1
  ) {
    return null;
  }
  return { incidentId: j['incidentId'], reportedAt: j['reportedAt'], photoCount: n };
}

export interface TrafficDeclared {
  readonly chargeId: string;
  readonly amountMinor: string;
  readonly adminFeeMinor: string;
  readonly totalMinor: string;
  readonly deadlineAt: string;
  /** Échéance du voyageur pour payer ou contester (0181). */
  readonly responseDueAt: string;
  /** Somme du trip au-delà du plafond cumulé (0183, ADR-203) : revue de l'ops avant tout débit. */
  readonly opsReviewRequired: boolean;
}

/** Refacturation enregistrée (201) ; `null` si la réponse est illisible. */
export function trafficDeclaredOf(reply: ApiResult): TrafficDeclared | null {
  if (reply.status !== 201 || !isObj(reply.json)) return null;
  const j = reply.json;
  const minor = (k: string) => typeof j[k] === 'string' && MINOR.test(j[k] as string);
  if (
    typeof j['chargeId'] !== 'string' ||
    !UUID.test(j['chargeId']) ||
    !minor('amountMinor') ||
    !minor('adminFeeMinor') ||
    !minor('totalMinor') ||
    !isTime(j['deadlineAt']) ||
    !isTime(j['responseDueAt'])
  ) {
    return null;
  }
  return {
    chargeId: j['chargeId'],
    amountMinor: j['amountMinor'] as string,
    adminFeeMinor: j['adminFeeMinor'] as string,
    totalMinor: j['totalMinor'] as string,
    deadlineAt: j['deadlineAt'],
    responseDueAt: j['responseDueAt'],
    opsReviewRequired: j['opsReviewRequired'] === true,
  };
}

export interface TripClaimsView {
  readonly tripId: string;
  readonly currency: string;
  readonly open: boolean;
  readonly tripStartAt: string;
  readonly tripEndAt: string | null;
  readonly deadlineAt: string | null;
  readonly feeBps: number | null;
  /** Délai du voyageur pour répondre (h) et plafond du montant du pays (0181) ; `null` : inconnu. */
  readonly responseHours: number | null;
  readonly capMinor: string | null;
  readonly theft: {
    readonly status: 'THEFT_INVESTIGATION' | 'RETURNED';
    readonly openedAt: string;
    readonly closedAt: string | null;
    readonly insurerStatus: 'PENDING' | 'SENT' | 'WITHDRAWN';
  } | null;
  readonly charges: readonly {
    readonly id: string;
    readonly kind: TrafficKind;
    readonly occurredAt: string;
    readonly amountMinor: string;
    readonly adminFeeMinor: string;
    readonly totalMinor: string;
    readonly declaredAt: string;
    /** Référence du PV, échéance et réponse du voyageur (`null` : refacturation antérieure à 0181). */
    readonly reference: string | null;
    readonly responseDueAt: string | null;
    readonly guestStatus: TrafficGuestStatus | null;
    readonly status: TrafficExecutionStatus;
  }[];
  readonly evidence: readonly {
    readonly fileId: string;
    readonly slot: string;
    readonly receivedAt: string;
    readonly used: boolean;
  }[];
}

const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T =>
  typeof v === 'string' && (values as readonly string[]).includes(v);

/** Sinistres du trip vus par le titulaire (200) ; `null` si la réponse est illisible. */
export function tripClaimsOf(reply: ApiResult, tripId: string): TripClaimsView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const fee = j['feeBps'];
  const end = timeOrNull(j['tripEndAt']);
  const deadline = timeOrNull(j['deadlineAt']);
  const hours = j['responseHours'] ?? null;
  const cap = j['capMinor'] ?? null;
  if (
    j['tripId'] !== tripId ||
    typeof j['currency'] !== 'string' ||
    !/^[A-Z]{3}$/.test(j['currency']) ||
    typeof j['open'] !== 'boolean' ||
    !isTime(j['tripStartAt']) ||
    end === undefined ||
    deadline === undefined ||
    (fee !== null && (typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0)) ||
    (hours !== null && (typeof hours !== 'number' || !Number.isSafeInteger(hours) || hours < 1)) ||
    (cap !== null && (typeof cap !== 'string' || !MINOR.test(cap))) ||
    !Array.isArray(j['charges']) ||
    !Array.isArray(j['evidence'])
  ) {
    return null;
  }
  let theft: TripClaimsView['theft'] = null;
  const t = j['theft'];
  if (t !== null && t !== undefined) {
    const closed = isObj(t) ? timeOrNull(t['closedAt']) : undefined;
    if (
      !isObj(t) ||
      !oneOf(t['status'], ['THEFT_INVESTIGATION', 'RETURNED'] as const) ||
      !oneOf(t['insurerStatus'], ['PENDING', 'SENT', 'WITHDRAWN'] as const) ||
      !isTime(t['openedAt']) ||
      closed === undefined
    ) {
      return null;
    }
    theft = {
      status: t['status'],
      insurerStatus: t['insurerStatus'],
      openedAt: t['openedAt'],
      closedAt: closed,
    };
  }
  const charges: TripClaimsView['charges'][number][] = [];
  for (const c of j['charges'] as unknown[]) {
    const ref = isObj(c) ? (c['reference'] ?? null) : undefined;
    const due = isObj(c) ? timeOrNull(c['responseDueAt'] ?? null) : undefined;
    const answer = isObj(c) ? (c['guestStatus'] ?? null) : undefined;
    if (
      !isObj(c) ||
      (ref !== null && (typeof ref !== 'string' || !TRAFFIC_REFERENCE.test(ref))) ||
      due === undefined ||
      (answer !== null && !oneOf(answer, TRAFFIC_GUEST_STATUSES)) ||
      typeof c['id'] !== 'string' ||
      !UUID.test(c['id']) ||
      !oneOf(c['kind'], TRAFFIC_KINDS) ||
      !oneOf(c['status'], TRAFFIC_EXECUTION_STATUSES) ||
      !isTime(c['occurredAt']) ||
      !isTime(c['declaredAt']) ||
      ['amountMinor', 'adminFeeMinor', 'totalMinor'].some(
        (k) => typeof c[k] !== 'string' || !MINOR.test(c[k] as string),
      )
    ) {
      return null;
    }
    charges.push({
      id: c['id'],
      kind: c['kind'],
      status: c['status'],
      occurredAt: c['occurredAt'],
      declaredAt: c['declaredAt'],
      amountMinor: c['amountMinor'] as string,
      adminFeeMinor: c['adminFeeMinor'] as string,
      totalMinor: c['totalMinor'] as string,
      reference: ref as string | null,
      responseDueAt: due,
      guestStatus: answer as TrafficGuestStatus | null,
    });
  }
  const evidence: TripClaimsView['evidence'][number][] = [];
  for (const e of j['evidence'] as unknown[]) {
    if (
      !isObj(e) ||
      typeof e['fileId'] !== 'string' ||
      !UUID.test(e['fileId']) ||
      typeof e['slot'] !== 'string' ||
      !FREE_SLOT.test(e['slot']) ||
      !isTime(e['receivedAt']) ||
      typeof e['used'] !== 'boolean'
    ) {
      return null;
    }
    evidence.push({
      fileId: e['fileId'],
      slot: e['slot'],
      receivedAt: e['receivedAt'],
      used: e['used'],
    });
  }
  return {
    tripId,
    currency: j['currency'],
    open: j['open'],
    tripStartAt: j['tripStartAt'],
    tripEndAt: end,
    deadlineAt: deadline,
    feeBps: fee as number | null,
    responseHours: hours as number | null,
    capMinor: cap as string | null,
    theft,
    charges,
    evidence,
  };
}

/**
 * Pourcentage des frais de gestion pour l'AFFICHAGE seulement (« 5 », « 2,5 ») depuis les points
 * de base du pays : aucun montant n'est calculé dans le client (l'API rend frais et total).
 */
export function feePercentText(bps: number, tag: string): string {
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(bps / 100);
}

export interface TrafficPreview {
  readonly kind: TrafficKind;
  readonly occurredAt: string;
  readonly currency: string;
  readonly feeBps: number;
  readonly amountMinor: string;
  readonly adminFeeMinor: string;
  readonly totalMinor: string;
  readonly deadlineAt: string;
  /** Référence relue par l'API, délai du voyageur (h) et plafond du pays (0181). */
  readonly reference: string;
  readonly responseHours: number;
  readonly capMinor: string;
  /** Avec ce montant, somme du trip au-delà du plafond cumulé (0183) : revue de l'ops. */
  readonly opsReviewRequired: boolean;
}

/**
 * Récapitulatif d'une refacturation calculé par l'API AVANT l'envoi (200, revue ux n° 1) : montant
 * payé, frais de gestion, total refacturé au voyageur ; `null` si la réponse est illisible.
 */
export function trafficPreviewOf(reply: ApiResult): TrafficPreview | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const minor = (k: string) => typeof j[k] === 'string' && MINOR.test(j[k] as string);
  const fee = j['feeBps'];
  if (
    !oneOf(j['kind'], TRAFFIC_KINDS) ||
    !isTime(j['occurredAt']) ||
    typeof j['currency'] !== 'string' ||
    !/^[A-Z]{3}$/.test(j['currency']) ||
    typeof fee !== 'number' ||
    !Number.isSafeInteger(fee) ||
    fee < 0 ||
    !minor('amountMinor') ||
    !minor('adminFeeMinor') ||
    !minor('totalMinor') ||
    !isTime(j['deadlineAt']) ||
    typeof j['reference'] !== 'string' ||
    !TRAFFIC_REFERENCE.test(j['reference']) ||
    typeof j['responseHours'] !== 'number' ||
    !Number.isSafeInteger(j['responseHours']) ||
    j['responseHours'] < 1 ||
    !minor('capMinor') ||
    j['chargedBy'] !== 'SEPARATE_CARD_CHARGE'
  ) {
    return null;
  }
  return {
    kind: j['kind'],
    occurredAt: j['occurredAt'],
    currency: j['currency'],
    feeBps: fee,
    amountMinor: j['amountMinor'] as string,
    adminFeeMinor: j['adminFeeMinor'] as string,
    totalMinor: j['totalMinor'] as string,
    deadlineAt: j['deadlineAt'],
    reference: j['reference'],
    responseHours: j['responseHours'],
    capMinor: j['capMinor'] as string,
    opsReviewRequired: j['opsReviewRequired'] === true,
  };
}

export type DatePart = 'day' | 'month' | 'year';

/**
 * Ordre jour / mois / année de la langue de la vue (Intl, jamais codé par pays) : le champ de date
 * de l'hôte suit cet ordre (revue ux n° 6). Repli : jour, mois, année.
 */
export function dateOrder(tag: string): readonly DatePart[] {
  try {
    const parts = new Intl.DateTimeFormat(tag, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).formatToParts(new Date(Date.UTC(2033, 10, 22)));
    const order = parts
      .map((p) => p.type)
      .filter((t): t is DatePart => t === 'day' || t === 'month' || t === 'year');
    return order.length === 3 ? order : ['day', 'month', 'year'];
  } catch {
    return ['day', 'month', 'year'];
  }
}

/** Exemple affiché du format de date (« dd/mm/aaaa ») à partir des lettres de la langue. */
export function datePattern(
  order: readonly DatePart[],
  letters: Readonly<Record<DatePart, string>>,
): string {
  return order.map((p) => letters[p]).join('/');
}

/**
 * Date saisie dans l'ordre de la langue (séparateurs / . -), jour et mois sur 1 ou 2 chiffres,
 * année sur 4 : rend `AAAA-MM-JJ` d'une date du calendrier, sinon `null`.
 */
export function parseLocalDate(text: string, order: readonly DatePart[]): string | null {
  const m = /^\s*(\d{1,4})[/.-](\d{1,4})[/.-](\d{1,4})\s*$/.exec(text);
  if (m === null || order.length !== 3) return null;
  const v: Partial<Record<DatePart, string>> = {};
  order.forEach((p, i) => {
    const part = m[i + 1];
    if (part !== undefined) v[p] = part;
  });
  const { day, month, year } = v;
  if (
    day === undefined ||
    month === undefined ||
    year === undefined ||
    !/^\d{4}$/.test(year) ||
    day.length > 2 ||
    month.length > 2
  ) {
    return null;
  }
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    mo < 1 ||
    mo > 12 ||
    d < 1 ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** Heure saisie sur 24 h (« 9:05 », « 21:30 ») ⇒ `HH:MM`, sinon `null`. */
export function parseLocalTime(text: string): string | null {
  const m = /^\s*([01]?\d|2[0-3])[:h.]([0-5]\d)\s*$/.exec(text);
  return m === null ? null : `${m[1]!.padStart(2, '0')}:${m[2]}`;
}
