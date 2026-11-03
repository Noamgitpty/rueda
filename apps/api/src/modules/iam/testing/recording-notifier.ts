/**
 * FAKE du port d'envoi des messages d'identité — TESTS SEULEMENT (exclu de la compilation de
 * production). Enregistre les messages au lieu de les envoyer.
 */
import type {
  AccountExistsMessage,
  IdentityNotifier,
  VerificationMessage,
} from '../internal/notifier.js';

export class RecordingIdentityNotifier implements IdentityNotifier {
  readonly verifications: VerificationMessage[] = [];
  readonly accountExists: AccountExistsMessage[] = [];

  async sendEmailVerification(message: VerificationMessage): Promise<void> {
    this.verifications.push(message);
  }

  async sendAccountExists(message: AccountExistsMessage): Promise<void> {
    this.accountExists.push(message);
  }
}
