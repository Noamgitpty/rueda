/**
 * Lecture du remboursement d'un trip par sa partie (US-224 partie 224d, ADR-154 ; 19 US-224
 * critère 1 ; 16 PAY-021 ; 08 SM-8, E3, BR-PAY-08 ; 10b S10, UX-31). Le voyageur lit le montant
 * remboursé par Kmino, le rail et la date d'ÉMISSION (jamais une date de réception) ; le titulaire
 * du compte d'hôte lit la seule part de la jambe HOST (impact sur ses gains). La base juge la
 * partie (`core.booking_trip_refunds`, 0130, SECURITY DEFINER, EXECUTE app_api) et rend la même
 * réponse NOT_FOUND à toute autre personne : la route rend alors 404 `REFUND_NOT_FOUND`, comme pour
 * un trip inconnu ou un identifiant mal formé (aucun oracle).
 *
 * Montants en unités mineures, en TEXTE (bigint exact), lus de la base et jamais recalculés ;
 * exposant de la devise joint dans la même instruction (affichage seulement). Toute forme inattendue
 * de la base ⇒ 503 `REFUNDS_UNAVAILABLE` (fail-closed : jamais un remboursement partiel ni deviné).
 */
import { HttpException } from '@nestjs/common';
import { isUuid } from './model.js';
import type { SqlExecutor } from './store.js';

export const TRIP_REFUND_MESSAGES = {
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  REFUND_NOT_FOUND: { status: 404, messageKey: 'common.refund.notFound' },
  REFUNDS_UNAVAILABLE: { status: 503, messageKey: 'common.refund.unavailable' },
} as const;

export type TripRefundHttpCode = keyof typeof TRIP_REFUND_MESSAGES;

export class TripRefundHttpError extends HttpException {
  readonly code: TripRefundHttpCode;

  constructor(code: TripRefundHttpCode) {
    super(
      { code, messageKey: TRIP_REFUND_MESSAGES[code].messageKey },
      TRIP_REFUND_MESSAGES[code].status,
    );
    this.code = code;
  }
}

/** États de 08 SM-8 (17 §3.2.7) ; la base n'en rend pas d'autre. */
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

/** Rails de 08 E3. */
export const REFUND_RAILS = [
  'NATIVE_PARTIAL',
  'ROLLBACK_AND_RECHARGE',
  'BANK_TRANSFER',
  'CREDIT_CASH',
] as const;
export type RefundRail = (typeof REFUND_RAILS)[number];

export interface GuestRefund {
  readonly status: RefundStatus;
  readonly amountMinor: string;
  readonly rail: RefundRail;
  readonly plannedAt: string;
  readonly issuedAt: string | null;
}

export interface HostRefund {
  readonly status: RefundStatus;
  readonly hostLegMinor: string;
  readonly plannedAt: string;
  readonly issuedAt: string | null;
}

export type TripRefundsView =
  | {
      readonly tripId: string;
      readonly viewerRole: 'GUEST';
      readonly tripStatus: string;
      readonly currency: string;
      readonly currencyExponent: number;
      readonly timezone: string;
      readonly refunds: readonly GuestRefund[];
    }
  | {
      readonly tripId: string;
      readonly viewerRole: 'HOST';
      readonly tripStatus: string;
      readonly currency: string;
      readonly currencyExponent: number;
      readonly timezone: string;
      readonly refunds: readonly HostRefund[];
    };

export interface TripRefundRow {
  readonly outcome: string;
  readonly viewerRole: string | null;
  readonly tripStatus: string | null;
  readonly currency: string | null;
  readonly exponent: number | null;
  /** Fuseau IANA du trip (affichage de la date d'émission). */
  readonly timezone: string | null;
  readonly refunds: unknown;
}

export interface TripRefundStore {
  read(proof: Buffer, tripId: string): Promise<TripRefundRow>;
}

export class TripRefundStoreError extends Error {
  override readonly name = 'TripRefundStoreError';
  readonly sqlstate: string | undefined;

