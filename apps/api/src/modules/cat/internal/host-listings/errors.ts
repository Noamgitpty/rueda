/**
 * Réponses des routes de l'hôte `/host/accounts/{orgId}/…` et de la fiche publique `/listings/{id}`
 * (US-115) : code stable (16 A.8, sans préfixe de module) et clé du catalogue `@rueda/i18n`
 * (es, en, fr, pt) ; jamais de détail technique.
 *
 * Codes de 16 : `VEHICLE_PLATE_DUPLICATE`, `VEHICLE_FIELD_REQUIRED` (HST-011), `PHOTO_MIN_COUNT`,
 * `PHOTO_FORMAT` (HST-012), `PRICE_INVALID` (PRC-001), `MILEAGE_CONFIG_INVALID` (HST-033),
 * `HOST_NOT_ACTIVATED` (HST-005), `LISTING_TRANSITION_FORBIDDEN` (HST-026),
 * `REQUEST_MODE_NOT_ALLOWED` (17 §3.2.3), `CATALOG_VARIANT_NOT_FOUND`, `CATALOG_VARIANT_RETIRED`
 * (US-113) ; PROPOSÉS par US-115 (à reporter dans 16 A.8) : `HOST_ACCOUNT_NOT_FOUND`,
 * `HOST_ACCOUNT_SUSPENDED`, `LOCATION_NOT_FOUND`, `LOCATION_FIELD_INVALID`, `VEHICLE_NOT_FOUND`,
 * `LISTING_NOT_FOUND`, `LISTING_EXISTS`, `PHOTO_UPLOAD_UNAVAILABLE`, `LISTING_UNAVAILABLE`.
 *
 * IDOR (17 §2.3 point 5) : un compte d'hôte ou un objet d'un autre hôte rend 404, comme un
 * identifiant inconnu ; jamais 403 (rien n'est révélé de son existence).
 */
import { HttpException } from '@nestjs/common';

export const HOST_LISTING_MESSAGES = {
  LOCATION_CREATED: { status: 201, messageKey: 'common.listing.locationCreated' },
  VEHICLE_CREATED: { status: 201, messageKey: 'common.listing.vehicleCreated' },
  LISTING_CREATED: { status: 201, messageKey: 'common.listing.created' },
  LISTING_SAVED: { status: 200, messageKey: 'common.listing.saved' },
  LISTING_SUBMITTED: { status: 200, messageKey: 'common.listing.submitted' },
  LISTING_DELETED: { status: 200, messageKey: 'common.listing.deleted' },
  PHOTO_ADDED: { status: 201, messageKey: 'common.listing.photoAdded' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  HOST_ACCOUNT_SUSPENDED: { status: 403, messageKey: 'common.listing.hostSuspended' },
  HOST_ACCOUNT_NOT_FOUND: { status: 404, messageKey: 'common.listing.hostNotFound' },
  LOCATION_NOT_FOUND: { status: 404, messageKey: 'common.listing.locationNotFound' },
  VEHICLE_NOT_FOUND: { status: 404, messageKey: 'common.listing.vehicleNotFound' },
  LISTING_NOT_FOUND: { status: 404, messageKey: 'common.listing.notFound' },
  CATALOG_VARIANT_NOT_FOUND: { status: 404, messageKey: 'common.listing.variantNotFound' },
  VEHICLE_PLATE_DUPLICATE: { status: 409, messageKey: 'common.listing.plateDuplicate' },
  LISTING_EXISTS: { status: 409, messageKey: 'common.listing.exists' },
  LISTING_TRANSITION_FORBIDDEN: { status: 409, messageKey: 'common.listing.transitionForbidden' },
  CATALOG_VARIANT_RETIRED: { status: 409, messageKey: 'common.listing.variantRetired' },
  VEHICLE_FIELD_REQUIRED: { status: 422, messageKey: 'common.listing.vehicleFieldRequired' },
  LOCATION_FIELD_INVALID: { status: 422, messageKey: 'common.listing.locationFieldInvalid' },
  PRICE_INVALID: { status: 422, messageKey: 'common.listing.priceInvalid' },
  MILEAGE_CONFIG_INVALID: { status: 422, messageKey: 'common.listing.mileageInvalid' },
  REQUEST_MODE_NOT_ALLOWED: { status: 422, messageKey: 'common.listing.requestModeNotAllowed' },
  PHOTO_MIN_COUNT: { status: 422, messageKey: 'common.listing.photoMinCount' },
  PHOTO_FORMAT: { status: 422, messageKey: 'common.listing.photoFormat' },
  HOST_NOT_ACTIVATED: { status: 422, messageKey: 'common.listing.hostNotActivated' },
  LISTING_UNAVAILABLE: { status: 503, messageKey: 'common.listing.unavailable' },
  PHOTO_UPLOAD_UNAVAILABLE: { status: 503, messageKey: 'common.listing.photoUnavailable' },
} as const;

export type HostListingCode = keyof typeof HOST_LISTING_MESSAGES;

export interface HostListingBody {
  readonly code: HostListingCode;
  readonly messageKey: (typeof HOST_LISTING_MESSAGES)[HostListingCode]['messageKey'];
}

export function hostListingBody(code: HostListingCode): HostListingBody {
  return { code, messageKey: HOST_LISTING_MESSAGES[code].messageKey };
}

/** Champ refusé (UX-50) : `fields` porte les champs et leur raison, jamais leur valeur. */
export interface FieldDetail {
  readonly field: string;
  readonly reason: 'REQUIRED' | 'INVALID';
}

/** Erreur HTTP des routes de l'hôte : corps `{ code, messageKey[, fields] }`. */
export class HostListingHttpError extends HttpException {
  readonly code: HostListingCode;

  constructor(code: HostListingCode, fields?: readonly FieldDetail[]) {
    super(
      fields === undefined ? hostListingBody(code) : { ...hostListingBody(code), fields },
      HOST_LISTING_MESSAGES[code].status,
    );
    this.code = code;
  }
}

/** Issue d'une commande de la base → code HTTP (FORBIDDEN = compte d'un autre : 404, IDOR). */
export function outcomeCode(outcome: string): HostListingCode {
  if (outcome === 'FORBIDDEN') return 'HOST_ACCOUNT_NOT_FOUND';
  if (outcome === 'PARAM_MISSING') return 'LISTING_UNAVAILABLE';
  if (outcome in HOST_LISTING_MESSAGES) return outcome as HostListingCode;
  return 'LISTING_UNAVAILABLE';
}
