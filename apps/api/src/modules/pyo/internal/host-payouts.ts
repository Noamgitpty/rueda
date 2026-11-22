/**
 * Versements de l'hôte lus par le titulaire du compte d'hôte (US-314, ADR-192 ; 19 US-314
 * critère 5 ; 16 PYO-003 ; 08 BR-PAYOUT-02, SM-6 ; 17 §2.3 RLS-26, RLS-28 ; 10b A08).
 *
 * La base juge tout (`core.payout_host_payouts`, 0172, SECURITY DEFINER, EXECUTE app_api) : la
 * personne de la SESSION doit être TITULAIRE du compte (`core.iam_host_accounts` : un co-hôte,
 * même doté de `finance.read_org_statements`, est refusé comme un compte inconnu) et la matrice
 * doit accorder `finance.read_org_statements` au rôle P2P_HOST. La réponse porte le calendrier du
 * pays (jours ouvrés du versement et du premier versement, heure locale du lot, fuseau : 17 §7.2)
 * et les 24 derniers lots : état SM-6, date prévue, premier versement, brut, compensation du
 * host_ledger, net, motifs de retenue, dates d'émission et de paiement, trips. Jamais un
 * identifiant du personnel, un compte PSP, le compte de versement, une clé ou une référence du PSP.
 *
 * Montants en unités mineures, en TEXTE (bigint exact), lus et jamais recalculés ; exposant de la
 * devise lu dans la même instruction. Toute forme inattendue ⇒ 503 `PAYOUTS_UNAVAILABLE`
 * (fail-closed). Un motif de retenue inconnu de ce code devient `OTHER` (« versement retenu »),
 * jamais un versement promis. Aucun interrupteur n'est lu ni écrit ici.
 */
import { PyoHttpError } from './errors.js';
import type { PyoSqlExecutor } from './pg-payout-account-store.js';

/** États d'un lot (08 SM-6, 0165). */
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

/** Types de lot (0165). */
export const PAYOUT_KINDS = ['FINAL', 'CXL_EARNINGS', 'INVOICE_SHARE', 'PARTIAL_WEEKLY'] as const;
export type PayoutKind = (typeof PAYOUT_KINDS)[number];

/**
 * Motifs de retenue lisibles par l'hôte (0165, 0167, 0172) ; `OTHER` : tout autre motif (un motif
 * ajouté par une story à venir ne casse pas l'écran et ne promet rien).
 */
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

export interface PayoutSchedule {
  /** Jours ouvrés du pays entre la fin du trip et le versement (`payout_business_day_offset`). */
  readonly businessDayOffset: number | null;
  /** Idem pour le premier versement (`first_payout_business_day`). */
  readonly firstPayoutBusinessDay: number | null;
  /** Heure locale du lot, en minutes après minuit (`payout_batch_local_time`). */
  readonly localTimeMinutes: number | null;
  /** Fuseau du pays (IANA). */
  readonly timeZone: string | null;
  /** `payouts_enabled[pays]` lu par la base (absent ⇒ false) : calendrier annoncé au conditionnel. */
  readonly payoutsOpen: boolean;
}

export interface PayoutTrip {
  readonly tripId: string;
  readonly amountMinor: string;
}

export interface HostPayout {
  readonly batchId: string;
  readonly kind: PayoutKind;
  readonly status: PayoutStatus;
  readonly scheduledFor: string;
  readonly firstPayout: boolean;
  readonly grossMinor: string;
  readonly nettedMinor: string;
  readonly netMinor: string;
  readonly holdReasons: readonly HoldReason[];
  readonly initiatedAt: string | null;
  readonly paidAt: string | null;
  readonly trips: readonly PayoutTrip[];
}

export interface HostPayoutsView {
  readonly orgId: string;
  readonly country: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly schedule: PayoutSchedule;
  readonly payouts: readonly HostPayout[];
}

export interface HostPayoutsRow {
  readonly outcome: string;
  readonly country: string | null;
  readonly currency: string | null;
  readonly schedule: unknown;
  readonly batches: unknown;
  readonly exponent: unknown;
}

export interface HostPayoutsStore {
  read(proof: Buffer, orgId: string): Promise<HostPayoutsRow>;
}

export class HostPayoutsStoreError extends Error {
  override readonly name = 'HostPayoutsStoreError';
}

/** Aucun adaptateur : 503 (fail-closed). */
export class UnavailableHostPayoutsStore implements HostPayoutsStore {
  read(): Promise<HostPayoutsRow> {
    return Promise.reject(new HostPayoutsStoreError('versements : aucun adaptateur'));
  }
}

