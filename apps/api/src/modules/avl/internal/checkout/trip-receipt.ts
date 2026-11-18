/**
 * Reçu d'un trip lu par sa partie (US-217 partie 217a, ADR-161 ; 19 US-217 critères 1 et 2 ;
 * 16 FIN-018 / PYO-013, FIN-002 ; 08 E7, BR-PRICE-06, BR-PRICE-12, BR-PROT-06). Le titulaire du
 * compte d'hôte lit le reçu de ses gains (jambe HOST de la version en tête du règlement ou de la
 * capture, plan et part figés, frais retenus par Kmino, pénalité du host_ledger en ligne séparée,
 * net) ; le voyageur lit le reçu de son paiement (total payé, remboursé, trip fee et sa taxe de
 * ligne ; la facture électronique est émise hors plateforme en bêta, FIN-002 MANUEL). La base juge
 * la partie (`core.booking_trip_receipt`, 0133, SECURITY DEFINER, EXECUTE app_api) et rend la même
 * réponse NOT_FOUND à toute autre personne : 404 `RECEIPT_NOT_FOUND`, comme pour un trip inconnu ou
 * un identifiant mal formé (aucun oracle). Trip sans capture ni règlement : 409 `RECEIPT_NOT_READY`.
 *
 * Montants en unités mineures, en TEXTE (bigint exact), lus de la base et jamais recalculés ;
 * exposant de la devise joint dans la même instruction (affichage seulement). Toute forme inattendue
 * ⇒ 503 `RECEIPT_UNAVAILABLE` (fail-closed : jamais un reçu partiel ni deviné).
 */
import { HttpException } from '@nestjs/common';
import { isUuid } from './model.js';
import type { SqlExecutor } from './store.js';

export const TRIP_RECEIPT_MESSAGES = {
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  RECEIPT_NOT_FOUND: { status: 404, messageKey: 'common.receipt.notFound' },
  RECEIPT_NOT_READY: { status: 409, messageKey: 'common.receipt.notReady' },
  RECEIPT_UNAVAILABLE: { status: 503, messageKey: 'common.receipt.unavailable' },
} as const;

export type TripReceiptHttpCode = keyof typeof TRIP_RECEIPT_MESSAGES;

export class TripReceiptHttpError extends HttpException {
  readonly code: TripReceiptHttpCode;

  constructor(code: TripReceiptHttpCode) {
    super(
      { code, messageKey: TRIP_RECEIPT_MESSAGES[code].messageKey },
      TRIP_RECEIPT_MESSAGES[code].status,
    );
    this.code = code;
  }
}

