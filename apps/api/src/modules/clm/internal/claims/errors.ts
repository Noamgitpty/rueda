/**
 * Réponses propres aux déclarations de dommage et aux décisions (US-309, ADR-195) : code stable
 * (16 A.8, `SCREAMING_SNAKE_CASE` ; `CLAIM_DEADLINE_PASSED`, `CLAIM_DECISION_WITHOUT_EVIDENCE`,
 * `DECISION_RATIONALE_REQUIRED` et `LEG_SUM_MISMATCH` viennent de 16 CLM-001, CLM-006, ADM-008 et
 * LEG-024 ; les autres sont PROPOSÉS, à reporter dans 16 A.8) et clé de message du catalogue
 * `@rueda/i18n` (es, en, fr, pt-BR). Jamais de détail technique ni de donnée personnelle. Les refus
 * d'accès communs (AUTH_REQUIRED, FORBIDDEN, 2FA_REQUIRED, REQUEST_INVALID) restent ceux de
 * l'authentification ; STAFF_CASE_REQUIRED et STAFF_SELF_FORBIDDEN ceux de la console (SUP).
 */
import { HttpException } from '@nestjs/common';

export const CLAIM_MESSAGES = {
  CLAIM_NOT_FOUND: { status: 404, messageKey: 'common.claim.notFound' },
  // 16 CLM-001 : déclaration après max(fin prévue, retour) + `claim_declaration_window_h`
  CLAIM_DEADLINE_PASSED: { status: 422, messageKey: 'common.claim.deadlinePassed' },
  // paramètre du délai absent : aucune déclaration n'est acceptée (fail-closed)
  CLAIM_WINDOW_UNKNOWN: { status: 503, messageKey: 'common.claim.windowUnknown' },
  CLAIM_TRIP_NOT_ELIGIBLE: { status: 409, messageKey: 'common.claim.tripNotEligible' },
  CLAIM_ALREADY_OPEN: { status: 409, messageKey: 'common.claim.alreadyOpen' },
  CLAIM_ALREADY_DECIDED: { status: 409, messageKey: 'common.claim.alreadyDecided' },
  // 16 CLM-006, LEG-024 : aucune retenue sans photos de départ et de retour
  CLAIM_DECISION_WITHOUT_EVIDENCE: {
    status: 422,
    messageKey: 'common.claim.decisionWithoutEvidence',
  },
  // 16 ADM-008 : décision motivée par gabarit
  DECISION_RATIONALE_REQUIRED: { status: 422, messageKey: 'common.claim.rationaleRequired' },
  // 22 OQ-BR-24 : jamais une décision « définitive »
  DECISION_FINALITY_FORBIDDEN: { status: 422, messageKey: 'common.claim.finalityForbidden' },
  // 16 CLM-006 : Σ des jambes ≠ montant débité ⇒ aucun ordre
  LEG_SUM_MISMATCH: { status: 422, messageKey: 'common.claim.legSumMismatch' },
  DECISION_OUTCOME_MISMATCH: { status: 422, messageKey: 'common.claim.outcomeMismatch' },
  CLAIM_CAP_UNKNOWN: { status: 422, messageKey: 'common.claim.capUnknown' },
  DAMAGE_ABOVE_ACCEPTED_AMOUNT: { status: 422, messageKey: 'common.claim.aboveAcceptedAmount' },
  DAMAGE_ABOVE_REPAIR_COST: { status: 422, messageKey: 'common.claim.aboveRepairCost' },
  // 16 CLM-006 « décision au-delà d'un seuil » : aucun seuil fixé ⇒ tout débit (PROPOSÉ)
  DECISION_ADMIN_REQUIRED: { status: 403, messageKey: 'common.claim.adminRequired' },
  AGREEMENT_FILE_INVALID: { status: 422, messageKey: 'common.claim.agreementFileInvalid' },
  // US-706 (ADR-197) : seule une demande de frais annexe CONTESTÉE est décidée par l'ops
  INCIDENTAL_NOT_DISPUTED: { status: 409, messageKey: 'common.claim.incidentalNotDisputed' },
  // US-318 suite (ADR-201) : seule une refacturation (amende, péage, fourrière) CONTESTÉE est
  // décidée par l'ops
  TRAFFIC_NOT_DISPUTED: { status: 409, messageKey: 'common.claim.trafficNotDisputed' },
  CLAIMS_UNAVAILABLE: { status: 503, messageKey: 'common.claim.unavailable' },
} as const;

export type ClaimCode = keyof typeof CLAIM_MESSAGES;

export const isClaimCode = (v: string): v is ClaimCode => Object.hasOwn(CLAIM_MESSAGES, v);

export class ClaimHttpError extends HttpException {
  readonly code: ClaimCode;

  constructor(code: ClaimCode) {
    super({ code, messageKey: CLAIM_MESSAGES[code].messageKey }, CLAIM_MESSAGES[code].status);
    this.code = code;
  }
}
