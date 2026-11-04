/**
 * Défi anti-robot `FAKE` (US-052, bêta) : réussit si le jeton vaut `FAKE_CHALLENGE_TOKEN`,
 * échoue sinon ; `unavailable` simule un fournisseur en panne. Les vérifications sont gardées
 * pour les assertions. Jamais actif en production (C19).
 */
import type { BotChallengePort, ChallengeOutcome } from '../internal/bot-challenge.port.js';

export const FAKE_CHALLENGE_TOKEN = 'fake-challenge-solved';

export class FakeBotChallenge implements BotChallengePort {
  readonly verified: { token: string; subject: string }[] = [];
  unavailable = false;

  verify(token: string, subject: string): Promise<ChallengeOutcome> {
    this.verified.push({ token, subject });
    if (this.unavailable) return Promise.resolve('UNAVAILABLE');
    return Promise.resolve(token === FAKE_CHALLENGE_TOKEN ? 'PASSED' : 'FAILED');
  }
}
