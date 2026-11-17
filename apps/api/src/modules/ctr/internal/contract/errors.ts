/**
 * Réponses des routes du contrat de location d'un trip `/trips/{tripId}/contract` (US-211 partie
 * 211b, ADR-149) : code stable (16 A.8, sans préfixe de module) et clé du catalogue `@rueda/i18n`
 * (es, en, fr, pt) ; jamais de détail technique.
 *
 * Codes de 16 A.8 : `CONTRACT_HASH_MISMATCH` (BKG-019) ; `REQUEST_INVALID`, `AUTH_REQUIRED` (US-010).
 * PROPOSÉS (à reporter dans 16 A.8) : `CONTRACT_NOT_FOUND` (trip inconnu, d'une autre personne ou
 * version absente : même réponse, rien n'est révélé), `CONTRACT_NOT_GENERATED` (trip d'une partie
 * sans contrat encore), `CONTRACT_SUPERSEDED`, `CONTRACT_NOT_SIGNABLE` (trip annulé ou déjà
 * remis), `CONTRACT_TEXT_ERASED` (partie nominative pseudonymisée : le PDF ne se reproduit plus,
 * l'empreinte reste), `CONTRACT_UNAVAILABLE` (base indisponible, ou texte figé qui ne redonne plus
 * l'empreinte enregistrée : rien n'est servi, fail-closed).
 */
import { HttpException } from '@nestjs/common';

export const CONTRACT_MESSAGES = {
  CONTRACT_NOT_FOUND: { status: 404, messageKey: 'common.contract.notFound' },
  CONTRACT_NOT_GENERATED: { status: 409, messageKey: 'common.contract.notGenerated' },
  CONTRACT_SUPERSEDED: { status: 409, messageKey: 'common.contract.superseded' },
  CONTRACT_NOT_SIGNABLE: { status: 409, messageKey: 'common.contract.notSignable' },
  CONTRACT_HASH_MISMATCH: { status: 409, messageKey: 'common.contract.hashMismatch' },
  CONTRACT_TEXT_ERASED: { status: 409, messageKey: 'common.contract.textErased' },
  CONTRACT_UNAVAILABLE: { status: 503, messageKey: 'common.contract.unavailable' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
} as const;

export type ContractCode = keyof typeof CONTRACT_MESSAGES;

/** Erreur HTTP des routes du contrat : corps `{ code, messageKey }`. */
export class ContractHttpError extends HttpException {
  readonly code: ContractCode;

  constructor(code: ContractCode) {
    super({ code, messageKey: CONTRACT_MESSAGES[code].messageKey }, CONTRACT_MESSAGES[code].status);
    this.code = code;
  }
}
