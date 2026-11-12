# IAM — port d’authentification (US-010, ADR-052)

Complément du README du module (fiche du module, US-035).

API publique (`index.ts`) :

| Export                                      | Usage                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `SessionGuard`                              | garde Nest d'une route authentifiée : 401 `AUTH_REQUIRED` si la session est absente, expirée, révoquée |
| `principalOf(request)`                      | principal posé par la garde (`userId`, `sessionId`, `mfaLevel`, `expiresAt`)                           |
| `AUTHENTICATION_PORT`, `AuthenticationPort` | port : `resolveSession(token)` ; l'implémentation se remplace sans toucher aux modules (ADR-021)       |
| `IamAuthModule.register(options)`           | routes `/auth` ; monté par l'API seulement (`api.module.ts`), jamais par le travailleur                |
| `postgresIamAdapters(pool)`                 | adaptateurs de production ; refuse une connexion qui n'est pas `app_api`                               |

Routes : `POST /auth/signup` (202, réponse identique si l'email existe ; US-102 : `acceptedDocuments` = versions affichées des CGU et de la confidentialité, `marketingOptIn` non pré-coché, `country` du parcours ; 409 `TERMS_VERSION_CHANGED`, 503 `LEGAL_DOCUMENT_UNAVAILABLE`, contrôlés avant l'email), `POST /auth/login` (cookie), `GET /auth/session`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/verify-email`. Corps de réponse `{ code, messageKey, values? }` : la clé est dans `@rueda/i18n` (es, en, fr, espace `common.auth.*`).

`IamAuthModule` est **global** : un module consommateur pose `@UseGuards(SessionGuard)` sans réimporter IAM. Le principal porte `emailVerified`, à exiger avant une action sensible (réserver, publier). `SessionGuard` exige aussi du JSON sur toute écriture gardée (CSRF).

Sécurité : argon2id (m = 64 MiB, t = 3, p = 1) ; jeton opaque de 256 bits, seul son SHA-256 en base ; cookie `__Host-session; HttpOnly; Secure; SameSite=Lax` ; jeton neuf à chaque connexion et révocation du jeton présenté (fixation) ; écritures en JSON seulement (CSRF) ; aucun jeton, mot de passe ni email dans les journaux ; débit limité par email et par IP.

Arborescence :

- `internal/` : `auth.service.ts` (adaptateur interne), `auth.controller.ts`, `session.guard.ts`, `password-hasher.ts`, `session-token.ts`, `cookies.ts`, `pg-auth-store.ts` (commandes `core.iam_*`), `policy.ts` (valeurs PROPOSÉES), `throttle.ts`, `notifier.ts` (port vers NTF), `uuid-v7.ts` ;
- `testing/` (**tests seulement**, exclu de la compilation de production) : `FakeAuthStore`, `RecordingIdentityNotifier`, contrat `AuthStore`, scénarios HTTP communs FAKE / PostgreSQL.

Tests : `pnpm --filter @rueda/api test:unit` (FAKE, sans base) ; `pnpm --filter @rueda/api test:int` (PostgreSQL réel sous `app_api`, banc de `@rueda/db` ; la CI fait foi). Schéma : `packages/db/migrations/0010_iam_identity.sql`, `0011_iam_auth_commands.sql`.

Paramètres PROPOSÉS (à inscrire au registre 17 §7.2) : durée de session 14 j (8 h staff, borne de la base) ; lien de vérification 24 h ; mot de passe ≥ 10 caractères, ≤ 1 024 octets ; 10 échecs par email, 100 par IP sur 15 min ; 20 inscriptions par IP et par heure.

## Consentements à l'inscription (US-102, ADR-091)

`PgAuthStore.registerAccount` appelle `core.iam_cmd_register_with_consents` : compte `PENDING_EMAIL` et consentements CGU + confidentialité (+ communications si l'opt-in est coché) dans la même instruction. La base refuse tout compte sans ces consentements (déclencheur différé `ctr_signup_consents_required`). Les versions affichées sont contrôlées avant l'écriture du compte : même issue que l'email soit libre ou pris. Lecture de l'état, réacceptation et révocation : module CTR (routes `/legal`, `TermsGuard`).

E-mails d'identité : `ChannelIdentityNotifier` (port `MessagingChannel` de NTF, textes `common.auth.emailVerification.*` / `common.auth.accountExists.*`, lien `<site>/verify-email?token=`) ; envoyé pendant la requête. Production : `PendingIdentityNotifier` tant qu'aucun adaptateur e-mail réel n'existe (lot C).

## Compte d'hôte (US-107, ADR-096)

`POST /host/accounts` (`SessionGuard`, `HostAccountController`) : corps `{ country, holderKind }` seulement. `holderKind` vaut `INDIVIDUAL` ; `LEGAL_ENTITY`, ou toute donnée de personne morale (`legalName`, `tradeName`, `companyName`, `businessName`, `companyTaxId`, `legalEntity`), rend 422 `HOST_ENTITY_NOT_ALLOWED` (DEC-FONDATEUR-13). Aucun nom n'est reçu : le nom affiché aux voyageurs est le prénom légal du titulaire, recopié par la base. Réponses : 201 `HOST_ACCOUNT_OPENED` + `orgId` (compte `ONBOARDING`) ; 400 `REQUEST_INVALID` ou `COUNTRY_UNKNOWN` ; 401 ; 403 `HOST_ACCOUNT_NOT_ELIGIBLE` (e-mail non vérifié, compte restreint) ; 409 `HOST_ACCOUNT_EXISTS` (un compte par personne et par pays) ; 422 `HOST_UNDER_AGE` ; 503 `HOST_ACCOUNT_UNAVAILABLE` (paramètre du pays absent). Commande `core.iam_cmd_open_host_account` (0061).

`GET /auth/session` rend aussi `roles` (`GUEST`, plus `P2P_HOST` pour le titulaire d'un compte d'hôte) et `hostAccounts` (`orgId`, `country`, `role`, `status`, `displayName`), lus par `core.iam_host_accounts`. Textes : `common.host.*` (es, en, fr, pt-BR). Ouverture par l'ops : action de console `CREATE_HOST_ACCOUNT` (module SUP, `POST /console/actions`).

## Téléphone par OTP (US-104, ADR-098)

Routes `PhoneController` (`SessionGuard` ; JSON exigé pour les écritures) :

| Route                | Réponses                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /phone`         | 200 : `verified`, `phone` (masqué), `pending` (numéro masqué, `resendAfterS`, `expiresInS`, `attemptsLeft`), `lockedForS`, `countries` (code, noms, indicatif, exemple) ; 401 ; 503 `OTP_UNAVAILABLE`                                                                                                                                                             |
| `POST /phone/otp`    | corps `{ phone, country }` ; 202 `OTP_SENT` (`values` : numéro masqué, `resendAfterS`, `expiresInS`), identique que le numéro soit libre ou pris ; 200 `PHONE_ALREADY_VERIFIED` ; 400 `REQUEST_INVALID`, `COUNTRY_UNKNOWN`, `PHONE_INVALID` ; 401 ; 403 `PHONE_NOT_ELIGIBLE` ; 429 `OTP_LOCKED`, `RATE_LIMITED` ; 503 `OTP_UNAVAILABLE`, `RATE_LIMIT_UNAVAILABLE` |
| `POST /phone/verify` | corps `{ code }` (6 chiffres) ; 200 `PHONE_VERIFIED` ; 400 `REQUEST_INVALID` (aucun essai compté), `OTP_INVALID` (`values.attempts`), `OTP_EXPIRED` ; 401 ; 409 `ACCOUNT_DUPLICATE_PHONE` ; 429 `OTP_LOCKED` (`values.minutes`) ; 503 `OTP_UNAVAILABLE`                                                                                                           |