/** Lecture (0172) et exposant de la devise, dans la MÊME instruction. */
export const HOST_PAYOUTS_SQL = `SELECT r.outcome, r.country_code, r.currency, r.schedule, r.batches,
       (SELECT c.exponent FROM core.config_currency AS c WHERE c.code::text = r.currency) AS exponent
  FROM core.payout_host_payouts($1, $2::uuid) AS r`;

export class PgHostPayoutsStore implements HostPayoutsStore {
  constructor(private readonly db: PyoSqlExecutor) {}

  async read(proof: Buffer, orgId: string): Promise<HostPayoutsRow> {
    let rows: Record<string, unknown>[];
    try {
      ({ rows } = await this.db.query<Record<string, unknown>>(HOST_PAYOUTS_SQL, [proof, orgId]));
    } catch {
      throw new HostPayoutsStoreError('versements : échec de la base');
    }
    const r = rows[0];
    if (r === undefined) throw new HostPayoutsStoreError('versements : aucune ligne');
    return {
      outcome: typeof r['outcome'] === 'string' ? r['outcome'] : '',
      country: typeof r['country_code'] === 'string' ? r['country_code'] : null,
      currency: typeof r['currency'] === 'string' ? r['currency'] : null,
      schedule: r['schedule'],
      batches: r['batches'],
      exponent: r['exponent'],
    };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
/** Nombre de lots rendus au plus par la base (0172). */
export const MAX_PAYOUTS = 24;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const sameKeys = (o: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean => {
  const own = Object.keys(o).sort();
  const want = [...keys].sort();
  return own.length === want.length && own.every((k, i) => k === want[i]);
};
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;
const textOf = (v: unknown, re: RegExp): string | null =>
  typeof v === 'string' && re.test(v) ? v : null;
/** Entier borné ou null ; toute autre forme ⇒ undefined (refus). */
const intOrNull = (v: unknown, max: number): number | null | undefined => {
  if (v === null) return null;
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : undefined;
};

const SCHEDULE_KEYS = [
  'businessDayOffset',
  'firstPayoutBusinessDay',
  'localTimeMinutes',
  'timeZone',
  'payoutsOpen',
];
const BATCH_KEYS = [
  'batchId',
  'kind',
  'status',
  'currency',
  'scheduledFor',
  'firstPayout',
  'grossMinor',
  'nettedMinor',
  'netMinor',
  'holdReasons',
  'initiatedAt',
  'paidAt',
  'items',
];
const ITEM_KEYS = ['tripId', 'amountMinor'];

function scheduleOf(raw: unknown): PayoutSchedule | null {
  if (!isObj(raw) || !sameKeys(raw, SCHEDULE_KEYS)) return null;
  const businessDayOffset = intOrNull(raw['businessDayOffset'], 99);
  const firstPayoutBusinessDay = intOrNull(raw['firstPayoutBusinessDay'], 99);
  const localTimeMinutes = intOrNull(raw['localTimeMinutes'], 1439);
  const tz = raw['timeZone'];
  const timeZone = tz === null ? null : textOf(tz, TIME_ZONE);
  if (
    businessDayOffset === undefined ||
    firstPayoutBusinessDay === undefined ||
    localTimeMinutes === undefined ||
    (tz !== null && timeZone === null) ||
    typeof raw['payoutsOpen'] !== 'boolean'
  ) {
    return null;
  }
  return {
    businessDayOffset,
    firstPayoutBusinessDay,
    localTimeMinutes,
    timeZone,
    payoutsOpen: raw['payoutsOpen'],
  };
}

/** Motifs lisibles, sans doublon, dans l'ordre reçu ; motif inconnu ⇒ OTHER. */
function reasonsOf(raw: unknown): HoldReason[] | null {
  if (!Array.isArray(raw)) return null;
  const out: HoldReason[] = [];
  for (const r of raw as unknown[]) {
    if (typeof r !== 'string' || !CODE.test(r)) return null;
    const known = oneOf(r, HOLD_REASONS) ?? 'OTHER';
    if (!out.includes(known)) out.push(known);
  }
  return out;
}

function tripsOf(raw: unknown): PayoutTrip[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PayoutTrip[] = [];
  for (const i of raw as unknown[]) {
    if (!isObj(i) || !sameKeys(i, ITEM_KEYS)) return null;
    const tripId = textOf(i['tripId'], UUID);
    const amountMinor = textOf(i['amountMinor'], MINOR);
    if (tripId === null || amountMinor === null) return null;
    out.push({ tripId, amountMinor });
  }
  return out;
}

function payoutOf(raw: unknown, currency: string): HostPayout | null {
  if (!isObj(raw) || !sameKeys(raw, BATCH_KEYS)) return null;
  const batchId = textOf(raw['batchId'], UUID);
  const kind = oneOf(raw['kind'], PAYOUT_KINDS);
  const status = oneOf(raw['status'], PAYOUT_STATUSES);
  const scheduledFor = textOf(raw['scheduledFor'], ISO_MS);
  const firstPayout = raw['firstPayout'];
  const grossMinor = textOf(raw['grossMinor'], MINOR);
  const nettedMinor = textOf(raw['nettedMinor'], MINOR);
  const netMinor = textOf(raw['netMinor'], MINOR);
  const holdReasons = reasonsOf(raw['holdReasons']);
  const ia = raw['initiatedAt'];
  const pa = raw['paidAt'];
  const initiatedAt = ia === null ? null : textOf(ia, ISO_MS);
  const paidAt = pa === null ? null : textOf(pa, ISO_MS);
  const trips = tripsOf(raw['items']);
  if (
    batchId === null ||
    kind === null ||
    status === null ||
    raw['currency'] !== currency ||
    scheduledFor === null ||
    typeof firstPayout !== 'boolean' ||
    grossMinor === null ||
    nettedMinor === null ||
    netMinor === null ||
    holdReasons === null ||
    (ia !== null && initiatedAt === null) ||
    (pa !== null && paidAt === null) ||
    trips === null ||
    // forme de 0165 : net = brut − compensation ; retenu ⇔ au moins un motif ; payé ⇔ date
    BigInt(netMinor) !== BigInt(grossMinor) - BigInt(nettedMinor) ||
    (status === 'ON_HOLD') !== holdReasons.length > 0 ||
    (status === 'PAID') !== (paidAt !== null)
  ) {
    return null;
  }
  return {
    batchId,
    kind,
    status,
    scheduledFor,
    firstPayout,
    grossMinor,
    nettedMinor,
    netMinor,
    holdReasons,
    initiatedAt,
    paidAt,
    trips,
  };
}

/** Vue validée, ou null si la base a rendu une forme inattendue. */
export function hostPayoutsOf(orgId: string, row: HostPayoutsRow): HostPayoutsView | null {
  const country = textOf(row.country, /^[A-Z]{2}$/);
  const currency = textOf(row.currency, /^[A-Z]{3}$/);
  const exp = row.exponent;
  const schedule = scheduleOf(row.schedule);
  if (
    country === null ||
    currency === null ||
    typeof exp !== 'number' ||
    !Number.isSafeInteger(exp) ||
    exp < 0 ||
    exp > 4 ||
    schedule === null ||
    !Array.isArray(row.batches) ||
    row.batches.length > MAX_PAYOUTS
  ) {
    return null;
  }
  const payouts: HostPayout[] = [];
  for (const b of row.batches as unknown[]) {
    const p = payoutOf(b, currency);
    if (p === null) return null;
    payouts.push(p);
  }
  return { orgId, country, currency, currencyExponent: exp, schedule, payouts };
}

export class HostPayoutsService {
  constructor(private readonly store: HostPayoutsStore) {}

  async read(proof: Buffer, orgId: string): Promise<HostPayoutsView> {
    let row: HostPayoutsRow;
    try {
      row = await this.store.read(proof, orgId);
    } catch (error) {
      if (error instanceof HostPayoutsStoreError) throw new PyoHttpError('PAYOUTS_UNAVAILABLE');
      throw error;
    }
    switch (row.outcome) {
      case 'OK': {
        const view = hostPayoutsOf(orgId, row);
        if (view === null) throw new PyoHttpError('PAYOUTS_UNAVAILABLE');
        return view;
      }
      case 'AUTH_REQUIRED':
        throw new PyoHttpError('AUTH_REQUIRED');
      case 'FORBIDDEN':
        throw new PyoHttpError('HOST_ACCOUNT_NOT_FOUND');
      case 'PERMISSION_DENIED':
        throw new PyoHttpError('PAYOUTS_READ_FORBIDDEN');
      default:
        throw new PyoHttpError('PAYOUTS_UNAVAILABLE');
    }
  }
}
