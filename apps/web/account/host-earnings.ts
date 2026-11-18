/**
 * Gains de l'hôte côté site (US-217 partie 217b, ADR-161 / ADR-167 ; 19 US-217 critères 1 et 2 ;
 * 10b A08, UX-45 ; 16 PYO-013) : lecture DÉFENSIVE de `GET /host/accounts/{orgId}/earnings/{month}`
 * (toute forme inattendue ⇒ `null` : l'écran dit l'erreur, jamais un relevé partiel ou deviné).
 * Montants en unités mineures (texte de l'API, convertis en `bigint` pour l'affichage seulement),
 * jamais recalculés ni additionnés ici : acquis (`earnedMinor`) et à venir (`pendingMinor`) sont
 * deux sommes rendues par la base (N-339). Une pénalité de l'hôte est une ligne à part
 * (`ADJUSTMENT`, montant négatif). Côté serveur seulement.
 */
import type { ApiResult } from './api-client.ts';

export const EARNING_LINE_KINDS = ['EARNING', 'CXL_EARNING', 'ADJUSTMENT'] as const;
export type EarningLineKind = (typeof EARNING_LINE_KINDS)[number];
export const EARNING_SOURCES = ['CAPTURE', 'SETTLEMENT', 'HOST_LEDGER'] as const;
export type EarningSource = (typeof EARNING_SOURCES)[number];
/** Motifs du host_ledger connus de l'écran ; tout autre motif ⇒ relevé illisible. */
export const ADJUSTMENT_REASONS = ['HOST_CANCELLATION_PENALTY'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export interface EarningLineView {
  readonly kind: EarningLineKind;
  readonly tripId: string;
  readonly tripStatus: string;
  readonly source: EarningSource;
  readonly reason: AdjustmentReason | null;
  readonly eventAt: string;
  readonly amountMinor: bigint;
  readonly shareBaseMinor: bigint | null;
  readonly kminoFeeMinor: bigint | null;
  readonly hostPlanCode: string | null;
  readonly hostSharePct: string | null;
}

export interface EarningsStatementView {
  readonly currency: string;
  readonly currencyExponent: number;
  readonly tripsCount: number;
  readonly earnedMinor: bigint;
  readonly pendingMinor: bigint;
  readonly lines: readonly EarningLineView[];
}

export interface HostEarningsView {
  readonly orgId: string;
  readonly month: string;
  readonly country: string;
  readonly statements: readonly EarningsStatementView[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const SIGNED = /^(0|-?[1-9][0-9]{0,17})$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const PLAN = /^[A-Z][A-Z0-9_ÁÉÍÓÚÑ]{0,31}$/u;
const SHARE = /^[0-9]{1,9}\/[1-9][0-9]{0,8}$/;
/** Mois du relevé « YYYY-MM ». */
export const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | null =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : null;
const amount = (v: unknown, re: RegExp): bigint | null =>
  typeof v === 'string' && re.test(v) ? BigInt(v) : null;
/** Montant facultatif : `null` admis ; `undefined` = anomalie. */
const optional = (v: unknown): bigint | null | undefined =>
  v === null ? null : (amount(v, SIGNED) ?? undefined);
const textOrNull = (v: unknown, re: RegExp): string | null | undefined =>
  v === null ? null : typeof v === 'string' && re.test(v) ? v : undefined;

function lineOf(raw: unknown): EarningLineView | null {
  if (!isObj(raw)) return null;
  const kind = oneOf(raw['kind'], EARNING_LINE_KINDS);
  const source = oneOf(raw['source'], EARNING_SOURCES);
  const tripId = raw['tripId'];
  const tripStatus = raw['tripStatus'];
  const eventAt = raw['eventAt'];
  const reason = raw['reason'] === null ? null : oneOf(raw['reason'], ADJUSTMENT_REASONS);
  const value = amount(raw['amountMinor'], kind === 'ADJUSTMENT' ? SIGNED : MINOR);
  const shareBaseMinor = optional(raw['shareBaseMinor']);
  const kminoFeeMinor = optional(raw['kminoFeeMinor']);
  const hostPlanCode = textOrNull(raw['hostPlanCode'], PLAN);
  const hostSharePct = textOrNull(raw['hostSharePct'], SHARE);
  if (
    kind === null ||
    source === null ||
    (kind === 'ADJUSTMENT') !== (source === 'HOST_LEDGER') ||
    (raw['reason'] !== null && reason === null) ||
    (kind === 'ADJUSTMENT') !== (reason !== null) ||
    typeof tripId !== 'string' ||
    !UUID.test(tripId) ||
    typeof tripStatus !== 'string' ||
    !CODE.test(tripStatus) ||
    typeof eventAt !== 'string' ||
    !ISO.test(eventAt) ||
    value === null ||
    shareBaseMinor === undefined ||
    kminoFeeMinor === undefined ||
    hostPlanCode === undefined ||
    hostSharePct === undefined
  ) {
    return null;
  }
  return {
    kind,
    tripId,
    tripStatus,
    source,
    reason,
    eventAt,
    amountMinor: value,
    shareBaseMinor,
    kminoFeeMinor,
    hostPlanCode,
    hostSharePct,
  };
}

/** Relevé d'une réponse 200 de `GET /host/accounts/{orgId}/earnings/{month}`, sinon `null`. */
export function hostEarningsOf(reply: ApiResult): HostEarningsView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const orgId = j['orgId'];
  const month = j['month'];
  const country = j['country'];
  if (
    typeof orgId !== 'string' ||
    !UUID.test(orgId) ||
    typeof month !== 'string' ||
    !MONTH.test(month) ||
    typeof country !== 'string' ||
    !/^[A-Z]{2}$/.test(country) ||
    !Array.isArray(j['statements'])
  ) {
    return null;
  }
  const statements: EarningsStatementView[] = [];
  for (const s of j['statements'] as unknown[]) {
    if (!isObj(s) || !Array.isArray(s['lines'])) return null;
    const currency = s['currency'];
    const exponent = s['currencyExponent'];
    const count = s['tripsCount'];
    const earnedMinor = amount(s['earnedMinor'], SIGNED);
    const pendingMinor = amount(s['pendingMinor'], MINOR);
    if (
      typeof currency !== 'string' ||
      !/^[A-Z]{3}$/.test(currency) ||
      typeof exponent !== 'number' ||
      !Number.isSafeInteger(exponent) ||
      exponent < 0 ||
      exponent > 4 ||
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      earnedMinor === null ||
      pendingMinor === null
    ) {
      return null;
    }
    const lines: EarningLineView[] = [];
    for (const l of s['lines'] as unknown[]) {
      const line = lineOf(l);
      if (line === null) return null;
      lines.push(line);
    }
    statements.push({
      currency,
      currencyExponent: exponent,
      tripsCount: count,
      earnedMinor,
      pendingMinor,
      lines,
    });
  }
  return { orgId, month, country, statements };
}

/** Mois voisin « YYYY-MM » (navigation du relevé ; aucune date d'argent). */
export function shiftMonth(month: string, delta: -1 | 1): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Mois demandé (`?month=YYYY-MM`) s'il est bien formé, sinon le mois de `now` en UTC. */
export function monthOf(raw: unknown, now: Date): string {
  if (typeof raw === 'string' && MONTH.test(raw)) return raw;
  return now.toISOString().slice(0, 7);
}
