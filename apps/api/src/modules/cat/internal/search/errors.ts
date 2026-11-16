/**
 * Réponses de la recherche publique `/search` (US-201) : code stable (16 A.8, sans préfixe de
 * module) et clé du catalogue `@rueda/i18n` (es, en, fr, pt) ; jamais de détail technique.
 *
 * Codes de 16 SRC-001 : `SEARCH_DATES_INVALID` (fin ≤ début, hors pas de 30 min, début passé,
 * 19 US-201 critère 1), `SEARCH_LOCATION_REQUIRED` (pays inconnu ou ville absente),
 * `SEARCH_DURATION_EXCEEDED` (au-delà de `max_trip_days` du pays, ADM-031) ; PROPOSÉS par US-201
 * (ADR-127, à reporter dans 16 A.8) : `SEARCH_UNAVAILABLE` (base ou paramètre du pays
 * indisponible, fail-closed) ; `RATE_LIMITED` reprend le code et le corps de la garde anti-abus
 * (US-052) pour la sonde de disponibilité (`availability_probe_per_minute`, BOARD N-78).
 *
 * Dates choisies sur la fiche (US-204, `GET /listings/{id}/availability`) : codes de 16 LST-006
 * `DATES_NOTICE_TOO_SHORT` (départ dans le préavis du lieu, `values.noticeHours` : préavis arrondi
 * à l'heure supérieure) et `DATES_UNAVAILABLE` (créneau pris ou hôte non activable, sans détail ;
 * LST-008 DIFFÉRÉ) ; `LISTING_NOT_FOUND` (16 A.8, US-115 : annonce inconnue ou non publiée) ; les
 * autres refus reprennent ceux de la recherche (même règle des dates).
 */
import { HttpException } from '@nestjs/common';

export const SEARCH_MESSAGES = {
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  SEARCH_LOCATION_REQUIRED: { status: 422, messageKey: 'common.search.locationRequired' },
  SEARCH_DATES_INVALID: { status: 422, messageKey: 'common.search.datesInvalid' },
  SEARCH_DURATION_EXCEEDED: { status: 422, messageKey: 'common.search.durationExceeded' },
  LISTING_NOT_FOUND: { status: 404, messageKey: 'common.listing.notFound' },
  DATES_NOTICE_TOO_SHORT: { status: 422, messageKey: 'common.listing.datesNoticeTooShort' },
  DATES_UNAVAILABLE: { status: 409, messageKey: 'common.listing.datesUnavailable' },
  RATE_LIMITED: { status: 429, messageKey: 'common.rateLimit.retryLater' },
  SEARCH_UNAVAILABLE: { status: 503, messageKey: 'common.search.unavailable' },
} as const;

export type SearchCode = keyof typeof SEARCH_MESSAGES;

export interface SearchErrorBody {
  readonly code: SearchCode;
  readonly messageKey: (typeof SEARCH_MESSAGES)[SearchCode]['messageKey'];
  readonly values?: Readonly<Record<string, number>>;
}

/** Erreur HTTP de la recherche : corps `{ code, messageKey[, values] }`. */
export class SearchHttpError extends HttpException {
  readonly code: SearchCode;
  /** Délai de reprise en secondes (en-tête `Retry-After`), pour `RATE_LIMITED`. */
  readonly retryAfterS: number | null;

  constructor(
    code: SearchCode,
    retryAfterS: number | null = null,
    values: Readonly<Record<string, number>> | null = null,
  ) {
    const all = { ...(retryAfterS !== null ? { retryAfterS } : {}), ...(values ?? {}) };
    const body: SearchErrorBody = {
      code,
      messageKey: SEARCH_MESSAGES[code].messageKey,
      ...(Object.keys(all).length > 0 ? { values: all } : {}),
    };
    super(body, SEARCH_MESSAGES[code].status);
    this.code = code;
    this.retryAfterS = retryAfterS;
  }
}
