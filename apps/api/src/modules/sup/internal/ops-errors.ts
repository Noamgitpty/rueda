/**
 * Réponses propres aux files de revue, à la fiche 360°, aux pièces du staff (US-109) et à la file
 * d'ajout au catalogue (US-114, ADR-104) : code
 * stable (16 A.8, `SCREAMING_SNAKE_CASE`, PROPOSÉS, à reporter dans 16 A.8) et clé de message du
 * catalogue `@rueda/i18n` (es, en, fr, pt-BR). Jamais de détail technique ni de donnée personnelle.
 * Les refus d'accès communs (AUTH_REQUIRED, FORBIDDEN, 2FA_REQUIRED, REQUEST_INVALID) restent ceux
 * de l'authentification (`AuthHttpError`).
 */
import { HttpException } from '@nestjs/common';

export const OPS_MESSAGES = {
  // la permission est détenue, mais aucun dossier ni élément de file assigné ne couvre le sujet
  STAFF_CASE_REQUIRED: { status: 403, messageKey: 'common.ops.caseRequired' },
  STAFF_ITEM_TAKEN: { status: 409, messageKey: 'common.ops.itemTaken' },
  STAFF_USER_NOT_FOUND: { status: 404, messageKey: 'common.ops.userNotFound' },
  EVIDENCE_REJECTED: { status: 422, messageKey: 'common.evidence.rejected' },
  EVIDENCE_UNAVAILABLE: { status: 503, messageKey: 'common.evidence.unavailable' },
  // file d'ajout au catalogue (US-114) : demande déjà tranchée (ou absente derrière l'élément)
  CATALOG_REQUEST_CLOSED: { status: 409, messageKey: 'common.catalogAddition.closed' },
  // APPROVE d'une variante déjà au catalogue : la rapprocher (MERGE)
  CATALOG_VARIANT_EXISTS: { status: 409, messageKey: 'common.catalogAddition.variantExists' },
  // MERGE vers une variante inconnue, non ACTIVE, d'un autre marché ou d'une autre année
  CATALOG_VARIANT_NOT_FOUND: { status: 422, messageKey: 'common.catalogAddition.variantNotFound' },
  CATALOG_ENTRY_INVALID: { status: 422, messageKey: 'common.catalogAddition.entryInvalid' },
  // revue du véhicule (US-124) : véhicule plus en revue (déjà tranché) ; liste de contrôle
  // incomplète ou mal formée (aucune case « tout vérifié », L1-PM-14)
  VEHICLE_REVIEW_CLOSED: { status: 409, messageKey: 'common.vehicleReview.closed' },
  VEHICLE_CHECKLIST_INVALID: { status: 422, messageKey: 'common.vehicleReview.checklistInvalid' },
  // contestation (BOARD N-61) : déjà tranchée ; motif absent ou en trop ; confirmation à l'ADMIN
  VEHICLE_CLAIM_CLOSED: { status: 409, messageKey: 'common.vehicleReview.claimClosed' },
  VEHICLE_CLAIM_REASON_INVALID: {
    status: 422,
    messageKey: 'common.vehicleReview.claimReasonInvalid',
  },
  STAFF_ADMIN_REQUIRED: { status: 403, messageKey: 'common.vehicleReview.adminRequired' },
  // pièce : hors de l'élément ; coffre ou stockage indisponibles (production : 503)
  VEHICLE_FILE_NOT_FOUND: { status: 404, messageKey: 'common.vehicleReview.fileNotFound' },
  VEHICLE_FILE_UNAVAILABLE: { status: 503, messageKey: 'common.vehicleReview.fileUnavailable' },
} as const;

export type OpsCode = keyof typeof OPS_MESSAGES;

export class OpsHttpError extends HttpException {
  readonly code: OpsCode;

  constructor(code: OpsCode, values?: Readonly<Record<string, number | string>>) {
    super(
      {
        code,
        messageKey: OPS_MESSAGES[code].messageKey,
        ...(values !== undefined ? { values } : {}),
      },
      OPS_MESSAGES[code].status,
    );
    this.code = code;
  }
}
