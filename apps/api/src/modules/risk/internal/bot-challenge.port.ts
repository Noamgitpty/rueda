/**
 * Port anti-robot (US-052 ; reCAPTCHA complet = SUP-013, P1). Le client résout un défi et
 * présente son jeton dans l'en-tête `X-Bot-Challenge` ; le port le vérifie.
 *
 * Échecs en valeurs (ADR-058) : `PASSED`, `FAILED`, `UNAVAILABLE`. Un défi indisponible ou une
 * capacité inconnue vaut « non » : le client soupçonné est refusé (fail-closed).
 *
 * Production : `UnavailableBotChallenge` tant qu'aucun fournisseur n'est contracté (SUP-013) ;
 * un client soupçonné d'être un robot est donc refusé (`BOT_CHALLENGE_REQUIRED`), jamais laissé
 * passer. Le FAKE de la bêta (`risk/testing`) n'est jamais importé par le code de production.
 */
export type ChallengeOutcome = 'PASSED' | 'FAILED' | 'UNAVAILABLE';

export interface BotChallengePort {
  /** `token` : jeton présenté par le client ; `subject` : empreinte hexadécimale de son IP. */
  verify(token: string, subject: string): Promise<ChallengeOutcome>;
}

export class UnavailableBotChallenge implements BotChallengePort {
  verify(): Promise<ChallengeOutcome> {
    return Promise.resolve('UNAVAILABLE');
  }
}

/** En-tête du jeton de défi (minuscules, comme Node les rend). */
export const CHALLENGE_HEADER = 'x-bot-challenge';
