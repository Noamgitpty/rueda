/**
 * Relevé mensuel des gains d'un compte d'hôte (US-217 partie 217a, ADR-161 ; 19 US-217 critères 2
 * et 3 ; 16 PYO-013 ; 17 §3.2.13 `host_earnings_statement` / `host_earnings_line` ; 10b UX-45). Par
 * devise : Σ jambes HOST des trips du mois (version en tête du règlement, sinon capture), Σ
 * ajustements du host_ledger (pénalité de l'hôte, en ligne séparée), net, et les lignes. La base
 * vérifie que la session est TITULAIRE du compte (`core.booking_host_earnings`, 0137, SECURITY
 * DEFINER, EXECUTE app_api) : compte d'un autre, co-hôte, inconnu ou identifiant mal formé ⇒ 404
 * `EARNINGS_NOT_FOUND`, même réponse ; mois mal formé ⇒ 400 `REQUEST_INVALID`.
 *
 * Montants en unités mineures, en TEXTE (bigint exact), lus de la base et jamais recalculés ;
 * exposant de chaque devise joint dans la même instruction. Toute forme inattendue ⇒ 503
 * `EARNINGS_UNAVAILABLE` (fail-closed). Aucun versement n'est promis : `payouts_enabled` vaut
 * `false` en production (BR-PAYOUT-05) ; l'écran A08 (Bêta L3) le dira (`web.a08.payoutsOff`).
 */
import { HttpException } from '@nestjs/common';
import { isUuid } from './model.js';
import type { SqlExecutor } from './store.js';
import {
  ADJUSTMENT_REASONS,
  EARNING_KINDS,
  exponentOk,
  ISO_MS,
  isObj,
  MINOR,
  MONTH,
  oneOf,
  SIGNED_MINOR,
  textOf,
} from './trip-receipt.js';

export const HOST_EARNINGS_MESSAGES = {
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  EARNINGS_NOT_FOUND: { status: 404, messageKey: 'common.earnings.notFound' },
  EARNINGS_UNAVAILABLE: { status: 503, messageKey: 'common.earnings.unavailable' },
} as const;

export type HostEarningsHttpCode = keyof typeof HOST_EARNINGS_MESSAGES;

export class HostEarningsHttpError extends HttpException {
  readonly code: HostEarningsHttpCode;

  constructor(code: HostEarningsHttpCode) {
    super(
      { code, messageKey: HOST_EARNINGS_MESSAGES[code].messageKey },
      HOST_EARNINGS_MESSAGES[code].status,
    );
    this.code = code;
  }
}

const LINE_KINDS = [...EARNING_KINDS, 'ADJUSTMENT'] as const;
type LineKind = (typeof LINE_KINDS)[number];
const LINE_SOURCES = ['CAPTURE', 'SETTLEMENT', 'HOST_LEDGER'] as const;
type LineSource = (typeof LINE_SOURCES)[number];
const PLAN = /^[A-Z][A-Z0-9_ÁÉÍÓÚÑ]{0,31}$/;
const SHARE = /^[0-9]{1,9}\/[1-9][0-9]{0,8}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface EarningsLine {
  readonly kind: LineKind;
  readonly tripId: string;
  readonly tripStatus: string;
  readonly source: LineSource;
  readonly settlementVersion: number | null;
  readonly reason: string | null;
  readonly eventAt: string;
  readonly amountMinor: string;
  readonly shareBaseMinor: string | null;
  readonly kminoFeeMinor: string | null;
  readonly hostPlanCode: string | null;
  readonly hostSharePct: string | null;
}

export interface EarningsStatement {
  readonly currency: string;
  readonly currencyExponent: number;
  readonly tripsCount: number;
  readonly hostLegMinor: string;
  readonly adjustmentsMinor: string;
  readonly netMinor: string;
  readonly lines: readonly EarningsLine[];
}