- **Ordre de la demande** : session, corps, pays configuré, numéro normalisé (plan du pays, `countries.json` : mobiles seulement), e-mail vérifié, clé présente, état (blocage, renvoi, déjà vérifié), **plafonds** (`OtpSendGuard` = `AbuseGuard.checkCostlySend` : numéro, IP, compte, indicatif pays, plafond SMS du pays), puis la commande `core.iam_cmd_phone_otp_request`. Rien n'est écrit ni envoyé après un refus.
- **Code** : tiré par le travailleur `iam_otp_sender` (CSPRNG), envoyé par le port `MessagingChannel` (SMS) ; l'API ne voit jamais un code émis, seulement le code saisi, dont elle calcule l'empreinte HMAC-SHA-256 sous `RUEDA_OTP_KEY`. Clé absente : 503 `OTP_UNAVAILABLE`.
- **Paramètres** (par pays, lus par la base) : `otp_ttl_min` (10), `otp_max_attempts` (5), `otp_lock_min` (60), `otp_sms_fallback_s` (60) ; plafonds `rate_limit_otp_per_phone_hour`, `rate_limit_otp_per_ip_hour`, `otp_rate_per_account_hour` (5, PROPOSÉ), `otp_rate_per_prefix_hour` (300, PROPOSÉ), `rate_limit_sms_daily_cap`.
- **Paiement** : `PhoneVerifiedGuard` (403 `PHONE_NOT_VERIFIED`) à poser par US-209 après `SessionGuard`.
- Textes : `common.otp.*`, `common.error.phoneDigits`, écran `/verify-phone` (`web.s15.*`), es, en, fr, pt-BR.

