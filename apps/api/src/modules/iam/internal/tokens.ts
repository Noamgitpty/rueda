/** Jetons d'injection Nest du module IAM (injection explicite : aucune métadonnée de type requise). */
export const AUTHENTICATION_PORT = Symbol('iam.AuthenticationPort');
export const IAM_AUTH_STORE = Symbol('iam.AuthStore');
export const IAM_NOTIFIER = Symbol('iam.IdentityNotifier');
export const IAM_CLOCK = Symbol('iam.Clock');
export const IAM_PASSWORD_HASHER = Symbol('iam.PasswordHasher');
export const IAM_POLICY = Symbol('iam.AuthPolicy');
/** Vérification du téléphone par OTP (US-104). */
export const IAM_PHONE_VERIFICATION = Symbol('iam.PhoneVerification');

/** Horloge de l'application (millisecondes) : limiteurs et Max-Age du cookie seulement. */
export type Clock = () => number;
export const systemClock: Clock = () => Date.now();
