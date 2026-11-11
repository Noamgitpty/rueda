/**
 * Travailleur `iam_otp_sender` (US-104, ADR-098) : consommateur de `iam.otp.requested` (module
 * BUS). L'envoi de l'OTP est ASYNCHRONE et ne laisse aucun code en clair derrière lui (suite N-23
 * appliquée à l'OTP) :
 *   1. tire le code (CSPRNG, `drawOtpCode`) et calcule son empreinte (`RUEDA_OTP_KEY`) ;
 *   2. dépose l'empreinte par `core.iam_worker_otp_issue` (défi vivant, le plus récent, sans code :
 *      sinon rien n'est envoyé — tâche rejouée, défi expiré, bloqué ou remplacé) ;
 *   3. rend le SMS dans la langue de la personne (si le pays la propose, sinon la langue par défaut
 *      du pays) et l'envoie par le port `MessagingChannel` (canal `SMS`) de NTF, clé d'idempotence
 *      `otp:<défi>:<empreinte courte>` : un envoi rejoué après un COMMIT perdu porte un autre code,
 *      donc une autre clé (jamais un ancien code « rejoué » par le fournisseur).
 * Aucune nouvelle tentative : un échec du canal est journalisé, le défi reste émis ; la personne
 * demande un nouveau code après `otp_sms_fallback_s` (16 VER-013 « non reçu → renvoi SMS après
 * 60 s »). Clé ou canal SMS absent (production avant le lot C : `FAKE` seulement, jamais actif) :
 * rien n'est émis ni envoyé (fail-closed), l'événement est consommé.
 *
 * Journaux : issue, pays et motif court seulement. Jamais le numéro, le code ni l'empreinte.
 */
import type { BusRegistry, DomainEvent, SqlClient } from '../../../bus/index.js';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { LocaleConfig } from '@rueda/i18n';
import type { MessagingChannel } from '../../../ntf/index.js';
import type { OtpCodeHasher } from './otp-code.js';
import { drawOtpCode } from './otp-code.js';

export const IAM_OTP_SENDER_WORKER = 'iam_otp_sender';
export const IAM_OTP_PRUNER_WORKER = 'iam_otp_pruner';
export const OTP_REQUESTED_EVENT = 'iam.otp.requested';
export const OTP_SMS_TEMPLATE = 'EVT_OTP_CODE';

export interface OtpCountryLocales {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}

export interface OtpLogEntry {
  readonly event: 'iam.otp.sms';
  readonly outcome:
    | 'SENT'
    | 'NOT_SENT'
    | 'SKIPPED'
    | 'REFUSED'
    | 'CHANNEL_UNAVAILABLE'
    | 'TIMEOUT'
    | 'RENDER_FAILED';
  readonly country: string | null;
  readonly reason: string | null;
}

export interface OtpSenderDeps {
  /** `null` : `RUEDA_OTP_KEY` absente, aucun code émis. */
  readonly hasher: OtpCodeHasher | null;
  /** Canal SMS (`FAKE` hors production) ; absent : aucun envoi (fail-closed). */
  readonly sms: MessagingChannel | null;
  readonly localeConfig: LocaleConfig;
  readonly countryOf: (code: string) => OtpCountryLocales | undefined;
  /** Nom de marque (DEC-MARQUE, donnée de thème ; `RUEDA_BRAND_NAME`). */
  readonly brand: string;
  readonly log?: (entry: OtpLogEntry) => void;
  /** Tirage du code (CSPRNG par défaut ; remplaçable par les tests seulement). */
  readonly draw?: () => string;
}

interface IssueRow {
  readonly outcome: string;
  readonly phone_e164: string | null;
  readonly country_code: string | null;
  readonly locale: string | null;
  readonly expires_in_min: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Langue du SMS : celle du compte si le pays la propose (même langue admise), sinon le défaut. */
export function otpLocale(preferred: string | null, country: OtpCountryLocales): string {
  if (preferred !== null) {
    if (country.locales.includes(preferred)) return preferred;
    const language = preferred.split('-')[0];
    const same = country.locales.find((l) => l.split('-')[0] === language);
    if (same !== undefined) return same;
  }
  return country.defaultLocale;
}

export class OtpSender {
  readonly #deps: OtpSenderDeps;
  readonly #log: (entry: OtpLogEntry) => void;

