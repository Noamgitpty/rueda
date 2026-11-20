/**
 * Versements de l'hôte côté site (US-314, ADR-192 ; 19 US-314 critère 5 ; 10b A08 ; 08
 * BR-PAYOUT-02, SM-6) : lecture DÉFENSIVE de `GET /host/accounts/{orgId}/payouts` (toute forme
 * inattendue ⇒ `null` : l'écran dit l'erreur, jamais un versement deviné). Montants en unités
 * mineures (texte de l'API, convertis en `bigint` pour l'affichage seulement), jamais recalculés.
 * Calendrier : paramètres du pays rendus par l'API (jours ouvrés, heure locale, fuseau), jamais
 * une constante de l'écran. Côté serveur seulement.
 */
import type { ApiResult } from './api-client.ts';

export const PAYOUT_STATUSES = [
  'SCHEDULED',
  'ON_HOLD',
  'NETTING',
  'READY',
  'ZERO_NET',
  'INITIATED',
  'IN_TRANSIT',
  'PAID',
  'FAILED',
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** Motifs de retenue lisibles (contrat de l'API ; `OTHER` : motif que l'écran ne nomme pas). */
export const HOLD_REASONS = [
  'PAYOUTS_DISABLED',
  'FUNDS_HOLDING_DISABLED',
  'VARIANT_B_UNAVAILABLE',
  'HOST_PAYOUT_RAIL_UNAVAILABLE',
  'SUBMERCHANT_INACTIVE',
  'PAYOUT_ACCOUNT_MISSING',
  'PAYOUT_ACCOUNT_UNVERIFIED',
  'PAYOUT_ACCOUNT_CHANGE_HOLD',
  'CHARGEBACK',
  'DISPUTE',
  'CLAIM',
  'TRIP_NOT_COMPLETED',
  'OTHER',
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export interface PayoutScheduleView {
  readonly businessDayOffset: number | null;
  readonly firstPayoutBusinessDay: number | null;
  readonly localTimeMinutes: number | null;
  readonly timeZone: string | null;
}

export interface PayoutView {
  readonly batchId: string;
  readonly status: PayoutStatus;
  readonly scheduledFor: string;
  readonly firstPayout: boolean;
  readonly grossMinor: bigint;
  readonly nettedMinor: bigint;
  readonly netMinor: bigint;
  readonly holdReasons: readonly HoldReason[];
  readonly initiatedAt: string | null;
  readonly paidAt: string | null;
  readonly tripIds: readonly string[];
}

export interface HostPayoutsView {
  readonly orgId: string;
  readonly country: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly schedule: PayoutScheduleView;
  readonly payouts: readonly PayoutView[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | null =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : null;
const amount = (v: unknown): bigint | null =>
  typeof v === 'string' && MINOR.test(v) ? BigInt(v) : null;
const intOrNull = (v: unknown, max: number): number | null | undefined =>
  v === null
    ? null
    : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max
      ? v
      : undefined;
const isoOrNull = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === 'string' && ISO.test(v) ? v : undefined;

function scheduleOf(raw: unknown): PayoutScheduleView | null {
  if (!isObj(raw)) return null;
  const businessDayOffset = intOrNull(raw['businessDayOffset'], 99);
  const firstPayoutBusinessDay = intOrNull(raw['firstPayoutBusinessDay'], 99);
  const localTimeMinutes = intOrNull(raw['localTimeMinutes'], 1439);
  const tz = raw['timeZone'];
  const timeZone =
    tz === null ? null : typeof tz === 'string' && TIME_ZONE.test(tz) ? tz : undefined;
  if (
    businessDayOffset === undefined ||
    firstPayoutBusinessDay === undefined ||
    localTimeMinutes === undefined ||
    timeZone === undefined
  ) {
    return null;
  }
  return { businessDayOffset, firstPayoutBusinessDay, localTimeMinutes, timeZone };
}

function payoutOf(raw: unknown): PayoutView | null {
  if (!isObj(raw) || !Array.isArray(raw['holdReasons']) || !Array.isArray(raw['trips'])) {
    return null;
  }
  const batchId = raw['batchId'];
  const status = oneOf(raw['status'], PAYOUT_STATUSES);
  const scheduledFor = raw['scheduledFor'];
  const firstPayout = raw['firstPayout'];
  const grossMinor = amount(raw['grossMinor']);
  const nettedMinor = amount(raw['nettedMinor']);
  const netMinor = amount(raw['netMinor']);
  const initiatedAt = isoOrNull(raw['initiatedAt']);
  const paidAt = isoOrNull(raw['paidAt']);
  const holdReasons: HoldReason[] = [];
  for (const r of raw['holdReasons'] as unknown[]) {
    const reason = oneOf(r, HOLD_REASONS);
    if (reason === null) return null;
    holdReasons.push(reason);
  }
  const tripIds: string[] = [];
  for (const t of raw['trips'] as unknown[]) {
    if (!isObj(t) || typeof t['tripId'] !== 'string' || !UUID.test(t['tripId'])) return null;
    if (amount(t['amountMinor']) === null) return null;
    tripIds.push(t['tripId']);
  }
  if (
    typeof batchId !== 'string' ||
    !UUID.test(batchId) ||
    status === null ||
    typeof scheduledFor !== 'string' ||
    !ISO.test(scheduledFor) ||
    typeof firstPayout !== 'boolean' ||
    grossMinor === null ||
    nettedMinor === null ||
    netMinor === null ||
    initiatedAt === undefined ||
    paidAt === undefined
  ) {
    return null;
  }
  return {
    batchId,
    status,
    scheduledFor,
    firstPayout,
    grossMinor,
    nettedMinor,
    netMinor,
    holdReasons,
    initiatedAt,
    paidAt,
    tripIds,
  };
}

export function hostPayoutsOf(reply: ApiResult): HostPayoutsView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const orgId = j['orgId'];
  const country = j['country'];
  const currency = j['currency'];
  const exponent = j['currencyExponent'];
  const schedule = scheduleOf(j['schedule']);
  if (
    typeof orgId !== 'string' ||
    !UUID.test(orgId) ||
    typeof country !== 'string' ||
    !/^[A-Z]{2}$/.test(country) ||
    typeof currency !== 'string' ||
    !/^[A-Z]{3}$/.test(currency) ||
    typeof exponent !== 'number' ||
    !Number.isSafeInteger(exponent) ||
    exponent < 0 ||
    exponent > 4 ||
    schedule === null ||
    !Array.isArray(j['payouts'])
  ) {
    return null;
  }
  const payouts: PayoutView[] = [];
  for (const p of j['payouts'] as unknown[]) {
    const view = payoutOf(p);
    if (view === null) return null;
    payouts.push(view);
  }
  return { orgId, country, currency, currencyExponent: exponent, schedule, payouts };
}

/** Heure locale « HH:MM » du lot (minutes après minuit, paramètre du pays). */
export function localTimeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
