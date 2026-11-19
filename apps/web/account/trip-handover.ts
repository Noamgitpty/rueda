/**
 * Remise et retour du véhicule entre particuliers côté site (US-315, ADR-183 ; 16 TRP-002,
 * VER-015, TRP-033 ; 10b A03, A04, S09, UX-41, UX-42) : lecture DÉFENSIVE de
 * `GET /trips/{id}/handover/{direction}` (toute forme inattendue ⇒ `null`, l'écran dit l'erreur,
 * jamais une étape partielle) et gardes des saisies (compteur, carburant, contrôle du permis).
 * Le site n'envoie jamais d'heure : l'heure serveur fait foi. Jamais de donnée personnelle dans
 * une URL ni dans un journal.
 */
import type { MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';
import { messageKeyOf } from './host-listings.ts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type HandoverDirection = 'checkin' | 'checkout';
export type HandoverRole = 'HOST' | 'GUEST';
export type PhotoSeriesStatus = 'NONE' | 'DRAFT' | 'SUBMITTED';

/** Blocages de la remise, dans l'ordre de l'API (16 TRP-002, L3-PM-08). */
export const BLOCKERS = [
  'CHECKIN_PAYMENT_NOT_CONFIRMED',
  'CONTRACT_NOT_SIGNED',
  'DEPOSIT_NOT_READY',
  'INSURER_CONTRACT_INACTIVE',
  'HANDOVER_BLOCKED',
] as const;
export type HandoverBlocker = (typeof BLOCKERS)[number];

/** Les 6 points vérifiables du permis physique (16 VER-015 ; 10b UX-37, `web.a03.check.*`). */
export const CHECKLIST = [
  'face',
  'name',
  'birthYear',
  'valid',
  'provisional',
  'restrictions',
] as const;
export type ChecklistPoint = (typeof CHECKLIST)[number];

/** Motifs d'un permis non conforme (17 §3.2.2 `failure_subreason`). */
export const SUBREASONS = [
  'INVALID_LICENSE',
  'IDENTITY_NOT_VERIFIED',
  'OTHER_DRIVER_SENT',
] as const;
export type Subreason = (typeof SUBREASONS)[number];

/** Bornes des relevés (contrôlées aussi par l'API et la base). */
export const ODOMETER_MAX_KM = 9_999_999;
export const FUEL_MAX_EIGHTHS = 8;

export interface HandoverValidationView {
  readonly validatedAt: string;
  readonly odometerKm: number;
  readonly fuelEighths: number;
}

export interface TripHandoverView {
  readonly tripId: string;
  readonly direction: HandoverDirection;
  readonly viewerRole: HandoverRole;
  readonly tripStatus: string;
  /** Fuseau IANA du trip (heure serveur affichée). */
  readonly timezone: string;
  readonly opensAt: string | null;
  readonly open: boolean;
  readonly canOpen: boolean;
  readonly blockers: readonly HandoverBlocker[];
  readonly identityCheck: {
    readonly status: 'PENDING' | 'OK' | 'FAILED';
    readonly checkedAt: string | null;
  } | null;
  /** Ce que l'hôte compare au permis physique : rien d'autre (jamais numéro ni image). */
  readonly guest: {
    readonly firstName: string | null;
    readonly lastInitial: string | null;
    readonly birthYear: number | null;
  } | null;
  readonly photos: { readonly mine: PhotoSeriesStatus; readonly other: PhotoSeriesStatus };
  readonly validations: {
    readonly mine: HandoverValidationView | null;
    readonly other: HandoverValidationView | null;
  };
  readonly contactlessOffered: boolean;
  readonly completedAt: string | null;
}

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const isTimeOrNull = (v: unknown): v is string | null => v === null || isTime(v);
const STATUS = /^[A-Z][A-Z_]{1,31}$/;
const SERIES: readonly unknown[] = ['NONE', 'DRAFT', 'SUBMITTED'];

export function directionOf(raw: string): HandoverDirection | null {
  return raw === 'checkin' || raw === 'checkout' ? raw : null;
}

/** Relevé du compteur : entier de 0 à 9 999 999 km. */
export function isOdometer(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= ODOMETER_MAX_KM;
}

/** Niveau de carburant en huitièmes : entier de 0 à 8. */
export function isFuel(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= FUEL_MAX_EIGHTHS;
}

/** Saisie d'un formulaire → entier borné, sinon `null` (aucune valeur devinée). */
export function intField(raw: string, check: (v: unknown) => v is number): number | null {
  if (!/^[0-9]{1,7}$/.test(raw)) return null;
  const v = Number(raw);
  return check(v) ? v : null;
}

function validationOf(v: unknown): HandoverValidationView | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || !isTime(v['validatedAt']) || !isOdometer(v['odometerKm'])) return undefined;
  if (!isFuel(v['fuelEighths'])) return undefined;
  return {
    validatedAt: v['validatedAt'],
    odometerKm: v['odometerKm'],
    fuelEighths: v['fuelEighths'],
  };
}

