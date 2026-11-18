/**
 * Reçu du voyageur côté site (US-217 partie 217b, ADR-161 / ADR-167 ; 19 US-217 critère 1, US-214
 * critère 2 ; 10b S09 ; 16 FIN-018, FIN-002) : lecture DÉFENSIVE de `GET /trips/{id}/receipt`, vue
 * GUEST seulement (toute autre vue, ou toute forme inattendue ⇒ `null` : l'écran dit l'erreur,
 * jamais un reçu partiel ou deviné). Montants en unités mineures (texte de l'API, convertis en
 * `bigint` pour l'affichage seulement), jamais recalculés :
 * - `totalPaidMinor` : total payé à Kmino ;
 * - `refundDueMinor` : remboursement DÛ par le règlement (clé `refundMinor` de l'API), pas un
 *   remboursement émis : l'écran renvoie à S10 pour son état et sa date d'émission (N-338) ;
 * - trip fee : facturé, sa taxe de ligne (rendue seulement si rien du trip fee n'est remboursé,
 *   N-337), part remboursée et part conservée.
 * Côté serveur seulement ; jamais de donnée personnelle dans une URL ni dans un journal.
 */
import type { ApiResult } from './api-client.ts';

export interface GuestReceiptFee {
  readonly chargedMinor: bigint;
  readonly taxMinor: bigint | null;
  readonly taxRateBps: number | null;
  readonly refundedMinor: bigint;
  readonly retainedMinor: bigint;
}

export interface GuestReceiptView {
  readonly tripId: string;
  readonly tripStatus: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly timezone: string;
  /** `SETTLEMENT` : version en tête du règlement ; `CAPTURE` : aucun règlement encore. */
  readonly source: 'CAPTURE' | 'SETTLEMENT';
  readonly totalPaidMinor: bigint;
  readonly refundDueMinor: bigint;
  readonly tripFee: GuestReceiptFee | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const ZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const minorOf = (v: unknown): bigint | null =>
  typeof v === 'string' && MINOR.test(v) ? BigInt(v) : null;
const sameKeys = (o: Obj, keys: readonly string[]): boolean => {
  const own = Object.keys(o).sort();
  const want = [...keys].sort();
  return own.length === want.length && own.every((k, i) => k === want[i]);
};

const RECEIPT_KEYS = [
  'source',
  'settlementVersion',
  'totalPaidMinor',
  'refundMinor',
  'tripFee',
  'fiscalDocument',
];
const FEE_KEYS = ['chargedMinor', 'taxMinor', 'taxRateBps', 'refundedMinor', 'retainedMinor'];

function feeOf(raw: unknown): GuestReceiptFee | null | undefined {
  if (raw === null) return null;
  if (!isObj(raw) || !sameKeys(raw, FEE_KEYS)) return undefined;
  const chargedMinor = minorOf(raw['chargedMinor']);
  const refundedMinor = minorOf(raw['refundedMinor']);
  const retainedMinor = minorOf(raw['retainedMinor']);
  const taxMinor = raw['taxMinor'] === null ? null : minorOf(raw['taxMinor']);
  const bps = raw['taxRateBps'];
  const taxRateBps =
    bps === null
      ? null
      : typeof bps === 'number' && Number.isSafeInteger(bps) && bps >= 0 && bps <= 10_000
        ? bps
        : undefined;
  if (
    chargedMinor === null ||
    refundedMinor === null ||
    retainedMinor === null ||
    (raw['taxMinor'] !== null && taxMinor === null) ||
    taxRateBps === undefined
  ) {
    return undefined;
  }
  return { chargedMinor, taxMinor, taxRateBps, refundedMinor, retainedMinor };
}

/** Reçu du voyageur d'une réponse 200 de `GET /trips/{id}/receipt`, sinon `null`. */
export function guestReceiptOf(reply: ApiResult): GuestReceiptView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const r = j['receipt'];
  const tripId = j['tripId'];
  const tripStatus = j['tripStatus'];
  const currency = j['currency'];
  const exponent = j['currencyExponent'];
  const timezone = j['timezone'];
  if (
    j['viewerRole'] !== 'GUEST' ||
    !isObj(r) ||
    !sameKeys(r, RECEIPT_KEYS) ||
    r['fiscalDocument'] !== 'OFF_PLATFORM' ||
    typeof tripId !== 'string' ||
    !UUID.test(tripId) ||
    typeof tripStatus !== 'string' ||
    !CODE.test(tripStatus) ||
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
  const source = r['source'];
  const totalPaidMinor = minorOf(r['totalPaidMinor']);
  const refundDueMinor = minorOf(r['refundMinor']);
  const tripFee = feeOf(r['tripFee']);
  if (
    (source !== 'CAPTURE' && source !== 'SETTLEMENT') ||
    totalPaidMinor === null ||
    refundDueMinor === null ||
    tripFee === undefined
  ) {
    return null;
  }
  return {
    tripId,
    tripStatus,
    currency,
    currencyExponent: exponent,
    timezone,
    source,
    totalPaidMinor,
    refundDueMinor,
    tripFee,
  };
}

/** Taux de taxe en pourcentage (700 ⇒ 7 ; 1050 ⇒ 10,5) : affichage seulement. */
export const taxPercentOf = (bps: number): number => bps / 100;
