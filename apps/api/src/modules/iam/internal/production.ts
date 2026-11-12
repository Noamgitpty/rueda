/**
 * Adaptateurs de PRODUCTION du port d'authentification. Aucune option ne permet d'y brancher un
 * FAKE (« inconnu = non ») : le FAKE n'est pas compilé dans l'image de production.
 *
 * La connexion PostgreSQL est fournie par l'appelant (`pg.Pool` configuré par les variables
 * standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` : aucun secret dans le code ni
 * dans une URL) ; `assertApiDatabaseRole` refuse de démarrer si elle n'est pas `app_api` sans
 * `SUPERUSER` ni `BYPASSRLS`.
 */
import type { IamAuthOptions } from './iam-auth.module.js';
import { PendingIdentityNotifier } from './notifier.js';
import { assertApiDatabaseRole, PgAuthStore } from './pg-auth-store.js';
import type { SqlExecutor } from './pg-auth-store.js';
import { otpHasherFromEnv } from './phone/otp-code.js';
import { PgPhoneOtpStore } from './phone/phone-otp-store.js';
import type { OtpSendGuard } from './phone/phone-verification.service.js';

/**
 * `env` : `RUEDA_OTP_KEY` (US-104 : absente, OTP indisponible ; mal formée, refus de démarrer).
 * `sendGuard` : plafonds anti-abus des envois d'OTP (`AbuseGuard` de RISK, US-052).
 */
export async function postgresIamAdapters(
  db: SqlExecutor,
  env: Readonly<Record<string, string | undefined>> = {},
  sendGuard?: OtpSendGuard,
): Promise<IamAuthOptions> {
  await assertApiDatabaseRole(db);
  const hasher = otpHasherFromEnv(env);
  return {
    store: new PgAuthStore(db),
    notifier: new PendingIdentityNotifier(),
    ...(sendGuard !== undefined
      ? { phone: { store: new PgPhoneOtpStore(db), hasher, sendGuard } }
      : {}),
  };
}
