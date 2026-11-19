/**
 * Réponses des routes des photos d'état du véhicule `/trips/{tripId}/inspections/{kind}` (US-303,
 * ADR-179) : code stable (16 A.8, sans préfixe de module) et clé du catalogue `@rueda/i18n` (es,
 * en, fr, pt) ; jamais de détail technique.
 *
 * Codes de 16 TRP-004 : `PHOTO_TEMPLATE_INCOMPLETE` (avec `missing`, les angles obligatoires
 * manquants), `PHOTO_GALLERY_FORBIDDEN` ; `REQUEST_INVALID`, `AUTH_REQUIRED` (US-010). PROPOSÉS (à
 * reporter dans 16 A.8) : `INSPECTION_NOT_FOUND` (trip inconnu, d'une autre personne, type ou
 * identifiant mal formé : même réponse), `INSPECTION_NOT_OPEN` (hors de la fenêtre de la série),
 * `INSPECTION_SUBMITTED` (série déjà validée), `PHOTO_LIMIT_REACHED` (100 photos par série),
 * `PHOTO_INVALID` (type réel, taille, dimensions, empreinte de transport ou antivirus),
 * `PHOTO_UPLOAD_UNAVAILABLE` (antivirus, coffre ou stockage indisponibles : rien n'est reçu),
 * `INSPECTION_UNAVAILABLE` (base indisponible ou bornes du pays absentes).
 */
import { HttpException } from '@nestjs/common';

export const INSPECTION_MESSAGES = {
  INSPECTION_NOT_FOUND: { status: 404, messageKey: 'common.inspection.notFound' },
  INSPECTION_NOT_OPEN: { status: 409, messageKey: 'common.inspection.notOpen' },
  INSPECTION_SUBMITTED: { status: 409, messageKey: 'common.inspection.submitted' },
  PHOTO_LIMIT_REACHED: { status: 409, messageKey: 'common.inspection.limitReached' },
  PHOTO_TEMPLATE_INCOMPLETE: { status: 422, messageKey: 'common.inspection.templateIncomplete' },
  PHOTO_GALLERY_FORBIDDEN: { status: 422, messageKey: 'common.inspection.galleryForbidden' },
  PHOTO_INVALID: { status: 422, messageKey: 'common.inspection.photoInvalid' },
  PHOTO_UPLOAD_UNAVAILABLE: { status: 503, messageKey: 'common.inspection.uploadUnavailable' },
  INSPECTION_UNAVAILABLE: { status: 503, messageKey: 'common.inspection.unavailable' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
} as const;

export type InspectionCode = keyof typeof INSPECTION_MESSAGES;

/** Erreur HTTP des routes des photos : corps `{ code, messageKey }` (et `missing` si incomplet). */
export class InspectionHttpError extends HttpException {
  readonly code: InspectionCode;

  constructor(code: InspectionCode, missing?: readonly string[]) {
    super(
      {
        code,
        messageKey: INSPECTION_MESSAGES[code].messageKey,
        ...(missing !== undefined ? { missing } : {}),
      },
      INSPECTION_MESSAGES[code].status,
    );
    this.code = code;
  }
}

/** Issue de la base → code HTTP ; toute issue inconnue : indisponible (fail-closed). */
export function outcomeCode(outcome: string): InspectionCode {
  switch (outcome) {
    case 'NOT_FOUND':
      return 'INSPECTION_NOT_FOUND';
    case 'INSPECTION_NOT_OPEN':
    case 'INSPECTION_SUBMITTED':
    case 'PHOTO_LIMIT_REACHED':
    case 'PHOTO_GALLERY_FORBIDDEN':
    case 'PHOTO_INVALID':
    case 'PHOTO_TEMPLATE_INCOMPLETE':
    case 'REQUEST_INVALID':
      return outcome;
    default:
      return 'INSPECTION_UNAVAILABLE';
  }
}
