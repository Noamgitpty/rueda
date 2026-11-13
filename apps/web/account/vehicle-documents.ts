/**
 * Lecture défensive des réponses de l'API des pièces et de l'éligibilité du véhicule (US-124,
 * ADR-107), côté SERVEUR du site seulement. Toute réponse mal formée est refusée (`null`) : l'écran
 * affiche alors son état d'erreur, jamais une donnée partielle. Aucune pièce n'est jamais servie à
 * l'hôte : seuls le type, le statut, la date de fin et le motif d'un refus sont lus.
 */
import type { MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export const DOCUMENT_TYPES = [
  'TITLE',
  'OWNER_AUTHORIZATION',
  'PLATE_VIN_PHOTO',
  'INSPECTION',
  'LENDER_CONSENT',
  'COMPULSORY_INSURANCE',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
const TYPES = new Set<string>(DOCUMENT_TYPES);
const DOC_STATUSES = new Set(['SUBMITTED', 'VALID', 'REJECTED']);
const STATUSES = new Set(['ELIGIBLE', 'PENDING', 'INELIGIBLE']);
const REJECTS = new Set([
  'ILLEGIBLE',
  'EXPIRED',
  'MISMATCH',
  'WRONG_DOCUMENT',
  'SUSPECTED_FORGERY',
]);
const CODE = /^[A-Z][A-Z_]{1,63}$/;

/** Motifs connus de l'écran (16 HST-019 ; ADR-107) ; tout autre motif : message générique. */
const REASONS = new Set([
  'CATALOG_ADDITION_PENDING',
  'VEHICLE_TOO_OLD',
  'VEHICLE_MILEAGE_TOO_HIGH',
  'VEHICLE_FIELD_REQUIRED',
  'VEHICLE_TITLE_MISMATCH',
  'VEHICLE_LENDER_CONSENT_REQUIRED',
  'VEHICLE_DOCUMENT_REQUIRED',
  'VEHICLE_DOCUMENT_EXPIRED',
  'VEHICLE_PLATE_MISMATCH',
  'VEHICLE_VIN_MISMATCH',
  'VEHICLE_INSPECTION_INVALID',
  'VEHICLE_DOCUMENT_REJECTED',
  'VEHICLE_TITLE_FORBIDDEN',
  'VEHICLE_REGISTRY_FLAGGED',
  'VEHICLE_RELEASED',
]);

/** Clé du catalogue du motif d'un refus (jamais le code brut à l'écran). */
export function reasonKey(code: string): MessageKey {
  return (
    REASONS.has(code) ? `web.vehicleDocs.reason.${code}` : 'web.vehicleDocs.reason.other'
  ) as MessageKey;
}

export interface DocumentView {
  readonly documentId: string;
  readonly type: DocumentType;
  readonly status: 'SUBMITTED' | 'VALID' | 'REJECTED';
  readonly validUntil: string | null;
  readonly rejectReason: string | null;
}

export interface EligibilityView {
  readonly vehicleId: string;
  readonly status: 'ELIGIBLE' | 'PENDING' | 'INELIGIBLE';
  readonly titleHolder: 'HOST' | 'THIRD_PARTY' | null;
  readonly lienDeclared: boolean;
  readonly odometerKm: number | null;
  /** Engagements de l'hôte (« jamais plus lourd que Turo » : ils tiennent lieu de pièces). */
  readonly ownershipAttested: boolean;
  readonly lienAttested: boolean;
  readonly hasVin: boolean;
  readonly reasons: readonly string[];
  readonly released: boolean;
  readonly publishable: boolean;
  readonly underReview: boolean;
  readonly requiredDocuments: readonly DocumentType[];
  readonly documents: readonly DocumentView[];
}

export interface DocumentUploadsView {
  readonly open: boolean;
  readonly maxBytes: number;
}

function documentOf(d: unknown): DocumentView | null {
  if (!isObj(d)) return null;
  const until = d['validUntil'];
  const reason = d['rejectReason'];
  if (
    typeof d['documentId'] !== 'string' ||
    !UUID.test(d['documentId']) ||
    !TYPES.has(String(d['type'])) ||
    !DOC_STATUSES.has(String(d['status'])) ||
    (until !== null && (typeof until !== 'string' || !DAY.test(until.slice(0, 10)))) ||
    (reason !== null && !REJECTS.has(String(reason)))
  ) {
    return null;
  }
  return {
    documentId: d['documentId'],
    type: d['type'] as DocumentType,
    status: d['status'] as DocumentView['status'],
    validUntil: typeof until === 'string' ? until.slice(0, 10) : null,
    rejectReason: typeof reason === 'string' ? reason : null,
  };
}

/** Éligibilité des véhicules et dépôt des pièces ; `null` si la réponse est illisible. */
export function eligibilityOf(
  reply: ApiResult,
): { vehicles: EligibilityView[]; uploads: DocumentUploadsView } | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const list = reply.json['vehicles'];
  const up = reply.json['documentUploads'];
  if (!Array.isArray(list) || !isObj(up)) return null;
  if (typeof up['open'] !== 'boolean' || !Number.isSafeInteger(up['maxBytes'])) return null;
  const vehicles: EligibilityView[] = [];
  for (const v of list) {
    if (!isObj(v) || typeof v['vehicleId'] !== 'string' || !UUID.test(v['vehicleId'])) return null;
    if (!STATUSES.has(String(v['eligibilityStatus']))) return null;
    const holder = v['titleHolder'];
    if (holder !== null && holder !== 'HOST' && holder !== 'THIRD_PARTY') return null;
    const reasons = v['reasons'];
    const required = v['requiredDocuments'];
    const docs = v['documents'];
    if (!Array.isArray(reasons) || reasons.some((r) => typeof r !== 'string' || !CODE.test(r))) {
      return null;
    }
    if (!Array.isArray(required) || required.some((r) => !TYPES.has(String(r)))) return null;
    if (!Array.isArray(docs)) return null;
    const documents = docs.map(documentOf);
    if (documents.some((d) => d === null)) return null;
    const km = v['odometerKm'];
    vehicles.push({
      vehicleId: v['vehicleId'],
      status: v['eligibilityStatus'] as EligibilityView['status'],
      titleHolder: holder,
      lienDeclared: v['lienDeclared'] === true,
      odometerKm: typeof km === 'number' && Number.isSafeInteger(km) ? km : null,
      ownershipAttested: v['ownershipAttested'] === true,
      lienAttested: v['lienAttested'] === true,
      hasVin: v['hasVin'] === true,
      reasons: reasons as string[],
      released: v['released'] === true,
      publishable: v['publishable'] === true,
      underReview: v['underReview'] === true,
      requiredDocuments: required as DocumentType[],
      documents: documents as DocumentView[],
    });
  }
  return { vehicles, uploads: { open: up['open'], maxBytes: up['maxBytes'] as number } };
}

export interface ClaimView {
  readonly claimId: string;
  readonly plate: string;
  readonly status: 'OPEN' | 'UPHELD' | 'DISMISSED';
}

/** Contestations du compte ; `null` si la réponse est illisible. */
export function claimsOf(reply: ApiResult): ClaimView[] | null {
  if (reply.status !== 200 || !isObj(reply.json) || !Array.isArray(reply.json['claims']))
    return null;
  const out: ClaimView[] = [];
  for (const c of reply.json['claims']) {
    if (
      !isObj(c) ||
      typeof c['claimId'] !== 'string' ||
      !UUID.test(c['claimId']) ||
      typeof c['plate'] !== 'string' ||
      !['OPEN', 'UPHELD', 'DISMISSED'].includes(String(c['status']))
    ) {
      return null;
    }
    out.push({
      claimId: c['claimId'],
      plate: c['plate'],
      status: c['status'] as ClaimView['status'],
    });
  }
  return out;
}

/** Motifs d'un refus de soumission (`reasons` du corps d'erreur) ; vide si absents ou illisibles. */
export function reasonsOf(reply: ApiResult): string[] {
  if (reply.status === 'unavailable' || !isObj(reply.json)) return [];
  const reasons = reply.json['reasons'];
  if (!Array.isArray(reasons)) return [];
  return (reasons as unknown[]).filter((r): r is string => typeof r === 'string' && CODE.test(r));
}
