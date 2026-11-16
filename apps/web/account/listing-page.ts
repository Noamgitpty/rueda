/**
 * Fiche du véhicule S03 (US-204) côté SERVEUR du site : lecture défensive de la galerie, des notes
 * et de l'hôte vérifié de `GET /listings/{id}`, des dates choisies sur la fiche
 * (`GET /listings/{id}/availability`) et du lieu de remise exact du voyageur
 * (`GET /listings/{id}/meeting-point`). Toute réponse mal formée est refusée (`null`) : l'écran
 * affiche alors son état d'erreur, jamais une donnée partielle. Aucun montant n'est calculé ici
 * (le total TTC des dates vient de l'API, `slotPriceOf` de `checkout.ts`, US-208) ; aucune
 * constante de pays ni de fuseau.
 */
import type { MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';
import { codeOf } from './api-client.ts';
import { LOCAL_SLOT } from './search.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^listing\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[03]0$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Photos rendues au plus (borne de l'API, 0106). */
export const GALLERY_MAX = 50;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;
const one = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;

/** Photo de la galerie, dans l'ordre de l'hôte ; `src` : chemin du site (même origine). */
export interface GalleryPhotoView {
  readonly id: string;
  readonly src: string;
}

/** Note d'un sujet (16 REV-010) ; `averageX100` nul : aucun avis, badge « Nuevo ». */
export interface RatingView {
  readonly averageX100: number | null;
  readonly reviewCount: number;
  readonly tripCount: number;
}

export interface ListingExtrasView {
  readonly photos: readonly GalleryPhotoView[];
  readonly hostVerified: boolean;
  readonly vehicleRating: RatingView | null;
  readonly hostRating: RatingView | null;
}

/**
 * Chemin de la photo sur le site : `/media/listing/<annonce>/<photo>`, servi par la route du site
 * qui relaie le bucket public (`app/media/…`, CSP `img-src 'self'`) ; `null` si la clé est mal
 * formée ou d'une autre annonce.
 */
export function photoSrc(listingId: string, key: string): string | null {
  const m = KEY.exec(key);
  if (m === null || m[1] !== listingId || !UUID.test(m[1]) || !UUID.test(m[2] as string)) {
    return null;
  }
  return `/media/${key}`;
}

function ratingOf(v: unknown): RatingView | undefined {
  if (!isObj(v)) return undefined;
  const reviews = int(v['reviewCount']);
  const trips = int(v['tripCount']);
  const avg = v['averageX100'] === null ? null : int(v['averageX100']);
  if (reviews === null || reviews < 0 || trips === null || trips < 0) return undefined;
  if (v['averageX100'] !== null && (avg === null || avg < 100 || avg > 500)) return undefined;
  if ((avg === null) !== (reviews === 0)) return undefined;
  return { averageX100: avg, reviewCount: reviews, tripCount: trips };
}

/** Galerie, hôte vérifié et notes de `GET /listings/{id}` ; `null` si illisible. */
export function listingExtrasOf(reply: ApiResult): ListingExtrasView | null {
  if (reply.status !== 200 || !isObj(reply.json) || !isObj(reply.json['listing'])) return null;
  const l = reply.json['listing'];
  const id = str(l['id']);
  if (id === null || !UUID.test(id) || !Array.isArray(l['photos'])) return null;
  if (typeof l['hostVerified'] !== 'boolean') return null;
  if (l['photos'].length > GALLERY_MAX) return null;
  const photos: GalleryPhotoView[] = [];
  let last = -1;
  for (const p of l['photos']) {
    if (!isObj(p)) return null;
    const pid = str(p['id']);
    const order = int(p['order']);
    const key = str(p['key']);
    // ordre de l'hôte rendu par la base, strictement croissant : jamais retrié ici
    if (pid === null || !UUID.test(pid) || order === null || order <= last || key === null) {
      return null;
    }
    const src = photoSrc(id, key);
    if (src === null || !key.endsWith(pid)) return null;
    last = order;
    photos.push({ id: pid, src });
  }
  let vehicleRating: RatingView | null = null;
  let hostRating: RatingView | null = null;
  if (l['ratings'] !== null) {
    if (!isObj(l['ratings'])) return null;
    const v = ratingOf(l['ratings']['vehicle']);
    const h = ratingOf(l['ratings']['host']);
    if (v === undefined || h === undefined) return null;
    vehicleRating = v;
    hostRating = h;
  }
  return { photos, hostVerified: l['hostVerified'], vehicleRating, hostRating };
}

/** Note sur 5 affichée (une décimale), ou `undefined` sans avis (« Nuevo »). */
export function ratingValue(r: RatingView | null): number | undefined {
  return r === null || r.averageX100 === null ? undefined : r.averageX100 / 100;
}

/** Heures locales choisies sur la fiche (`AAAA-MM-JJTHH:MM`). */
export interface SlotInput {
  readonly start: string;
  readonly end: string;
}