/** Montant non signé (jambe, total) ; montant signé (ajustement, net). */
export const MINOR = /^(0|[1-9][0-9]{0,17})$/;
export const SIGNED_MINOR = /^(0|-?[1-9][0-9]{0,17})$/;
export const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const PLAN = /^[A-Z][A-Z0-9_ÁÉÍÓÚÑ]{0,31}$/;
const SHARE = /^[0-9]{1,9}\/[1-9][0-9]{0,8}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Lignes de gains (17 §3.2.13 `host_earnings_line.kind`). */
export const EARNING_KINDS = ['EARNING', 'CXL_EARNING'] as const;
export type EarningKind = (typeof EARNING_KINDS)[number];
/** Source du montant : version en tête du règlement, ou capture tant qu'aucun règlement n'existe. */
export const RECEIPT_SOURCES = ['CAPTURE', 'SETTLEMENT'] as const;
export type ReceiptSource = (typeof RECEIPT_SOURCES)[number];
/** Motifs du host_ledger (0129) ; tout autre motif est une extension revue. */
export const ADJUSTMENT_REASONS = ['HOST_CANCELLATION_PENALTY'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export interface HostAdjustment {
  readonly reason: AdjustmentReason;
  readonly amountMinor: string;
  readonly periodMonth: string;
  readonly at: string;
}

export interface HostReceipt {
  readonly kind: EarningKind;
  readonly source: ReceiptSource;
  readonly settlementVersion: number | null;
  readonly periodMonth: string;
  readonly eventAt: string;
  readonly hostPlanCode: string | null;
  readonly hostSharePct: string | null;
  readonly shareBaseMinor: string | null;
  readonly kminoFeeMinor: string | null;
  readonly hostLegMinor: string;
  readonly adjustments: readonly HostAdjustment[];
  readonly adjustmentsMinor: string;
  readonly netMinor: string;
}

export interface GuestTripFee {
  readonly chargedMinor: string;
  readonly taxMinor: string | null;
  readonly taxRateBps: number | null;
  readonly refundedMinor: string;
  readonly retainedMinor: string;
}

export interface GuestReceipt {
  readonly source: ReceiptSource;
  readonly settlementVersion: number | null;
  readonly totalPaidMinor: string;
  readonly refundMinor: string;
  readonly tripFee: GuestTripFee | null;
  readonly fiscalDocument: 'OFF_PLATFORM';
}

interface ReceiptBase {
  readonly tripId: string;
  readonly tripStatus: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly timezone: string;
}

export type TripReceiptView =
  | (ReceiptBase & { readonly viewerRole: 'GUEST'; readonly receipt: GuestReceipt })
  | (ReceiptBase & { readonly viewerRole: 'HOST'; readonly receipt: HostReceipt });

export interface TripReceiptRow {
  readonly outcome: string;
  readonly viewerRole: string | null;
  readonly tripStatus: string | null;
  readonly currency: string | null;
  readonly exponent: number | null;
  readonly timezone: string | null;
  readonly receipt: unknown;
}

export interface TripReceiptStore {
  read(proof: Buffer, tripId: string): Promise<TripReceiptRow>;
}

export class TripReceiptStoreError extends Error {
  override readonly name = 'TripReceiptStoreError';
  readonly sqlstate: string | undefined;

  constructor(sqlstate: string | undefined) {
    super(`reçu : échec de la base${sqlstate ? ` (SQLSTATE ${sqlstate})` : ''}`);
    this.sqlstate = sqlstate;
  }
}

/** Aucun adaptateur : 503 (fail-closed). */
export class UnavailableTripReceiptStore implements TripReceiptStore {
  read(): Promise<TripReceiptRow> {
    return Promise.reject(new TripReceiptStoreError(undefined));
  }
}

/** Lecture (0133) et exposant de la devise du trip, dans la MÊME instruction. */
export const TRIP_RECEIPT_SQL = `SELECT r.outcome, r.viewer_role, r.trip_status, r.currency, r.timezone,
       r.receipt, c.exponent
  FROM core.booking_trip_receipt($1, $2::uuid) AS r
  LEFT JOIN core.config_currency AS c ON c.code::text = r.currency`;

export class PgTripReceiptStore implements TripReceiptStore {
  constructor(private readonly db: SqlExecutor) {}

  async read(proof: Buffer, tripId: string): Promise<TripReceiptRow> {
    let rows: Record<string, unknown>[];
    try {
      ({ rows } = await this.db.query<Record<string, unknown>>(TRIP_RECEIPT_SQL, [proof, tripId]));
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      throw new TripReceiptStoreError(typeof code === 'string' ? code : undefined);
    }
    const r = rows[0];
    // aucune ligne : contrat rompu, traité comme introuvable (fail-closed)
    if (r === undefined) {
      return {
        outcome: 'NOT_FOUND',
        viewerRole: null,
        tripStatus: null,
        currency: null,
        exponent: null,
        timezone: null,
        receipt: null,
      };
    }
    const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return {
      outcome: text(r['outcome']) ?? 'NOT_FOUND',
      viewerRole: text(r['viewer_role']),
      tripStatus: text(r['trip_status']),
      currency: text(r['currency']),
      exponent: typeof r['exponent'] === 'number' ? r['exponent'] : null,
      timezone: text(r['timezone']),
      receipt: r['receipt'],
    };
  }
}

type Obj = Readonly<Record<string, unknown>>;
export const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | null =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : null;
/** Chaîne au format attendu, `null` admis si `nullable` ; `undefined` = anomalie. */
export function textOf(v: unknown, re: RegExp, nullable = false): string | null | undefined {
  if (v === null) return nullable ? null : undefined;
  return typeof v === 'string' && re.test(v) ? v : undefined;
}
const versionOf = (v: unknown): number | null | undefined =>
  v === null ? null : typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : undefined;
/** Clés exactes : aucune donnée de plus que le contrat (minimisation, fail-closed). */
const sameKeys = (o: Obj, keys: readonly string[]): boolean => {
  const own = Object.keys(o).sort();
  const want = [...keys].sort();
  return own.length === want.length && own.every((k, i) => k === want[i]);
};

const HOST_KEYS = [
  'kind',
  'source',
  'settlementVersion',
  'periodMonth',
  'eventAt',
  'hostPlanCode',
  'hostSharePct',
  'shareBaseMinor',
  'kminoFeeMinor',
  'hostLegMinor',
  'adjustments',
  'adjustmentsMinor',
  'netMinor',
] as const;
const GUEST_KEYS = [
  'source',
  'settlementVersion',
  'totalPaidMinor',
  'refundMinor',
  'tripFee',
  'fiscalDocument',
] as const;
const FEE_KEYS = ['chargedMinor', 'taxMinor', 'taxRateBps', 'refundedMinor', 'retainedMinor'];

function hostReceiptOf(raw: unknown): HostReceipt | null {
  if (!isObj(raw) || !sameKeys(raw, HOST_KEYS)) return null;
  const kind = oneOf(raw['kind'], EARNING_KINDS);
  const source = oneOf(raw['source'], RECEIPT_SOURCES);
  const settlementVersion = versionOf(raw['settlementVersion']);
  const periodMonth = textOf(raw['periodMonth'], MONTH);
  const eventAt = textOf(raw['eventAt'], ISO_MS);
  const hostPlanCode = textOf(raw['hostPlanCode'], PLAN, true);
  const hostSharePct = textOf(raw['hostSharePct'], SHARE, true);
  const shareBaseMinor = textOf(raw['shareBaseMinor'], SIGNED_MINOR, true);
  const kminoFeeMinor = textOf(raw['kminoFeeMinor'], SIGNED_MINOR, true);
  const hostLegMinor = textOf(raw['hostLegMinor'], MINOR);
  const adjustmentsMinor = textOf(raw['adjustmentsMinor'], SIGNED_MINOR);
  const netMinor = textOf(raw['netMinor'], SIGNED_MINOR);
  if (
    kind === null ||
    source === null ||
    settlementVersion === undefined ||
    (source === 'SETTLEMENT') !== (settlementVersion !== null) ||
    typeof periodMonth !== 'string' ||
    typeof eventAt !== 'string' ||
    hostPlanCode === undefined ||
    hostSharePct === undefined ||
    shareBaseMinor === undefined ||
    kminoFeeMinor === undefined ||
    typeof hostLegMinor !== 'string' ||
    typeof adjustmentsMinor !== 'string' ||
    typeof netMinor !== 'string' ||
    !Array.isArray(raw['adjustments'])
  ) {
    return null;
  }
  const adjustments: HostAdjustment[] = [];
  for (const a of raw['adjustments'] as unknown[]) {
    if (!isObj(a) || !sameKeys(a, ['reason', 'amountMinor', 'periodMonth', 'at'])) return null;
    const reason = oneOf(a['reason'], ADJUSTMENT_REASONS);
    const amountMinor = textOf(a['amountMinor'], SIGNED_MINOR);
    const month = textOf(a['periodMonth'], MONTH);
    const at = textOf(a['at'], ISO_MS);
    if (reason === null || typeof amountMinor !== 'string' || typeof month !== 'string') {
      return null;
    }
    if (typeof at !== 'string') return null;
    adjustments.push({ reason, amountMinor, periodMonth: month, at });
  }
  return {
    kind,
    source,
    settlementVersion,
    periodMonth,
    eventAt,
    hostPlanCode,
    hostSharePct,
    shareBaseMinor,
    kminoFeeMinor,
    hostLegMinor,
    adjustments,
    adjustmentsMinor,
    netMinor,
  };
}

function guestReceiptOf(raw: unknown): GuestReceipt | null {
  if (!isObj(raw) || !sameKeys(raw, GUEST_KEYS) || raw['fiscalDocument'] !== 'OFF_PLATFORM') {
    return null;
  }
  const source = oneOf(raw['source'], RECEIPT_SOURCES);
  const settlementVersion = versionOf(raw['settlementVersion']);
  const totalPaidMinor = textOf(raw['totalPaidMinor'], MINOR);
  const refundMinor = textOf(raw['refundMinor'], MINOR);
  if (
    source === null ||
    settlementVersion === undefined ||
    (source === 'SETTLEMENT') !== (settlementVersion !== null) ||
    typeof totalPaidMinor !== 'string' ||
    typeof refundMinor !== 'string'
  ) {
    return null;
  }
  let tripFee: GuestTripFee | null = null;
  const fee = raw['tripFee'];
  if (fee !== null) {
    if (!isObj(fee) || !sameKeys(fee, FEE_KEYS)) return null;
    const chargedMinor = textOf(fee['chargedMinor'], MINOR);
    const taxMinor = textOf(fee['taxMinor'], MINOR, true);
    const refundedMinor = textOf(fee['refundedMinor'], MINOR);
    const retainedMinor = textOf(fee['retainedMinor'], MINOR);
    const bps = fee['taxRateBps'];
    const taxRateBps =
      bps === null
        ? null
        : typeof bps === 'number' && Number.isSafeInteger(bps) && bps >= 0 && bps <= 10_000
          ? bps
          : undefined;
    if (
      typeof chargedMinor !== 'string' ||
      taxMinor === undefined ||
      taxRateBps === undefined ||
      typeof refundedMinor !== 'string' ||
      typeof retainedMinor !== 'string'
    ) {
      return null;
    }
    tripFee = { chargedMinor, taxMinor, taxRateBps, refundedMinor, retainedMinor };
  }
  return {
    source,
    settlementVersion,
    totalPaidMinor,
    refundMinor,
    tripFee,
    fiscalDocument: 'OFF_PLATFORM',
  };
}

/** Exposant affichable d'une devise (config) ; hors bornes ⇒ null. */
export const exponentOk = (e: number | null): e is number =>
  e !== null && Number.isSafeInteger(e) && e >= 0 && e <= 4;

/** Service de la route `GET /trips/{tripId}/receipt`. */
export class TripReceiptService {
  constructor(private readonly store: TripReceiptStore) {}

  async read(proof: Buffer | null, rawTripId: string): Promise<TripReceiptView> {
    if (proof === null) throw new TripReceiptHttpError('AUTH_REQUIRED');
    const tripId = rawTripId.toLowerCase();
    // identifiant mal formé : même réponse qu'un trip d'autrui (aucun oracle)
    if (!isUuid(tripId)) throw new TripReceiptHttpError('RECEIPT_NOT_FOUND');
    let row: TripReceiptRow;
    try {
      row = await this.store.read(proof, tripId);
    } catch {
      throw new TripReceiptHttpError('RECEIPT_UNAVAILABLE');
    }
    if (row.outcome === 'NOT_FOUND') throw new TripReceiptHttpError('RECEIPT_NOT_FOUND');
    const role = row.viewerRole;
    if (row.outcome === 'NO_RECEIPT' && (role === 'GUEST' || role === 'HOST')) {
      throw new TripReceiptHttpError('RECEIPT_NOT_READY');
    }
    if (
      row.outcome !== 'OK' ||
      (role !== 'GUEST' && role !== 'HOST') ||
      row.currency === null ||
      !/^[A-Z]{3}$/.test(row.currency) ||
      !exponentOk(row.exponent) ||
      row.tripStatus === null ||
      !CODE.test(row.tripStatus) ||
      row.timezone === null ||
      !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(row.timezone)
    ) {
      throw new TripReceiptHttpError('RECEIPT_UNAVAILABLE');
    }
    const base = {
      tripId,
      tripStatus: row.tripStatus,
      currency: row.currency,
      currencyExponent: row.exponent,
      timezone: row.timezone,
    };
    if (role === 'GUEST') {
      const receipt = guestReceiptOf(row.receipt);
      if (receipt === null) throw new TripReceiptHttpError('RECEIPT_UNAVAILABLE');
      return { ...base, viewerRole: 'GUEST', receipt };
    }
    const receipt = hostReceiptOf(row.receipt);
    if (receipt === null) throw new TripReceiptHttpError('RECEIPT_UNAVAILABLE');
    return { ...base, viewerRole: 'HOST', receipt };
  }
}