function guestOf(v: unknown): TripHandoverView['guest'] | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  const first = v['firstName'];
  const initial = v['lastInitial'];
  const year = v['birthYear'];
  if (first !== null && (typeof first !== 'string' || first.length === 0 || first.length > 100)) {
    return undefined;
  }
  if (initial !== null && (typeof initial !== 'string' || [...initial].length !== 1)) {
    return undefined;
  }
  if (year !== null && (typeof year !== 'number' || !Number.isSafeInteger(year) || year < 1900)) {
    return undefined;
  }
  return { firstName: first, lastInitial: initial, birthYear: year };
}

/** Vue d'une réponse 200 de `GET /trips/{id}/handover/{direction}`, sinon `null`. */
export function tripHandoverOf(reply: ApiResult): TripHandoverView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const role = j['viewerRole'];
  const direction = typeof j['direction'] === 'string' ? directionOf(j['direction']) : null;
  const photos = j['photos'];
  const validations = j['validations'];
  const identity = j['identityCheck'];
  if (
    typeof j['tripId'] !== 'string' ||
    !UUID.test(j['tripId']) ||
    direction === null ||
    (role !== 'HOST' && role !== 'GUEST') ||
    typeof j['tripStatus'] !== 'string' ||
    !STATUS.test(j['tripStatus']) ||
    typeof j['timezone'] !== 'string' ||
    j['timezone'].length === 0 ||
    !isTimeOrNull(j['opensAt']) ||
    typeof j['open'] !== 'boolean' ||
    typeof j['canOpen'] !== 'boolean' ||
    !Array.isArray(j['blockers']) ||
    !isObj(photos) ||
    !SERIES.includes(photos['mine']) ||
    !SERIES.includes(photos['other']) ||
    !isObj(validations) ||
    typeof j['contactlessOffered'] !== 'boolean' ||
    !isTimeOrNull(j['completedAt'])
  ) {
    return null;
  }
  const blockers: HandoverBlocker[] = [];
  for (const b of j['blockers'] as unknown[]) {
    if (!(BLOCKERS as readonly unknown[]).includes(b)) return null;
    blockers.push(b as HandoverBlocker);
  }
  let identityCheck: TripHandoverView['identityCheck'] = null;
  if (identity !== null) {
    if (
      !isObj(identity) ||
      (identity['status'] !== 'PENDING' &&
        identity['status'] !== 'OK' &&
        identity['status'] !== 'FAILED') ||
      !isTimeOrNull(identity['checkedAt'])
    ) {
      return null;
    }
    identityCheck = { status: identity['status'], checkedAt: identity['checkedAt'] };
  }
  const guest = guestOf(j['guest']);
  const mine = validationOf(validations['mine']);
  const other = validationOf(validations['other']);
  if (guest === undefined || mine === undefined || other === undefined) return null;
  // minimisation : les données du voyageur ne sont servies qu'à l'hôte, au départ
  if (guest !== null && (role !== 'HOST' || direction !== 'checkin')) return null;
  return {
    tripId: j['tripId'],
    direction,
    viewerRole: role,
    tripStatus: j['tripStatus'],
    timezone: j['timezone'],
    opensAt: j['opensAt'] as string | null,
    open: j['open'],
    canOpen: j['canOpen'],
    blockers,
    identityCheck,
    guest,
    photos: {
      mine: photos['mine'] as PhotoSeriesStatus,
      other: photos['other'] as PhotoSeriesStatus,
    },
    validations: { mine, other },
    contactlessOffered: j['contactlessOffered'],
    completedAt: j['completedAt'] as string | null,
  };
}

/**
 * Corps de `POST …/checkin/identity` depuis les cases cochées : chaque point absent vaut
 * « non conforme » ; un motif n'est envoyé que si un point manque (refus), sinon jamais.
 */
export function identityBody(
  checked: ReadonlySet<string>,
  subreason: string | null,
): { checklist: Record<ChecklistPoint, boolean>; subreason?: Subreason } | null {
  const checklist = Object.fromEntries(CHECKLIST.map((p) => [p, checked.has(p)])) as Record<
    ChecklistPoint,
    boolean
  >;
  const complete = CHECKLIST.every((p) => checklist[p]);
  if (complete) return subreason === null ? { checklist } : null;
  if (subreason === null || !(SUBREASONS as readonly string[]).includes(subreason)) return null;
  return { checklist, subreason: subreason as Subreason };
}

/** Lien de l'écran des photos de la même étape (US-303). */
export function photosHref(
  role: HandoverRole,
  tripId: string,
  direction: HandoverDirection,
  org: string | null,
): string {
  return role === 'HOST'
    ? `/host/trips/${tripId}/inspection/${direction}${org === null ? '' : `?org=${org}`}`
    : `/trips/${tripId}/inspection/${direction}`;
}

/** Page de l'étape, reconstruite (jamais une adresse reçue d'un formulaire). */
export function handoverHref(
  role: string,
  tripId: string,
  direction: HandoverDirection,
  org: string,
): string {
  return role === 'HOST'
    ? `/host/trips/${tripId}/handover/${direction}${UUID.test(org) ? `?org=${org}` : ''}`
    : `/trips/${tripId}/handover/${direction}`;
}

/** Clé du refus d'une réponse de l'API ; sans réseau : « réessayer » (aucune file, L3-PM-14). */
export function handoverFailureKey(reply: ApiResult): MessageKey {
  if (reply.status === 'unavailable') return 'common.handover.unavailable';
  return messageKeyOf(reply) ?? 'common.error.server';
}
