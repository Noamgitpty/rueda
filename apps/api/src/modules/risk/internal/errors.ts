/**
 * Réponses de la limitation de débit et de l'anti-abus (US-052) : code stable (16 A.8,
 * `SCREAMING_SNAKE_CASE` sans préfixe) et clé de message du catalogue `@rueda/i18n` (es, en, fr,
 * pt). Jamais de détail technique, jamais de clé de compteur.
 *
 * - `RATE_LIMITED` (16 A.8, ACC-001) : 429, avec `Retry-After` et `values.retryAfterS` ;
 * - `RATE_LIMIT_UNAVAILABLE` (PROPOSÉ) : 503, compteur indisponible pour un envoi coûteux
 *   (SMS, e-mail, OTP) : refus fail-closed, l'envoi n'a pas lieu ;
 * - `BOT_CHALLENGE_REQUIRED` (PROPOSÉ) : 403, client soupçonné d'être un robot, défi anti-robot
 *   absent, échoué ou indisponible.
 */
import { HttpException } from '@nestjs/common';

export const RISK_MESSAGES = {
  RATE_LIMITED: { status: 429, messageKey: 'common.rateLimit.retryLater' },
  RATE_LIMIT_UNAVAILABLE: { status: 503, messageKey: 'common.rateLimit.unavailable' },
  BOT_CHALLENGE_REQUIRED: { status: 403, messageKey: 'common.rateLimit.challengeRequired' },
} as const;

export type RiskCode = keyof typeof RISK_MESSAGES;

export interface RiskBody {
  readonly code: RiskCode;
  readonly messageKey: (typeof RISK_MESSAGES)[RiskCode]['messageKey'];
  readonly values?: Readonly<Record<string, number>>;
}

/** Erreur HTTP de l'anti-abus : corps `{ code, messageKey, values? }`. */
export class RiskHttpError extends HttpException {
  readonly code: RiskCode;
  /** Délai de reprise en secondes (en-tête `Retry-After`), pour `RATE_LIMITED`. */
  readonly retryAfterS: number | null;

  constructor(code: RiskCode, retryAfterS: number | null = null) {
    const body: RiskBody = {
      code,
      messageKey: RISK_MESSAGES[code].messageKey,
      ...(retryAfterS !== null ? { values: { retryAfterS } } : {}),
    };
    super(body, RISK_MESSAGES[code].status);
    this.code = code;
    this.retryAfterS = retryAfterS;
  }
}
