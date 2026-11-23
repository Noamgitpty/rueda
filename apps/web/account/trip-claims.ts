/**
 * Sinistres entre particuliers côté site (US-318, ADR-198 ; 16 CLM-002 ; 08 BR-TT-02 à 04 ; 10b
 * S17, A09) : lecture DÉFENSIVE des réponses de `POST /trips/{id}/incidents`,
 * `GET /trips/{id}/claims` et `POST /trips/{id}/traffic-charges` (toute forme inattendue ⇒ `null`,
 * l'écran dit l'erreur), et choix de l'angle libre suivant des séries `incident` / `traffic`.
 * Aucun montant n'est calculé ici : frais et totaux viennent de l'API (unités mineures, chaînes).
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
    !isTime(j['deadlineAt'])
  ) {
    return null;
  }
  return {
    chargeId: j['chargeId'],
    amountMinor: j['amountMinor'] as string,
    adminFeeMinor: j['adminFeeMinor'] as string,
    totalMinor: j['totalMinor'] as string,
    deadlineAt: j['deadlineAt'],
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
    readonly status: 'PENDING' | 'DONE' | 'BLOCKED';
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
  if (
    j['tripId'] !== tripId ||
    typeof j['currency'] !== 'string' ||
    !/^[A-Z]{3}$/.test(j['currency']) ||
    typeof j['open'] !== 'boolean' ||
    !isTime(j['tripStartAt']) ||
    end === undefined ||
    deadline === undefined ||
    (fee !== null && (typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0)) ||
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
    if (
      !isObj(c) ||
      typeof c['id'] !== 'string' ||
      !UUID.test(c['id']) ||
      !oneOf(c['kind'], TRAFFIC_KINDS) ||
      !oneOf(c['status'], ['PENDING', 'DONE', 'BLOCKED'] as const) ||
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
