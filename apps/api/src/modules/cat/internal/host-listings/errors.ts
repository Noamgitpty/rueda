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
 * `LISTING_NOT_FOUND`, `LISTING_EXISTS`, `PHOTO_UPLOAD_UNAVAILABLE`, `LISTING_UNAVAILABLE` ;
 * `TERMS_REACCEPT_REQUIRED` (16 LEG-001, 19 US-126) : CGU de l'hôte à accepter avant la soumission ;
 * `CATALOG_REQUEST_DUPLICATE` (16 ADM-036) et, PROPOSÉS par US-114 (ADR-104) :
 * `CATALOG_ADDITION_PENDING` (véhicule hors catalogue, annonce non publiable),
 * `CATALOG_ALREADY_LINKED` (véhicule déjà rattaché), `CATALOG_ADDITION_REJECTED` (dernière demande
 * refusée), `CATALOG_REQUEST_NOT_ALLOWED` (refus NOT_ELIGIBLE ou trois refus), `CATALOG_REQUEST_CREATED`.
 *
 * Calendrier de l'hôte (US-119, ADR-101) : `VEHICLE_UNAVAILABLE` (16 CAL-011, CAL-002 : créneau
 * pris, sans détail de l'occupation en cause), PROPOSÉS par US-119 : `BLOCK_CREATED`,
 * `BLOCK_REMOVED`, `NOTICE_SAVED`, `BLOCK_NOT_FOUND`, `VEHICLE_NOT_LISTED`, `INVALID_PERIOD` (code de
 * la base d'US-022), `NOTICE_INVALID`.
 *
 * Pièces et éligibilité du véhicule (US-124, ADR-107) : codes de 16 HST-019 / HST-039
 * (`VEHICLE_TOO_OLD`, `VEHICLE_MILEAGE_TOO_HIGH`, `VEHICLE_TITLE_MISMATCH`,
 * `VEHICLE_LENDER_CONSENT_REQUIRED`, `VEHICLE_DOCUMENT_REQUIRED`, `VEHICLE_DOCUMENT_EXPIRED`) ;
 * PROPOSÉS par US-124 : `VEHICLE_DECLARATION_SAVED`, `VEHICLE_DOCUMENT_ADDED`,
 * `VEHICLE_ELIGIBILITY_SUBMITTED`, `VEHICLE_UNDER_REVIEW`, `VEHICLE_INELIGIBLE`, `VEHICLE_RELEASED`,
 * `VEHICLE_ALREADY_ELIGIBLE`, `VEHICLE_DOCUMENT_INVALID`, `VEHICLE_DOCUMENT_UNAVAILABLE` ;
 * contestation (BOARD N-61) : `VEHICLE_CLAIM_OPENED`, `CLAIM_NOT_NEEDED`, `CLAIM_DUPLICATE`.
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
  CATALOG_REQUEST_CREATED: { status: 201, messageKey: 'common.catalogAddition.requested' },
  VEHICLE_DECLARATION_SAVED: { status: 200, messageKey: 'common.vehicleDocs.declarationSaved' },
  VEHICLE_DOCUMENT_ADDED: { status: 201, messageKey: 'common.vehicleDocs.documentAdded' },
  VEHICLE_ELIGIBILITY_SUBMITTED: { status: 200, messageKey: 'common.vehicleDocs.submitted' },
  // aucune pièce exigée : véhicule validé par les contrôles automatiques (décision du fondateur)
  VEHICLE_ELIGIBILITY_CONFIRMED: { status: 200, messageKey: 'common.vehicleDocs.confirmed' },
  VEHICLE_CLAIM_OPENED: { status: 201, messageKey: 'common.vehicleDocs.claimOpened' },
  BLOCK_CREATED: { status: 201, messageKey: 'common.calendar.blockCreated' },
  BLOCK_REMOVED: { status: 200, messageKey: 'common.calendar.blockRemoved' },
  NOTICE_SAVED: { status: 200, messageKey: 'common.calendar.noticeSaved' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  HOST_ACCOUNT_SUSPENDED: { status: 403, messageKey: 'common.listing.hostSuspended' },
  HOST_ACCOUNT_NOT_FOUND: { status: 404, messageKey: 'common.listing.hostNotFound' },
  LOCATION_NOT_FOUND: { status: 404, messageKey: 'common.listing.locationNotFound' },
  VEHICLE_NOT_FOUND: { status: 404, messageKey: 'common.listing.vehicleNotFound' },
  LISTING_NOT_FOUND: { status: 404, messageKey: 'common.listing.notFound' },
  BLOCK_NOT_FOUND: { status: 404, messageKey: 'common.calendar.blockNotFound' },
  CATALOG_VARIANT_NOT_FOUND: { status: 404, messageKey: 'common.listing.variantNotFound' },
  VEHICLE_PLATE_DUPLICATE: { status: 409, messageKey: 'common.listing.plateDuplicate' },
  LISTING_EXISTS: { status: 409, messageKey: 'common.listing.exists' },
  LISTING_TRANSITION_FORBIDDEN: { status: 409, messageKey: 'common.listing.transitionForbidden' },
  // CGU de l'hôte non acceptées dans leur version exigée (US-126) : l'annonce reste DRAFT
  TERMS_REACCEPT_REQUIRED: { status: 409, messageKey: 'common.listing.hostTermsRequired' },
  CATALOG_VARIANT_RETIRED: { status: 409, messageKey: 'common.listing.variantRetired' },
  // véhicule hors catalogue (US-114) : l'annonce reste DRAFT jusqu'à la décision de l'ops
  CATALOG_ADDITION_PENDING: { status: 409, messageKey: 'common.catalogAddition.pending' },
  CATALOG_REQUEST_DUPLICATE: { status: 409, messageKey: 'common.catalogAddition.duplicate' },
  CATALOG_ALREADY_LINKED: { status: 409, messageKey: 'common.catalogAddition.alreadyLinked' },
  // dernière demande refusée : l'hôte voit le motif (US-114, revue ux)
  CATALOG_ADDITION_REJECTED: { status: 409, messageKey: 'common.catalogAddition.rejected' },
  // véhicule non admis, ou trois refus : plus de nouvelle demande (US-114, PROPOSÉ)
  CATALOG_REQUEST_NOT_ALLOWED: { status: 409, messageKey: 'common.catalogAddition.notAllowed' },
  VEHICLE_UNAVAILABLE: { status: 409, messageKey: 'common.calendar.vehicleUnavailable' },
  // pièces et éligibilité du véhicule (US-124)
  VEHICLE_UNDER_REVIEW: { status: 409, messageKey: 'common.vehicleDocs.underReview' },
  VEHICLE_INELIGIBLE: { status: 409, messageKey: 'common.vehicleDocs.ineligible' },
  VEHICLE_RELEASED: { status: 409, messageKey: 'common.vehicleDocs.released' },
  VEHICLE_ALREADY_ELIGIBLE: { status: 409, messageKey: 'common.vehicleDocs.alreadyEligible' },
  CLAIM_NOT_NEEDED: { status: 409, messageKey: 'common.vehicleDocs.claimNotNeeded' },
  CLAIM_DUPLICATE: { status: 409, messageKey: 'common.vehicleDocs.claimDuplicate' },
  VEHICLE_NOT_LISTED: { status: 409, messageKey: 'common.calendar.notListed' },
  VEHICLE_FIELD_REQUIRED: { status: 422, messageKey: 'common.listing.vehicleFieldRequired' },
  LOCATION_FIELD_INVALID: { status: 422, messageKey: 'common.listing.locationFieldInvalid' },
  PRICE_INVALID: { status: 422, messageKey: 'common.listing.priceInvalid' },
  MILEAGE_CONFIG_INVALID: { status: 422, messageKey: 'common.listing.mileageInvalid' },
  REQUEST_MODE_NOT_ALLOWED: { status: 422, messageKey: 'common.listing.requestModeNotAllowed' },
  PHOTO_MIN_COUNT: { status: 422, messageKey: 'common.listing.photoMinCount' },
  PHOTO_FORMAT: { status: 422, messageKey: 'common.listing.photoFormat' },
  HOST_NOT_ACTIVATED: { status: 422, messageKey: 'common.listing.hostNotActivated' },
  INVALID_PERIOD: { status: 422, messageKey: 'common.calendar.invalidPeriod' },
  VEHICLE_TOO_OLD: { status: 422, messageKey: 'common.vehicleDocs.tooOld' },
  VEHICLE_MILEAGE_TOO_HIGH: { status: 422, messageKey: 'common.vehicleDocs.mileageTooHigh' },
  VEHICLE_TITLE_MISMATCH: { status: 422, messageKey: 'common.vehicleDocs.titleMismatch' },
  VEHICLE_LENDER_CONSENT_REQUIRED: {
    status: 422,
    messageKey: 'common.vehicleDocs.lenderConsentRequired',
  },
  VEHICLE_DOCUMENT_REQUIRED: { status: 422, messageKey: 'common.vehicleDocs.documentRequired' },
  VEHICLE_DOCUMENT_EXPIRED: { status: 422, messageKey: 'common.vehicleDocs.documentExpired' },
  VEHICLE_DOCUMENT_INVALID: { status: 422, messageKey: 'common.vehicleDocs.documentInvalid' },
  NOTICE_INVALID: { status: 422, messageKey: 'common.calendar.noticeInvalid' },
  LISTING_UNAVAILABLE: { status: 503, messageKey: 'common.listing.unavailable' },
  PHOTO_UPLOAD_UNAVAILABLE: { status: 503, messageKey: 'common.listing.photoUnavailable' },
  VEHICLE_DOCUMENT_UNAVAILABLE: { status: 503, messageKey: 'common.vehicleDocs.uploadUnavailable' },
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

/**
 * Erreur HTTP des routes de l'hôte : corps `{ code, messageKey[, fields][, reasons] }` (`reasons` :
 * tous les motifs d'un refus d'éligibilité, US-124).
 */
export class HostListingHttpError extends HttpException {
  readonly code: HostListingCode;

  constructor(code: HostListingCode, fields?: readonly FieldDetail[], reasons?: readonly string[]) {
    super(
      {
        ...hostListingBody(code),
        ...(fields === undefined ? {} : { fields }),
        ...(reasons === undefined ? {} : { reasons }),
      },
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