  constructor(sqlstate: string | undefined) {
    super(`remboursements : échec de la base${sqlstate ? ` (SQLSTATE ${sqlstate})` : ''}`);
    this.sqlstate = sqlstate;
  }
}

/** Aucun adaptateur : 503 (fail-closed). */
export class UnavailableTripRefundStore implements TripRefundStore {
  read(): Promise<TripRefundRow> {
    return Promise.reject(new TripRefundStoreError(undefined));
  }
}

/** Lecture (0130) et exposant de la devise du trip, dans la MÊME instruction. */
export const TRIP_REFUNDS_SQL = `SELECT r.outcome, r.viewer_role, r.trip_status, r.currency, r.timezone,
       r.refunds, c.exponent
  FROM core.booking_trip_refunds($1, $2::uuid) AS r
  LEFT JOIN core.config_currency AS c ON c.code::text = r.currency`;

export class PgTripRefundStore implements TripRefundStore {
  constructor(private readonly db: SqlExecutor) {}

  async read(proof: Buffer, tripId: string): Promise<TripRefundRow> {
    let rows: Record<string, unknown>[];
    try {
      ({ rows } = await this.db.query<Record<string, unknown>>(TRIP_REFUNDS_SQL, [proof, tripId]));
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      throw new TripRefundStoreError(typeof code === 'string' ? code : undefined);
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
        refunds: null,
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
      refunds: r['refunds'],
    };
  }
}

const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, all: readonly T[]): T | null =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : null;
const isoOf = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === 'string' && ISO_MS.test(v) ? v : undefined;

/** Instances rendues par la base, contrôlées une à une ; une seule anomalie ⇒ `null`. */
function itemsOf(role: 'GUEST' | 'HOST', currency: string, raw: unknown) {
  if (!Array.isArray(raw)) return null;
  const guest: GuestRefund[] = [];
  const host: HostRefund[] = [];
  for (const item of raw as unknown[]) {
    if (!isObj(item) || item['currency'] !== currency) return null;
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
  return role === 'GUEST' ? guest : host;
}

/** Service de la route `GET /trips/{tripId}/refunds`. */
export class TripRefundsService {
  constructor(private readonly store: TripRefundStore) {}

  async read(proof: Buffer | null, rawTripId: string): Promise<TripRefundsView> {
    if (proof === null) throw new TripRefundHttpError('AUTH_REQUIRED');
    const tripId = rawTripId.toLowerCase();
    // identifiant mal formé : même réponse qu'un trip d'autrui (aucun oracle)
    if (!isUuid(tripId)) throw new TripRefundHttpError('REFUND_NOT_FOUND');
    let row: TripRefundRow;
    try {
      row = await this.store.read(proof, tripId);
    } catch {
      throw new TripRefundHttpError('REFUNDS_UNAVAILABLE');
    }
    if (row.outcome === 'NOT_FOUND') throw new TripRefundHttpError('REFUND_NOT_FOUND');
    const role = row.viewerRole;
    if (
      row.outcome !== 'OK' ||
      (role !== 'GUEST' && role !== 'HOST') ||
      row.currency === null ||
      !/^[A-Z]{3}$/.test(row.currency) ||
      row.exponent === null ||
      !Number.isSafeInteger(row.exponent) ||
      row.exponent < 0 ||
      row.exponent > 4 ||
      row.tripStatus === null ||
      row.timezone === null ||
      !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(row.timezone)
    ) {
      throw new TripRefundHttpError('REFUNDS_UNAVAILABLE');
    }
    const items = itemsOf(role, row.currency, row.refunds);
    if (items === null) throw new TripRefundHttpError('REFUNDS_UNAVAILABLE');
    const base = {
      tripId,
      tripStatus: row.tripStatus,
      currency: row.currency,
      currencyExponent: row.exponent,
      timezone: row.timezone,
    };
    return role === 'GUEST'
      ? { ...base, viewerRole: 'GUEST', refunds: items as GuestRefund[] }
      : { ...base, viewerRole: 'HOST', refunds: items as HostRefund[] };
  }
}
