/**
 * Modèle et validation des pièces et de l'éligibilité du véhicule (US-124 ; 16 HST-019, HST-039 ;
 * 08 BR-LIST-01 à 03 ; ADR-107). Fonctions pures : la base revérifie tout et décide seule des règles
 * (âge, compteur, catalogue, titre, prenda, pièces exigées par le pays).
 */
import { CATALOG_LANGUAGES, CATALOG_VERSION, CATALOGS } from '@rueda/i18n';
import type { CatalogLanguage } from '@rueda/i18n';
import { FieldValidationError, isUuid } from '../host-listings/model.js';
import type { FieldProblem } from '../host-listings/model.js';

export const DOCUMENT_TYPES = [
  'TITLE',
  'OWNER_AUTHORIZATION',
  'PLATE_VIN_PHOTO',
  'INSPECTION',
  'LENDER_CONSENT',
  'COMPULSORY_INSURANCE',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const TITLE_HOLDERS = ['HOST', 'THIRD_PARTY'] as const;
export type TitleHolder = (typeof TITLE_HOLDERS)[number];

export type DocumentStatus = 'SUBMITTED' | 'VALID' | 'REJECTED';
export type EligibilityStatus = 'ELIGIBLE' | 'INELIGIBLE' | 'PENDING';

export interface DeclarationInput {
  readonly titleHolder: TitleHolder;
  readonly lienDeclared: boolean;
  readonly odometerKm: number;
  /** « Je suis propriétaire ou autorisé par le propriétaire » (engagement horodaté par la base). */
  readonly ownershipAttested: boolean;
  /** « Le véhicule n'est pas gagé, ou j'ai l'accord écrit du créancier ». */
  readonly lienAttested: boolean;
  /**
   * Numéro de châssis saisi s'il manquait : VIN ISO 3779 ou numéro non ISO (la base le normalise,
   * juge son format et le refuse s'il est pris ; ADR-113).
   */
  readonly vin: string | null;
  /** Langue du catalogue de l'écran où l'hôte a coché ses engagements (défaut : es, qui fait foi). */
  readonly locale: CatalogLanguage;
}

/** Libellé des engagements tel qu'affiché à l'hôte : historisé par la base (ADR-113). */
export interface AttestationWording {
  readonly locale: CatalogLanguage;
  readonly catalogVersion: number;
  readonly ownership: string;
  readonly lien: string;
}

/**
 * Libellé exact des deux engagements dans la langue de l'écran, tiré du catalogue servi par
 * `@rueda/i18n` (même paquet que le site), avec la version du catalogue.
 */
export function attestationWording(locale: CatalogLanguage): AttestationWording {
  const messages = CATALOGS[locale].messages;
  const text = (
    key: 'web.vehicleDocs.declaration.owner' | 'web.vehicleDocs.declaration.lienOk',
  ) => {
    const m = messages[key];
    return typeof m === 'string' ? m : m.other;
  };
  return {
    locale,
    catalogVersion: CATALOG_VERSION,
    ownership: text('web.vehicleDocs.declaration.owner'),
    lien: text('web.vehicleDocs.declaration.lienOk'),
  };
}

const LOCALE_TAG = /^[a-z]{2}(-[A-Z]{2})?$/;

/** Langue du catalogue d'une étiquette de locale (`pt`, `es-PY`) ; hors catalogue : null. */
export function catalogLanguageOf(tag: string): CatalogLanguage | null {
  if (!LOCALE_TAG.test(tag)) return null;
  const language = tag.slice(0, 2);
  return (CATALOG_LANGUAGES as readonly string[]).includes(language)
    ? (language as CatalogLanguage)
    : null;
}

export interface DocumentUploadInput {
  /** Identifiant du dépôt (idempotence) = identifiant du fichier et de la pièce. */
  readonly requestId: string;
  readonly type: DocumentType;
  readonly validUntil: string | null;
  readonly content: Buffer;
}

export interface ClaimInput {
  readonly requestId: string;
  readonly plate: string;
  readonly vin: string | null;
  readonly content: Buffer;
}

const DATE = /^(19[5-9][0-9]|20[0-9][0-9]|2100)-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Date du calendrier (AAAA-MM-JJ) qui existe vraiment (31 février refusé). */
export function isCalendarDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function unknownKeys(body: Record<string, unknown>, allowed: readonly string[], p: FieldProblem[]) {
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) p.push({ field: k, reason: 'INVALID' });
  }
}

function content(body: Record<string, unknown>, p: FieldProblem[]): Buffer | null {
  const v = body['dataBase64'];
  if (typeof v !== 'string' || v.length === 0) {
    p.push({ field: 'dataBase64', reason: 'REQUIRED' });
    return null;
  }
  if (!BASE64.test(v)) {
    p.push({ field: 'dataBase64', reason: 'INVALID' });
    return null;
  }
  return Buffer.from(v, 'base64');
}

