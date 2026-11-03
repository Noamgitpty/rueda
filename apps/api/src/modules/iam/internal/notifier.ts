/**
 * Port d'envoi des messages d'identité (email de vérification, « vous avez déjà un compte »,
 * 16 ACC-001). L'envoi réel relève de NTF (17 §2.2 : IAM dépend de NTF), story ultérieure.
 *
 * Production, en attendant NTF : `PendingIdentityNotifier` n'envoie RIEN et journalise une ligne
 * sans donnée personnelle ni jeton. Conséquence voulue (fail-closed) : un compte reste
 * `PENDING_EMAIL` tant que NTF n'existe pas. Le FAKE qui enregistre les envois est dans
 * `../testing/` (tests seulement).
 *
 * Le jeton de vérification n'est remis qu'à ce port (pour construire le lien) : jamais dans la
 * réponse HTTP, jamais dans un journal.
 */
import { Logger } from '@nestjs/common';

export interface VerificationMessage {
  readonly userId: string;
  readonly email: string;
  readonly locale: string;
  /** Jeton en clair du lien (secret, usage unique). */
  readonly token: string;
}

export interface AccountExistsMessage {
  readonly email: string;
  readonly locale: string;
}

export interface IdentityNotifier {
  sendEmailVerification(message: VerificationMessage): Promise<void>;
  sendAccountExists(message: AccountExistsMessage): Promise<void>;
}

export class PendingIdentityNotifier implements IdentityNotifier {
  readonly #logger = new Logger('IamNotifier');

  async sendEmailVerification(): Promise<void> {
    this.#logger.warn('email de vérification non envoyé : module NTF absent (US-010, PROPOSÉ)');
  }

  async sendAccountExists(): Promise<void> {
    this.#logger.warn('email « compte existant » non envoyé : module NTF absent (US-010, PROPOSÉ)');
  }
}