  constructor(deps: OtpSenderDeps) {
    this.#deps = deps;
    this.#log = deps.log ?? ((entry) => console.log(JSON.stringify({ level: 'info', ...entry })));
  }

  async handle(event: DomainEvent, tx: SqlClient): Promise<void> {
    const challengeId = event.payload['challenge_id'];
    if (typeof challengeId !== 'string' || !UUID.test(challengeId)) {
      // contrat de l'événement rompu : jamais un envoi sur une donnée douteuse
      throw new Error('iam_otp_sender : challenge_id manquant ou invalide');
    }
    const { hasher, sms } = this.#deps;
    if (hasher === null || sms === null) {
      this.#log({
        event: 'iam.otp.sms',
        outcome: 'NOT_SENT',
        country: event.countryCode,
        reason: hasher === null ? 'OTP_KEY_MISSING' : 'CHANNEL_MISSING',
      });
      return;
    }
    const code = (this.#deps.draw ?? drawOtpCode)();
    const codeHash = hasher.hash(code);
    const { rows } = await tx.query<IssueRow>(
      'SELECT outcome, phone_e164, country_code, locale, expires_in_min FROM core.iam_worker_otp_issue($1::uuid, $2::bytea)',
      [challengeId, codeHash],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('iam_otp_sender : issue absente');
    if (row.outcome !== 'ISSUED') {
      this.#log({
        event: 'iam.otp.sms',
        outcome: 'SKIPPED',
        country: event.countryCode,
        reason: row.outcome,
      });
      return;
    }
    if (row.phone_e164 === null || row.country_code === null || row.expires_in_min === null) {
      throw new Error('iam_otp_sender : défi émis incomplet');
    }
    let body: string;
    let locale: string;
    try {
      const country = this.#deps.countryOf(row.country_code);
      if (country === undefined) throw new Error('pays inconnu');
      locale = otpLocale(row.locale, country);
      body = createTranslator(getProfile(this.#deps.localeConfig, locale)).t('common.otp.sms', {
        brand: this.#deps.brand,
        code,
        minutes: row.expires_in_min,
      });
    } catch {
      this.#log({
        event: 'iam.otp.sms',
        outcome: 'RENDER_FAILED',
        country: row.country_code,
        reason: 'TEMPLATE',
      });
      return;
    }
    const outcome = await sms.send({
      idempotencyKey: `otp:${challengeId}:${codeHash.subarray(0, 8).toString('hex')}`,
      channel: 'SMS',
      to: row.phone_e164,
      locale,
      templateKey: OTP_SMS_TEMPLATE,
      subject: null,
      body,
    });
    this.#log({
      event: 'iam.otp.sms',
      outcome:
        outcome.status === 'OK'
          ? 'SENT'
          : outcome.status === 'UNAVAILABLE'
            ? 'CHANNEL_UNAVAILABLE'
            : outcome.status,
      country: row.country_code,
      reason: outcome.status === 'REFUSED' ? outcome.reason : null,
    });
  }
}

/** Consommateur `iam_otp_sender` et purge périodique `iam_otp_pruner` (30 jours, 17 §3.2.1). */
export function registerPhoneOtp(
  registry: BusRegistry,
  sender: OtpSender,
  prune: {
    readonly periodSeconds: number;
    readonly batch: number;
    readonly log: (n: number) => void;
  },
): void {
  registry.registerConsumer(IAM_OTP_SENDER_WORKER, [OTP_REQUESTED_EVENT], (event, tx) =>
    sender.handle(event, tx),
  );
  registry.registerPeriodic(IAM_OTP_PRUNER_WORKER, prune.periodSeconds, async (_p, tx) => {
    const { rows } = await tx.query<{ n: unknown }>('SELECT core.iam_worker_otp_prune($1) AS n', [
      prune.batch,
    ]);
    const n = Number(rows[0]?.n);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('compte attendu');
    prune.log(n);
  });
}
