/**
 * Lecture des corps du checkout (US-208, ADR-133). Le client n'envoie JAMAIS de montant (L2-PM-03) :
 * seulement l'annonce et la période (devis), puis le conducteur, la case de la boîte manuelle et
 * les versions des documents affichés (checkout). Tout le reste est jugé par la base.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Instant UTC ISO 8601 (secondes et millisecondes facultatives). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
/** Pas des heures de remise et de retour (16 SRC-001, US-201 : à l'heure pile ou à la demie). */
const STEP_MS = 30 * 60_000;
const NAME_MAX = 100;
const DOCUMENTS_MAX = 5;
const KIND = /^[A-Z][A-Z_]{1,39}$/;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

function instantMs(value: unknown): number | null {
  if (typeof value !== 'string' || !INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isSafeInteger(ms) ? ms : null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface QuoteDemand {
  readonly listingId: string;
  readonly startAtMs: number;
  readonly endAtMs: number;
}

/** Demande de devis : annonce et période, au pas de 30 min, fin après le début ; sinon `null`. */
export function parseQuoteDemand(body: unknown): QuoteDemand | null {
  if (!isRecord(body) || !isUuid(body['listingId'])) return null;
  const startAtMs = instantMs(body['startAt']);
  const endAtMs = instantMs(body['endAt']);
  if (startAtMs === null || endAtMs === null || endAtMs <= startAtMs) return null;
  if (startAtMs % STEP_MS !== 0 || endAtMs % STEP_MS !== 0) return null;
  return { listingId: body['listingId'].toLowerCase(), startAtMs, endAtMs };
}

export interface AcceptedDocument {
  readonly kind: string;
  readonly version: number;
}

export interface CheckoutDemand {
  readonly driverFirstName: string;
  readonly driverLastName: string;
  /** Case « je sais conduire une boîte manuelle » (16 BKG-025) ; absente : non cochée. */
  readonly manualTransmissionConfirmed: boolean;
  /** Versions affichées et acceptées (16 BKG-008) ; absentes : aucune (TERMS_NOT_ACCEPTED). */
  readonly acceptedDocuments: readonly AcceptedDocument[];
}

const name = (value: unknown): string | null =>
  typeof value === 'string' && value.length <= NAME_MAX ? value : null;

/**
 * Demande de checkout : forme seulement (la base juge le nom, la case et les versions) ; corps
 * mal formé ⇒ `null`.
 */
export function parseCheckoutDemand(body: unknown): CheckoutDemand | null {
  if (!isRecord(body) || !isRecord(body['driver'])) return null;
  const first = name(body['driver']['firstName']);
  const last = name(body['driver']['lastName']);
  if (first === null || last === null) return null;
  const manual = body['manualTransmissionConfirmed'];
  if (manual !== undefined && typeof manual !== 'boolean') return null;
  const raw = body['acceptedDocuments'] ?? [];
  if (!Array.isArray(raw) || raw.length > DOCUMENTS_MAX) return null;
  const documents: AcceptedDocument[] = [];
  for (const d of raw as unknown[]) {
    if (!isRecord(d)) return null;
    const kind = d['kind'];
    const version = d['version'];
    if (typeof kind !== 'string' || !KIND.test(kind)) return null;
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return null;
    documents.push({ kind, version });
  }
  return {
    driverFirstName: first,
    driverLastName: last,
    manualTransmissionConfirmed: manual === true,
    acceptedDocuments: documents,
  };
}
