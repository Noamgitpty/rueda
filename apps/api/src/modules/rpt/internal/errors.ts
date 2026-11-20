/**
 * Réponses propres aux vues de la bêta et au rapprochement (US-311, ADR-194) : code stable
 * (`SCREAMING_SNAKE_CASE` ; `RECON_STATEMENT_MISSING` et `RECON_FORMAT_INVALID` viennent de 16
 * FIN-005, les autres sont PROPOSÉS, à reporter dans 16 A.8) et clé de message du catalogue
 * `@rueda/i18n` (es, en, fr, pt-BR). Jamais de détail technique ni de donnée personnelle. Les refus
 * d'accès communs (AUTH_REQUIRED, FORBIDDEN, 2FA_REQUIRED, REQUEST_INVALID) restent ceux de
 * l'authentification.
 */
import { HttpException } from '@nestjs/common';

export const REPORT_MESSAGES = {
  // relevé du PSP absent (aucune ligne) : rien n'est enregistré
  RECON_STATEMENT_MISSING: { status: 400, messageKey: 'common.reconciliation.statementMissing' },
  // ligne mal formée, doublon, autre devise que celle du pays, mois à venir : rien n'est enregistré
  RECON_FORMAT_INVALID: { status: 400, messageKey: 'common.reconciliation.formatInvalid' },
  // checklist mensuelle : un point n'est pas coché, le passage reste ouvert
  RECON_CHECKLIST_INCOMPLETE: {
    status: 409,
    messageKey: 'common.reconciliation.checklistIncomplete',
  },
  // passage déjà clôturé : aucune résolution ni signature de plus
  RECON_RUN_CLOSED: { status: 409, messageKey: 'common.reconciliation.runClosed' },
  // élément déjà résolu, ou apparié (rien à résoudre)
  RECON_ITEM_SETTLED: { status: 409, messageKey: 'common.reconciliation.itemSettled' },
  // base indisponible : rien n'est lu ni enregistré
  REPORT_UNAVAILABLE: { status: 503, messageKey: 'common.reconciliation.unavailable' },
} as const;

export type ReportCode = keyof typeof REPORT_MESSAGES;

export class ReportHttpError extends HttpException {
  readonly code: ReportCode;

  constructor(code: ReportCode) {
    super({ code, messageKey: REPORT_MESSAGES[code].messageKey }, REPORT_MESSAGES[code].status);
    this.code = code;
  }
}
