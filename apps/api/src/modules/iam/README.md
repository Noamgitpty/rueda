# IAM — Identity & Access (`apps/api/src/modules/iam`)

**IAM — Identity & Access** : comptes, authentification, sessions, organisations, rôles et permissions, restrictions. Dépendances autorisées : CFG, NTF (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 (NTF : envoi OTP)). Port d’authentification, sessions et routes `/auth` (US-010) : voir `AUTH.md` et ADR-052.

## Responsabilité

D'après 17 §2.2 : comptes, authentification (mot de passe, OTP, TOTP du staff), sessions, compte d'hôte (`organization` de type `P2P_HOST_INDIVIDUAL`, une personne physique) et co-hôtes, rôles et permissions, restrictions de compte, blocage d'un voyageur par un hôte. IAM ne vérifie pas l'identité (KYC) et n'envoie pas lui-même de message (NTF).

État du code :

- **livré** : inscription, vérification de l'e-mail, connexion, sessions, déconnexion, garde `SessionGuard` et port `AuthenticationPort` (US-010, ADR-052) ; inscription avec consentements versionnés (CGU, confidentialité, communications ; US-102, ADR-091) et envoi des e-mails d'identité par un canal NTF (`ChannelIdentityNotifier`) ; MFA TOTP du staff et garde de la console interne `StaffGuard` (US-012, ADR-062) ; coordonnées des destinataires pour NTF (US-021, ADR-061) ; permissions de l'hôte `app.has_permission` en base (US-062) ; compte d'hôte d'une personne physique (US-107, ADR-096) : ouverture en libre-service (`POST /host/accounts`) ou par l'action de console `CREATE_HOST_ACCOUNT`, rôles et comptes d'hôte dans `GET /auth/session` ; vérification du téléphone par OTP (US-104, ADR-098) : routes `/phone`, envoi asynchrone par le travailleur `iam_otp_sender` (code tiré dans le travailleur, empreinte HMAC sous `RUEDA_OTP_KEY`), purge `iam_otp_pruner`, contrôle bloquant `PhoneVerifiedGuard` pour le paiement (US-209) ;
- **pas encore** : canal SMS réel (lot C : `FAKE` seulement, rien n'est envoyé en production), WhatsApp (lot 5), détection du type de ligne (VoIP), restrictions, invitations de co-hôtes, blocage voyageur, émission d'événements (dont `iam.organization.created`), activation du compte d'hôte (US-123). L'envoi réel de l'e-mail de vérification attend le câblage NTF : `PendingIdentityNotifier` n'envoie rien (fail-closed, le compte reste en attente).

Détail des routes, de la sécurité et des paramètres PROPOSÉS : [`AUTH.md`](AUTH.md).

## Entités

Entités de 17 §3.2.1 :

| Entité                  | État en base                                             |
| ----------------------- | -------------------------------------------------------- |
| `user_account`          | table `core.iam_user_account` (migration 0010)           |
| `email_verification`    | table `core.iam_email_verification` (migration 0010)     |
| `auth_factor`           | table `core.iam_auth_factor` (migration 0010, TOTP 0033) |
| `session`               | table `core.iam_session` (migration 0010)                |
| `otp_challenge`         | table `core.iam_otp_challenge` (0010 ; écrite par 0066)  |
| `organization`          | table `core.iam_organization` (0010 ; écrite par 0061)   |
| `membership`            | table `core.iam_membership` (0010 ; écrite par 0061)     |
| `staff_role_assignment` | table `core.iam_staff_role_assignment` (migration 0010)  |
| `role_permission`       | table `core.iam_role_permission` (migration 0010)        |
| `restriction`           | table `core.iam_restriction` (migration 0010)            |
| `org_guest_block`       | cible 17, pas encore créée                               |

Objets propres au code, hors entités de 17 : `core.iam_mfa_proof_key` (clé de preuve MFA, migration 0033) ; fonction `core.iam_notification_contact` (coordonnées pour le seul travailleur `ntf_sender`, migration 0031). Commandes `SECURITY DEFINER` : `core.iam_cmd_*` (0011), `core.iam_staff_cmd_*` (0033, 0034). Détail : `packages/db/README.md`, sections « Schéma IAM » et « MFA du staff et console interne ».

## Événements

Émis (US-104, migration 0066) : `iam.otp.requested` (`challenge_id` seulement ; consommé par IAM lui-même, travailleur `iam_otp_sender`, PROPOSÉ, à reporter dans 17 §4.5) et `iam.phone.verified` (`user_id`, `channel`, `line_type`, 17 §4.5).

Cible (17 §2.2, §4.5) :

- émis : `iam.user.registered`, `iam.phone.verified`, `iam.restriction.applied` / `.lifted`, `iam.membership.changed` (§2.2), `iam.membership.invited`, `iam.organization.created`, `iam.organization.status_changed` (§4.5) ;
- consommés : `kyc.host_verification.decided` (statut du compte d'hôte), `legal.consent.recorded`, `payment.chargeback.opened` (restriction).

## Ports

Ports exposés aux autres modules (`index.ts`) :

- authentification : `AUTHENTICATION_PORT` / `AuthenticationPort` (`resolveSession`), `SessionGuard`, `principalOf`, `AuthenticatedPrincipal`, `sessionProofOf` (empreinte du jeton, preuve de possession pour les commandes de CTR, US-102) ; montage `IamAuthModule`, `IamAuthOptions`, `postgresIamAdapters`, `SqlExecutor`, `AuthHttpError` ;
- console interne : `StaffConsoleModule`, `StaffGuard`, `staffPrincipalOf`, `StaffOptions`, `StaffPrincipal`, `StaffRole`, `postgresStaffAdapters` ;
- pour NTF : `postgresNotificationContacts` (adaptateur du port `RecipientDirectory` de NTF) ;
- téléphone par OTP (US-104) : `PhoneVerifiedGuard` (contrôle bloquant du paiement, US-209), `PhoneOtpOptions`, `OtpSendGuard` / `OtpSendRequest` (port des plafonds, implémenté par `AbuseGuard` de RISK et injecté par `main.ts`), `OtpSender`, `registerPhoneOtp`, `IAM_OTP_SENDER_WORKER`, `IAM_OTP_PRUNER_WORKER` (travailleur), `OtpCodeHasher`, `otpHasherFromEnv`.

Ports sortants internes : `IdentityNotifier` (`internal/notifier.ts`, vers NTF ; production : `PendingIdentityNotifier`), `TotpSecretVault` (`internal/staff/secret-vault.ts` ; production : `UnavailableTotpVault` tant que le coffre d'US-003 manque), `AuthStore` et `StaffStore` (adaptateurs PostgreSQL). FAKE et contrats : `testing/` (tests seulement, exclu de la compilation de production) ; aucun adaptateur de `@rueda/fake-adapters`.

## Commandes de test

- Unitaires (vitest, sans base ; config `apps/api/vitest.config.ts`) : `pnpm --filter @rueda/api exec vitest run src/modules/iam` (`internal/*.test.ts`, `internal/staff/*.test.ts`, `internal/phone/*.test.ts`, `testing/fake-auth-store.test.ts`, `testing/*.contract.test.ts` dont `phone.contract.test.ts`).
- Intégration (PostgreSQL réel, sous `app_api`) : `pnpm --filter @rueda/api test:int` ; fichiers du module : `internal/pg-auth-store.int.test.ts`, `internal/staff/pg-staff-store.int.test.ts`. Schéma : `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/iam-schema.test.ts`.
- Preuves L0 en base : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/iam-sessions.test.ts test/l0/l0-iam-staff-mfa.test.ts test/l0/l0-staff-console.test.ts test/l0/l0-us104-phone-otp.test.ts` ; RLS par acteur : `test/l0/l0-rls-actors.test.ts`, `test/l0/l0-rls-columns.test.ts`.

- Contrat HTTP (US-041, sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/iam/testing/auth.contract.test.ts` — chaque réponse des routes `/auth` est confrontée à `apps/api/openapi/openapi.json` (corps, codes stables, `Cache-Control`, cookie). Une route ou un code d'erreur nouveau se déclare d'abord dans ce contrat.

Les tests d'intégration et L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