export interface HostEarningsView {
  readonly orgId: string;
  readonly month: string;
  readonly country: string;
  readonly statements: readonly EarningsStatement[];
}

export interface HostEarningsRow {
  readonly outcome: string;
  readonly country: string | null;
  readonly statements: unknown;
  /** Exposant de chaque devise de la configuration (`config_currency`). */
  readonly exponents: unknown;
}

export interface HostEarningsStore {
  read(proof: Buffer, orgId: string, month: string): Promise<HostEarningsRow>;
}

export class HostEarningsStoreError extends Error {
  override readonly name = 'HostEarningsStoreError';
}

/** Aucun adaptateur : 503 (fail-closed). */
export class UnavailableHostEarningsStore implements HostEarningsStore {
  read(): Promise<HostEarningsRow> {
    return Promise.reject(new HostEarningsStoreError('relevé : aucun adaptateur'));
  }
}

/** Lecture (0137) et exposants des devises, dans la MÊME instruction. */
export const HOST_EARNINGS_SQL = `SELECT r.outcome, r.country_code, r.statements,
       (SELECT pg_catalog.jsonb_object_agg(c.code::text, c.exponent)
          FROM core.config_currency AS c) AS exponents
  FROM core.booking_host_earnings($1, $2::uuid, $3) AS r`;

export class PgHostEarningsStore implements HostEarningsStore {
  constructor(private readonly db: SqlExecutor) {}

  async read(proof: Buffer, orgId: string, month: string): Promise<HostEarningsRow> {
    let rows: Record<string, unknown>[];
    try {
      ({ rows } = await this.db.query<Record<string, unknown>>(HOST_EARNINGS_SQL, [
        proof,
        orgId,
        month,
      ]));
    } catch {
      throw new HostEarningsStoreError('relevé : échec de la base');
    }
    const r = rows[0];
    if (r === undefined) {
      return { outcome: 'FORBIDDEN', country: null, statements: null, exponents: null };
    }
    return {
      outcome: typeof r['outcome'] === 'string' ? r['outcome'] : 'FORBIDDEN',
      country: typeof r['country_code'] === 'string' ? r['country_code'] : null,
      statements: r['statements'],
      exponents: r['exponents'],
    };
  }
}

