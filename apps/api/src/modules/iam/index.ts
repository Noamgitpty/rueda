// Point d'entrée public du module IAM. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, testing/, iam.module.ts) est privé (règle rueda/module-boundaries).
export { IamModule } from './iam.module.js';

// Port d'authentification (US-010, ADR-021, ADR-052) : ce que les autres modules utilisent.
export { SessionGuard } from './internal/session.guard.js';
export { principalOf } from './internal/http.js';
// Preuve de possession de la session (SHA-256 du jeton) pour les commandes des autres modules (US-102).
export { sessionProofOf } from './internal/session-proof.js';
export { AUTHENTICATION_PORT } from './internal/tokens.js';
export type { AuthenticatedPrincipal, AuthenticationPort } from './internal/auth.service.js';

// Montage par le processus API seulement (api.module.ts) et par les tests.
export { IamAuthModule } from './internal/iam-auth.module.js';
export type { IamAuthOptions, PhoneOtpOptions } from './internal/iam-auth.module.js';
export { postgresIamAdapters } from './internal/production.js';
// Envoi des e-mails d'identité par un canal NTF (US-102) ; production : aucun canal avant le lot C.
export { ChannelIdentityNotifier } from './internal/channel-notifier.js';
export type { ChannelIdentityNotifierOptions } from './internal/channel-notifier.js';
export type { SqlExecutor } from './internal/pg-auth-store.js';

// Console interne (US-012, ADR-062) : MFA du staff, garde des routes de console, principal.
export { StaffConsoleModule } from './internal/staff/staff-console.module.js';
export { StaffGuard, staffPrincipalOf } from './internal/staff/staff.guard.js';
export type { StaffOptions, StaffPrincipal } from './internal/staff/staff.service.js';
export type { StaffRole } from './internal/staff/staff-store.js';
export { postgresStaffAdapters } from './internal/staff/production.js';
export { AUTH_MESSAGES, AuthHttpError } from './internal/errors.js';
// Coordonnées des destinataires de notification pour NTF (US-021, ADR-061 ; IAM → NTF).
export { postgresNotificationContacts } from './internal/notification-contacts.js';
// Vérification du téléphone par OTP (US-104, ADR-098) : contrôle bloquant du paiement (US-209),
// émission asynchrone et purge par le travailleur, empreinte des codes (RUEDA_OTP_KEY).
export { PhoneVerifiedGuard } from './internal/phone/phone-verified.guard.js';
export {
  IAM_OTP_PRUNER_WORKER,
  IAM_OTP_SENDER_WORKER,
  OtpSender,
  registerPhoneOtp,
} from './internal/phone/otp-sender.js';
export type { OtpLogEntry, OtpSenderDeps } from './internal/phone/otp-sender.js';
export { OtpCodeHasher, otpHasherFromEnv } from './internal/phone/otp-code.js';
export type { OtpSendGuard, OtpSendRequest } from './internal/phone/phone-verification.service.js';
