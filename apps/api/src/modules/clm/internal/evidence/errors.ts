/**
 * Réponses propres au dossier de preuve (US-308, ADR-184) : code stable (16 A.8,
 * `SCREAMING_SNAKE_CASE` ; `EVIDENCE_EXPORT_FAILED` vient de 16 CLM-034, les autres sont PROPOSÉS, à
 * reporter dans 16 A.8) et clé de message du catalogue `@rueda/i18n` (es, en, fr, pt-BR). Jamais de
 * détail technique ni de donnée personnelle. Les refus d'accès communs (AUTH_REQUIRED, FORBIDDEN,
 * 2FA_REQUIRED, REQUEST_INVALID) restent ceux de l'authentification ; STAFF_CASE_REQUIRED et
 * STAFF_SELF_FORBIDDEN ceux de la console (SUP).
 */
import { HttpException } from '@nestjs/common';

export const EVIDENCE_BUNDLE_MESSAGES = {
  // archive pas encore générée (REQUESTED) : réessayer plus tard
  EVIDENCE_EXPORT_NOT_READY: { status: 409, messageKey: 'common.evidenceBundle.notReady' },
  // lien échu (168 h après la génération) : demander un nouveau dossier
  EVIDENCE_EXPORT_EXPIRED: { status: 410, messageKey: 'common.evidenceBundle.expired' },
  // constat (empreinte, objet absent, clé, rendu) ou archive illisible : rien n'est servi
  EVIDENCE_EXPORT_FAILED: { status: 409, messageKey: 'common.evidenceBundle.failed' },
  // coffre ou stockage non branchés (production bêta) : rien n'est demandé ni servi
  EVIDENCE_EXPORT_UNAVAILABLE: { status: 503, messageKey: 'common.evidenceBundle.unavailable' },
} as const;

export type EvidenceBundleCode = keyof typeof EVIDENCE_BUNDLE_MESSAGES;

export class EvidenceBundleHttpError extends HttpException {
  readonly code: EvidenceBundleCode;

  constructor(code: EvidenceBundleCode) {
    super(
      { code, messageKey: EVIDENCE_BUNDLE_MESSAGES[code].messageKey },
      EVIDENCE_BUNDLE_MESSAGES[code].status,
    );
    this.code = code;
  }
}