const LINE_KEYS = [
  'kind',
  'tripId',
  'tripStatus',
  'source',
  'settlementVersion',
  'reason',
  'eventAt',
  'amountMinor',
  'shareBaseMinor',
  'kminoFeeMinor',
  'hostPlanCode',
  'hostSharePct',
];
const STATEMENT_KEYS = [
  'currency',
  'tripsCount',
  'hostLegMinor',
  'adjustmentsMinor',
  'netMinor',
  'lines',
];
const sameKeys = (o: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean => {
  const own = Object.keys(o).sort();
  const want = [...keys].sort();
  return own.length === want.length && own.every((k, i) => k === want[i]);
};

function lineOf(raw: unknown): EarningsLine | null {
  if (!isObj(raw) || !sameKeys(raw, LINE_KEYS)) return null;
  const kind = oneOf(raw['kind'], LINE_KINDS);
  const source = oneOf(raw['source'], LINE_SOURCES);
  const tripId = textOf(raw['tripId'], UUID_TEXT);
  const tripStatus = textOf(raw['tripStatus'], CODE);
  const v = raw['settlementVersion'];
  const settlementVersion =
    v === null ? null : typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : undefined;
  const reason =
    raw['reason'] === null ? null : (oneOf(raw['reason'], ADJUSTMENT_REASONS) ?? undefined);
  const eventAt = textOf(raw['eventAt'], ISO_MS);
  const amountMinor = textOf(raw['amountMinor'], kind === 'ADJUSTMENT' ? SIGNED_MINOR : MINOR);
  const shareBaseMinor = textOf(raw['shareBaseMinor'], SIGNED_MINOR, true);
  const kminoFeeMinor = textOf(raw['kminoFeeMinor'], SIGNED_MINOR, true);
  const hostPlanCode = textOf(raw['hostPlanCode'], PLAN, true);
  const hostSharePct = textOf(raw['hostSharePct'], SHARE, true);
  if (
    kind === null ||
    source === null ||
    (kind === 'ADJUSTMENT') !== (source === 'HOST_LEDGER') ||
    (kind === 'ADJUSTMENT') !== (reason !== null) ||
    typeof tripId !== 'string' ||
    typeof tripStatus !== 'string' ||
    settlementVersion === undefined ||
    reason === undefined ||
    typeof eventAt !== 'string' ||
    typeof amountMinor !== 'string' ||
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
    settlementVersion,
    reason,
    eventAt,
    amountMinor,
    shareBaseMinor,
    kminoFeeMinor,
    hostPlanCode,
    hostSharePct,
  };
}

function statementsOf(raw: unknown, exponents: unknown): EarningsStatement[] | null {
  if (!Array.isArray(raw) || !isObj(exponents)) return null;
  const out: EarningsStatement[] = [];
  for (const s of raw as unknown[]) {
    if (!isObj(s) || !sameKeys(s, STATEMENT_KEYS) || !Array.isArray(s['lines'])) return null;
    const currency = textOf(s['currency'], /^[A-Z]{3}$/);
    const count = s['tripsCount'];
    const hostLegMinor = textOf(s['hostLegMinor'], MINOR);
    const adjustmentsMinor = textOf(s['adjustmentsMinor'], SIGNED_MINOR);
    const netMinor = textOf(s['netMinor'], SIGNED_MINOR);
    if (
      typeof currency !== 'string' ||
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      typeof hostLegMinor !== 'string' ||
      typeof adjustmentsMinor !== 'string' ||
      typeof netMinor !== 'string'
    ) {
      return null;
    }
    const e = exponents[currency];
    const exponent = typeof e === 'number' ? e : null;
    if (!exponentOk(exponent)) return null;
    const lines: EarningsLine[] = [];
    for (const l of s['lines'] as unknown[]) {
      const line = lineOf(l);
      if (line === null) return null;
      lines.push(line);
    }
    out.push({
      currency,
      currencyExponent: exponent,
      tripsCount: count,
      hostLegMinor,
      adjustmentsMinor,
      netMinor,
      lines,
    });
  }
  return out;
}

/** Service de la route `GET /host/accounts/{orgId}/earnings/{month}`. */
export class HostEarningsService {
  constructor(private readonly store: HostEarningsStore) {}

  async read(proof: Buffer | null, rawOrgId: string, month: string): Promise<HostEarningsView> {
    if (proof === null) throw new HostEarningsHttpError('AUTH_REQUIRED');
    const orgId = rawOrgId.toLowerCase();
    // compte mal formé : même réponse qu'un compte d'autrui (aucun oracle)
    if (!isUuid(orgId)) throw new HostEarningsHttpError('EARNINGS_NOT_FOUND');
    if (!MONTH.test(month)) throw new HostEarningsHttpError('REQUEST_INVALID');
    let row: HostEarningsRow;
    try {
      row = await this.store.read(proof, orgId, month);
    } catch {
      throw new HostEarningsHttpError('EARNINGS_UNAVAILABLE');
    }
    if (row.outcome === 'FORBIDDEN') throw new HostEarningsHttpError('EARNINGS_NOT_FOUND');
    if (row.outcome === 'REQUEST_INVALID') throw new HostEarningsHttpError('REQUEST_INVALID');
    if (row.outcome !== 'OK' || row.country === null || !/^[A-Z]{2}$/.test(row.country)) {
      throw new HostEarningsHttpError('EARNINGS_UNAVAILABLE');
    }
    const statements = statementsOf(row.statements, row.exponents);
    if (statements === null) throw new HostEarningsHttpError('EARNINGS_UNAVAILABLE');
    return { orgId, month, country: row.country, statements };
  }
}
