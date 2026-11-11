/**
 * Envoi des messages d'identité par un canal e-mail (US-102, 16 ACC-001 : « e-mail envoyé en
 * ≤ 1 min dans la langue choisie »). L'envoi a lieu PENDANT la requête d'inscription : le délai est
 * celui de l'appel au canal (borné par l'adaptateur).
 *
 * - Texte : catalogue `@rueda/i18n` (`common.auth.emailVerification.*`, `common.auth.accountExists.*`)
 *   dans la langue du compte, repli sur la locale par défaut de la configuration.
 * - Lien : `<webBaseUrl>/verify-email?token=<jeton>` (le jeton n'est remis qu'au canal : jamais
 *   journalisé, jamais dans une réponse HTTP). La page web demande un clic avant de consommer le
 *   lien (un scanner de messagerie qui suit le lien ne vérifie rien).
 * - Échec du canal (refus, indisponible, délai) : aucune erreur vers le client (réponse identique,
 *   anti-énumération) et une ligne de journal sans donnée personnelle ; le compte reste
 *   `PENDING_EMAIL`, un nouveau lien pourra être demandé.
 *
 * Production : aucun adaptateur e-mail réel avant le lot C (F-03) ; `postgresIamAdapters` garde
 * `PendingIdentityNotifier` (fail-closed) tant qu'aucun canal n'est fourni.
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { createTranslator, getProfile, negotiateLocale } from '@rueda/i18n';
import type { LocaleConfig } from '@rueda/i18n';
import type { MessagingChannel } from '../../ntf/index.js';
import type { AccountExistsMessage, IdentityNotifier, VerificationMessage } from './notifier.js';

export interface ChannelIdentityNotifierOptions {
  readonly channel: MessagingChannel;
  readonly locales: LocaleConfig;
  /** URL publique du site (https, sans identifiants), par exemple `https://app.example`. */
  readonly webBaseUrl: URL;
  /** Nom de la marque (donnée de thème, jamais écrit dans le code). */
  readonly brand: string;
}

export class ChannelIdentityNotifier implements IdentityNotifier {
  readonly #logger = new Logger('IamNotifier');
  readonly #o: ChannelIdentityNotifierOptions;

  constructor(options: ChannelIdentityNotifierOptions) {
    if (options.channel.channel !== 'EMAIL') throw new Error('IAM : canal e-mail exigé');
    if (options.webBaseUrl.username !== '' || options.webBaseUrl.password !== '') {
      throw new Error('IAM : URL du site avec identifiants refusée');
    }
    this.#o = options;
  }

  #translator(locale: string) {
    const tag = negotiateLocale({ stored: locale, acceptLanguage: null }, this.#o.locales);
    return { tag, t: createTranslator(getProfile(this.#o.locales, tag)).t };
  }

  #link(path: string, query?: Record<string, string>): string {
    const url = new URL(path, this.#o.webBaseUrl);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    return url.href;
  }

  async #send(
    kind: string,
    idempotencyKey: string,
    to: string,
    locale: string,
    subjectKey: 'common.auth.emailVerification.subject' | 'common.auth.accountExists.subject',
    bodyKey: 'common.auth.emailVerification.body' | 'common.auth.accountExists.body',
    link: string,
  ): Promise<void> {
    const { tag, t } = this.#translator(locale);
    const values = { brand: this.#o.brand, link };
    try {
      const outcome = await this.#o.channel.send({
        idempotencyKey,
        channel: 'EMAIL',
        to,
        locale: tag,
        templateKey: kind,
        subject: t(subjectKey, values),
        body: t(bodyKey, values),
      });
      if (outcome.status !== 'OK') {
        this.#logger.warn(`message ${kind} non envoyé (${outcome.status})`);
      }
    } catch {
      this.#logger.warn(`message ${kind} non envoyé (erreur du canal)`);
    }
  }

  async sendEmailVerification(message: VerificationMessage): Promise<void> {
    await this.#send(
      'IAM_EMAIL_VERIFICATION',
      `iam-verify:${message.userId}`,
      message.email,
      message.locale,
      'common.auth.emailVerification.subject',
      'common.auth.emailVerification.body',
      this.#link('/verify-email', { token: message.token }),
    );
  }

  async sendAccountExists(message: AccountExistsMessage): Promise<void> {
    await this.#send(
      'IAM_ACCOUNT_EXISTS',
      `iam-exists:${randomUUID()}`,
      message.email,
      message.locale,
      'common.auth.accountExists.subject',
      'common.auth.accountExists.body',
      this.#link('/login'),
    );
  }
}