/**
 * Dates de la fiche : `?start=&end=` (reprises de la recherche, US-201) ou les champs du
 * formulaire de la fiche (`startDate`, `startTime`, `endDate`, `endTime`). Rien de saisi : `null` ;
 * saisie mal formée ou fin ≤ début : `SEARCH_DATES_INVALID` (même règle que S01).
 */
export function slotInputOf(
  params: Readonly<Record<string, unknown>>,
):
  | { readonly ok: true; readonly input: SlotInput }
  | { readonly ok: false; readonly code: 'SEARCH_DATES_INVALID' }
  | null {
  const sd = one(params['startDate']);
  const st = one(params['startTime']);
  const ed = one(params['endDate']);
  const et = one(params['endTime']);
  let start: string | undefined;
  let end: string | undefined;
  if (sd !== undefined || st !== undefined || ed !== undefined || et !== undefined) {
    if (
      !DATE.test(sd ?? '') ||
      !TIME.test(st ?? '') ||
      !DATE.test(ed ?? '') ||
      !TIME.test(et ?? '')
    ) {
      return { ok: false, code: 'SEARCH_DATES_INVALID' };
    }
    start = `${sd as string}T${st as string}`;
    end = `${ed as string}T${et as string}`;
  } else {
    start = one(params['start']);
    end = one(params['end']);
    if (start === undefined && end === undefined) return null;
  }
  if (
    start === undefined ||
    end === undefined ||
    !LOCAL_SLOT.test(start) ||
    !LOCAL_SLOT.test(end)
  ) {
    return { ok: false, code: 'SEARCH_DATES_INVALID' };
  }
  if (end <= start) return { ok: false, code: 'SEARCH_DATES_INVALID' };
  return { ok: true, input: { start, end } };
}

/** Chemin de l'API pour des dates choisies sur la fiche. */
export function slotApiPath(listingId: string, input: SlotInput): string {
  return `/listings/${listingId}/availability?${new URLSearchParams({
    start: input.start,
    end: input.end,
  }).toString()}`;
}

const SLOT_KEYS: Readonly<Record<string, MessageKey>> = {
  SEARCH_DATES_INVALID: 'common.search.datesInvalid',
  SEARCH_DURATION_EXCEEDED: 'common.search.durationExceeded',
  DATES_UNAVAILABLE: 'common.listing.datesUnavailable',
  RATE_LIMITED: 'common.rateLimit.retryLater',
};

/** Issue des dates de la fiche, prête à afficher. */
export type SlotView =
  | { readonly kind: 'OK'; readonly startAt: string; readonly endAt: string }
  | { readonly kind: 'NOTICE'; readonly hours: number }
  | { readonly kind: 'REFUSED'; readonly key: MessageKey }
  | { readonly kind: 'ERROR' };

/** Lecture de `GET /listings/{id}/availability` ; réponse inconnue : erreur, jamais « libre ». */
export function slotViewOf(reply: ApiResult): SlotView {
  if (reply.status === 200) {
    const a =
      isObj(reply.json) && isObj(reply.json['availability']) ? reply.json['availability'] : null;
    const startAt = a === null ? null : str(a['startAt']);
    const endAt = a === null ? null : str(a['endAt']);
    if (startAt === null || endAt === null || !INSTANT.test(startAt) || !INSTANT.test(endAt)) {
      return { kind: 'ERROR' };
    }
    return { kind: 'OK', startAt, endAt };
  }
  const code = codeOf(reply);
  if (code === 'DATES_NOTICE_TOO_SHORT' && reply.status !== 'unavailable') {
    const values = isObj(reply.json) && isObj(reply.json['values']) ? reply.json['values'] : null;
    const hours = values === null ? null : int(values['noticeHours']);
    return hours === null || hours < 1 ? { kind: 'ERROR' } : { kind: 'NOTICE', hours };
  }
  const key = code === null ? undefined : SLOT_KEYS[code];
  return key === undefined ? { kind: 'ERROR' } : { kind: 'REFUSED', key };
}

/** Lieu de remise exact du voyageur d'un trip confirmé (16 LST-007). */
export interface MeetingPointView {
  readonly placeLabel: string;
  readonly addressLine: string;
  readonly city: string;
  readonly areaLabel: string | null;
}

/** Lecture de `GET /listings/{id}/meeting-point` ; tout autre statut : rien à montrer. */
export function meetingPointOf(reply: ApiResult): MeetingPointView | null {
  if (reply.status !== 200 || !isObj(reply.json) || !isObj(reply.json['meetingPoint'])) return null;
  const m = reply.json['meetingPoint'];
  const placeLabel = str(m['placeLabel']);
  const addressLine = str(m['addressLine']);
  const city = str(m['city']);
  const area = m['areaLabel'] === null ? null : str(m['areaLabel']);
  if (placeLabel === null || addressLine === null || city === null) return null;
  if (m['areaLabel'] !== null && area === null) return null;
  return { placeLabel, addressLine, city, areaLabel: area };
}