export function parseDeclaration(body: Record<string, unknown>): DeclarationInput {
  const p: FieldProblem[] = [];
  unknownKeys(
    body,
    [
      'titleHolder',
      'lienDeclared',
      'odometerKm',
      'ownershipAttested',
      'lienAttested',
      'vin',
      'locale',
    ],
    p,
  );
  const rawLocale = body['locale'];
  const locale =
    rawLocale === undefined || rawLocale === null
      ? 'es'
      : typeof rawLocale === 'string'
        ? catalogLanguageOf(rawLocale)
        : null;
  if (locale === null) p.push({ field: 'locale', reason: 'INVALID' });
  for (const k of ['ownershipAttested', 'lienAttested'] as const) {
    const v = body[k];
    if (v !== undefined && typeof v !== 'boolean') p.push({ field: k, reason: 'INVALID' });
  }
  const vin = body['vin'];
  if (
    vin !== undefined &&
    vin !== null &&
    (typeof vin !== 'string' || !/^[A-Za-z0-9 -]{5,40}$/.test(vin))
  ) {
    p.push({ field: 'vin', reason: 'INVALID' });
  }
  const holder = body['titleHolder'];
  if (typeof holder !== 'string' || !(TITLE_HOLDERS as readonly string[]).includes(holder)) {
    p.push({ field: 'titleHolder', reason: holder === undefined ? 'REQUIRED' : 'INVALID' });
  }
  const lien = body['lienDeclared'];
  if (typeof lien !== 'boolean') {
    p.push({ field: 'lienDeclared', reason: lien === undefined ? 'REQUIRED' : 'INVALID' });
  }
  const km = body['odometerKm'];
  if (typeof km !== 'number' || !Number.isSafeInteger(km) || km < 0 || km > 3_000_000) {
    p.push({
      field: 'odometerKm',
      reason: km === undefined || km === null ? 'REQUIRED' : 'INVALID',
    });
  }
  if (p.length > 0) throw new FieldValidationError(p);
  return {
    titleHolder: holder as TitleHolder,
    lienDeclared: lien as boolean,
    odometerKm: km as number,
    ownershipAttested: body['ownershipAttested'] === true,
    lienAttested: body['lienAttested'] === true,
    vin: typeof vin === 'string' ? vin : null,
    locale: locale ?? 'es',
  };
}

export function parseDocumentUpload(body: Record<string, unknown>): DocumentUploadInput {
  const p: FieldProblem[] = [];
  unknownKeys(body, ['requestId', 'type', 'validUntil', 'dataBase64'], p);
  const requestId = body['requestId'];
  if (!isUuid(requestId)) {
    p.push({ field: 'requestId', reason: requestId === undefined ? 'REQUIRED' : 'INVALID' });
  }
  const type = body['type'];
  if (typeof type !== 'string' || !(DOCUMENT_TYPES as readonly string[]).includes(type)) {
    p.push({ field: 'type', reason: type === undefined ? 'REQUIRED' : 'INVALID' });
  }
  const until = body['validUntil'];
  if (
    until !== undefined &&
    until !== null &&
    (typeof until !== 'string' || !isCalendarDate(until))
  ) {
    p.push({ field: 'validUntil', reason: 'INVALID' });
  }
  const data = content(body, p);
  if (p.length > 0 || data === null) throw new FieldValidationError(p);
  return {
    requestId: (requestId as string).toLowerCase(),
    type: type as DocumentType,
    validUntil: typeof until === 'string' ? until : null,
    content: data,
  };
}

export function parseClaim(body: Record<string, unknown>): ClaimInput {
  const p: FieldProblem[] = [];
  unknownKeys(body, ['requestId', 'plate', 'vin', 'dataBase64'], p);
  const requestId = body['requestId'];
  if (!isUuid(requestId)) {
    p.push({ field: 'requestId', reason: requestId === undefined ? 'REQUIRED' : 'INVALID' });
  }
  const plate = body['plate'];
  if (typeof plate !== 'string' || !/^[A-Za-z0-9 .-]{2,24}$/.test(plate)) {
    p.push({ field: 'plate', reason: plate === undefined ? 'REQUIRED' : 'INVALID' });
  }
  const vin = body['vin'];
  if (
    vin !== undefined &&
    vin !== null &&
    (typeof vin !== 'string' || !/^[A-Za-z0-9 -]{5,40}$/.test(vin))
  ) {
    p.push({ field: 'vin', reason: 'INVALID' });
  }
  const data = content(body, p);
  if (p.length > 0 || data === null) throw new FieldValidationError(p);
  return {
    requestId: (requestId as string).toLowerCase(),
    plate: plate as string,
    vin: typeof vin === 'string' ? vin : null,
    content: data,
  };
}
