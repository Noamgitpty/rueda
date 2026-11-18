/**
 * Réponses des routes de la constancia d'arrendamiento (US-212, ADR-162) : code stable (16 A.8,
 * sans préfixe de module) et clé du catalogue `@rueda/i18n` (es, en, fr, pt) ; jamais de détail
 * technique.
 *
 * Codes de 16 : `DOCUMENT_GENERATION_FAILED` (LEG-026 : faits figés illisibles, rendu impossible ;
 * rien n'est servi) ; `REQUEST_INVALID`, `AUTH_REQUIRED` (US-010). PROPOSÉS (à reporter dans 16
 * A.8) : `CONSTANCIA_NOT_FOUND` (trip inconnu, d'une autre personne ou identifiant mal formé : même
 * réponse, rien n'est révélé), `CONSTANCIA_NOT_AVAILABLE` (trip annulé : aucune location à
 * attester), `CONSTANCIA_NOT_GENERATED` (aucun contrat encore : la constancia suit le contrat),
 * `CONSTANCIA_ERASED` (partie nominative pseudonymisée à l'échéance de rétention),
 * `CONSTANCIA_UNAVAILABLE` (base indisponible : fail-closed).
 */
import { HttpException } from '@nestjs/common';

export const CONSTANCIA_MESSAGES = {
  CONSTANCIA_NOT_FOUND: { status: 404, messageKey: 'common.constancia.notFound' },
  CONSTANCIA_NOT_AVAILABLE: { status: 409, messageKey: 'common.constancia.notAvailable' },
  CONSTANCIA_NOT_GENERATED: { status: 409, messageKey: 'common.constancia.notGenerated' },
  CONSTANCIA_ERASED: { status: 409, messageKey: 'common.constancia.erased' },
  DOCUMENT_GENERATION_FAILED: { status: 503, messageKey: 'common.constancia.generationFailed' },
  CONSTANCIA_UNAVAILABLE: { status: 503, messageKey: 'common.constancia.unavailable' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
} as const;

export type ConstanciaCode = keyof typeof CONSTANCIA_MESSAGES;

/** Erreur HTTP des routes de la constancia : corps `{ code, messageKey }`. */
export class ConstanciaHttpError extends HttpException {
  readonly code: ConstanciaCode;

  constructor(code: ConstanciaCode) {
    super(
      { code, messageKey: CONSTANCIA_MESSAGES[code].messageKey },
      CONSTANCIA_MESSAGES[code].status,
    );
    this.code = code;
  }
}
