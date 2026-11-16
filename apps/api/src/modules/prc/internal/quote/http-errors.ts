/**
 * Réponses HTTP du devis (US-202), pour la route de réservation qui l'expose (US-208, module AVL :
 * une route de devis est une route de réservation, `SessionGuard` + `TermsGuard` d'US-102, que PRC
 * ne peut pas porter : PRC ne dépend que de CAT et CFG, 17 §2.2) : code stable (16 A.8) et clé du catalogue
 * `@rueda/i18n` (es, en, fr, pt-BR) ; jamais de détail technique ni de montant de jambe.
 *
 * Codes de 16 : `QUOTE_UNAVAILABLE` (PRC-025), `TAX_CONFIG_MISSING` (PRC-020),
 * `LEG_AMOUNT_NEGATIVE` (PRC-025) — tous trois « aucun prix possible pour ces dates », même texte au
 * voyageur ; `LISTING_NOT_FOUND`, `LISTING_UNAVAILABLE` (PROPOSÉS par US-115, mêmes textes que la
 * fiche) ; PROPOSÉS par US-202 (ADR-125) : `QUOTE_INPUT_INVALID` (dates ou corps invalides),
 * `QUOTE_MISMATCH` (devis rejoué différent, figé refusé par la base).
 */
import { HttpException } from '@nestjs/common';

export const QUOTE_MESSAGES = {
  QUOTE_INPUT_INVALID: { status: 400, messageKey: 'common.quote.datesInvalid' },
  LISTING_NOT_FOUND: { status: 404, messageKey: 'common.listing.notFound' },
  QUOTE_UNAVAILABLE: { status: 422, messageKey: 'common.quote.unavailable' },
  TAX_CONFIG_MISSING: { status: 422, messageKey: 'common.quote.unavailable' },
  LEG_AMOUNT_NEGATIVE: { status: 422, messageKey: 'common.quote.unavailable' },
  QUOTE_MISMATCH: { status: 409, messageKey: 'common.quote.changed' },
  LISTING_UNAVAILABLE: { status: 503, messageKey: 'common.listing.unavailable' },
  // US-208 (N-130, revue code d'US-202 n° 4) : issues des commandes 0100 et 0108 exposées par la
  // route du checkout (AVL). Internes, sans texte : TRIP_NOT_FOUND et QUOTE_ALREADY_VERSIONED du
  // rattachement d'un devis au trip (conversion, travailleur, US-223).
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  QUOTE_NOT_FOUND: { status: 404, messageKey: 'common.quote.notFound' },
  QUOTE_REPLAY_MISMATCH: { status: 409, messageKey: 'common.quote.changed' },
  QUOTE_RATE_LIMITED: { status: 429, messageKey: 'common.quote.rateLimited' },
} as const;

export type QuoteHttpCode = keyof typeof QUOTE_MESSAGES;

export class QuoteHttpError extends HttpException {
  readonly code: QuoteHttpCode;

  constructor(code: QuoteHttpCode) {
    super({ code, messageKey: QUOTE_MESSAGES[code].messageKey }, QUOTE_MESSAGES[code].status);
    this.code = code;
  }
}