## Console interne : MFA du staff (US-012, ADR-062)

`StaffConsoleModule.register(options)` (global, monté par l'API après `IamAuthModule`) exporte `StaffGuard` et `staffPrincipalOf(request)`. Une route de console pose `@UseGuards(StaffGuard)` :

- sans session : 401 ;
- sans rôle interne : 403 `FORBIDDEN` ;
- sans TOTP, enrôlement à finir, facteur verrouillé ou session non élevée : 403 `2FA_REQUIRED`.

Le principal porte `userId`, `roles` (rôle et pays) et `tokenHash`. Le `tokenHash` est la preuve de possession transmise aux commandes `core.iam_staff_*` ; il n'est jamais journalisé. Permissions et portée pays sont jugées par chaque commande, en base.

Routes :

- `GET /staff/me` : état d'accès et rôles ;
- `POST /staff/mfa/enroll` (`{ enrollmentCode }`) : rend `{ secret, otpauthUri }` une fois ;
- `POST /staff/mfa/verify` (`{ code, enrollmentCode? }`) ;
- `POST /staff/members/:id/suspend` (`{ reason }`) ;
- `POST /staff/members/:id/reset-totp` (`{ reason }`) : rend `{ enrollmentCode }` une fois ;
- `GET /staff/audit?before=&limit=`.

Les actions motivées sont dans SUP : `POST /console/actions`.

Fichiers (`internal/staff/`) :

- `totp.ts` (RFC 4226 / 6238, base32) ;
- `mfa-proof.ts` (preuve HMAC-SHA-256 v1, clé `RUEDA_STAFF_MFA_PROOF_KEY`) ;
- `secret-vault.ts` (port du coffre ; `UnavailableTotpVault` en production tant qu'US-003 n'a pas livré le coffre) ;
- `staff-store.ts` (commandes `core.iam_staff_*`, une instruction par appel) ;
- `staff.service.ts`, `staff.guard.ts`, `staff.controller.ts`, `production.ts`.

FAKE : `testing/fake-totp-vault.ts`. Codes : `FORBIDDEN`, `2FA_REQUIRED` (16 ADM-001) ; PROPOSÉS : `AUTH_TOTP_INVALID`, `AUTH_TOTP_LOCKED`, `STAFF_MFA_UNAVAILABLE`, `STAFF_ACTION_UNAVAILABLE`, `STAFF_ACTION_RECORDED`, `STAFF_ACTION_DONE` ; cadre des actions de console (US-101, ADR-092) : `STAFF_ACTION_REQUESTED`, `STAFF_ACTION_REFUSED`, `STAFF_SELF_APPROVAL`.

Paramètres PROPOSÉS :

- TOTP SHA-1, 6 chiffres, 30 s, fenêtre ±1 ;
- 5 échecs ⇒ verrou de 15 min (en base) ;
- code d'enrôlement de 80 bits, valable 24 h.
