/**
 * Données des routes de la remise et du retour (US-315, ADR-183) : sens dans l'URL, corps des
 * demandes. Lecture STRICTE : toute clé inattendue (dont une heure envoyée par le client : l'heure
 * serveur fait foi, L3-PM-09) ⇒ `REQUEST_INVALID` ; aucune valeur n'est devinée. Les bornes
 * métier (six points du permis, relevés) sont jugées par la base.
 */
import { HandoverHttpError } from './errors.js';

export type HandoverKind = 'CHECKIN' | 'CHECKOUT';
export type HandoverMethod = 'IN_PERSON' | 'CONTACTLESS';

/** Segment de l'URL (`checkin`, `checkout`) → sens ; sinon `null`. */
export function handoverKindOf(segment: string): HandoverKind | null {
  if (segment === 'checkin') return 'CHECKIN';
  if (segment === 'checkout') return 'CHECKOUT';
  return null;
}

type Body = Readonly<Record<string, unknown>>;

function only(body: Body, keys: readonly string[]): void {
  for (const k of Object.keys(body)) {
    if (!keys.includes(k)) throw new HandoverHttpError('REQUEST_INVALID');
  }
}

/** `POST …/checkin/open` : corps vide. */
export function parseOpenRequest(body: Body): void {
  only(body, []);
}

export const SUBREASONS = [
  'INVALID_LICENSE',
  'IDENTITY_NOT_VERIFIED',
  'OTHER_DRIVER_SENT',
] as const;
export type Subreason = (typeof SUBREASONS)[number];

export interface IdentityRequest {
  /** Cases cochées par l'hôte (forme jugée par la base : six booléens nommés, VER-015). */
  readonly checklist: Readonly<Record<string, unknown>>;
  readonly subreason: Subreason | null;
}

const KEY = /^[A-Za-z]{1,32}$/;

/** `POST …/checkin/identity` : `{ checklist, subreason? }`. */
export function parseIdentityRequest(body: Body): IdentityRequest {
  only(body, ['checklist', 'subreason']);
  const checklist = body['checklist'];
  const subreason = body['subreason'];
  if (
    checklist === null ||
    typeof checklist !== 'object' ||
    Array.isArray(checklist) ||
    Object.keys(checklist).length > 12 ||
    Object.keys(checklist).some((k) => !KEY.test(k))
  ) {
    throw new HandoverHttpError('REQUEST_INVALID');
  }
  if (
    subreason !== undefined &&
    subreason !== null &&
    !(SUBREASONS as readonly unknown[]).includes(subreason)
  ) {
    throw new HandoverHttpError('REQUEST_INVALID');
  }
  return {
    checklist: checklist as Readonly<Record<string, unknown>>,
    subreason: (subreason ?? null) as Subreason | null,
  };
}

export interface ValidateRequest {
  readonly odometerKm: number;
  readonly fuelEighths: number;
  readonly method: HandoverMethod;
  /**
   * US-703 (ADR-189) : langue du rappel du consentement MIT affiché au voyageur à la remise (S09) ;
   * `null` : absente (aucun rappel enregistré).
   */
  readonly locale: string | null;
}

const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;

const INT32 = 2_147_483_647;

/**
 * `POST …/{direction}/validate` : `{ odometerKm, fuelEighths, method }`, entiers ; un entier hors
 * de l'int32 de la base est rendu comme un relevé invalide (READING_INVALID), jamais tronqué.
 */
export function parseValidateRequest(body: Body): ValidateRequest {
  only(body, ['odometerKm', 'fuelEighths', 'method', 'locale']);
  const odometer = body['odometerKm'];
  const fuel = body['fuelEighths'];
  const method = body['method'];
  const locale = body['locale'];
  if (locale !== undefined && (typeof locale !== 'string' || !LOCALE.test(locale))) {
    throw new HandoverHttpError('REQUEST_INVALID');
  }
  if (
    typeof odometer !== 'number' ||
    !Number.isSafeInteger(odometer) ||
    typeof fuel !== 'number' ||
    !Number.isSafeInteger(fuel) ||
    (method !== 'IN_PERSON' && method !== 'CONTACTLESS')
  ) {
    throw new HandoverHttpError('REQUEST_INVALID');
  }
  if (Math.abs(odometer) > INT32 || Math.abs(fuel) > INT32) {
    throw new HandoverHttpError('READING_INVALID');
  }
  return { odometerKm: odometer, fuelEighths: fuel, method, locale: locale ?? null };
}
