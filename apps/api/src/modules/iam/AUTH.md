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

Routes : `POST /auth/signup` (202, réponse identique si l'email existe), `POST /auth/login` (cookie), `GET /auth/session`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/verify-email`. Corps de réponse `{ code, messageKey, values? }` : la clé est dans `@rueda/i18n` (es, en, fr, espace `common.auth.*`).

`IamAuthModule` est **global** : un module consommateur pose `@UseGuards(SessionGuard)` sans réimporter IAM. Le principal porte `emailVerified`, à exiger avant une action sensible (réserver, publier). `SessionGuard` exige aussi du JSON sur toute écriture gardée (CSRF).

Sécurité : argon2id (m = 64 MiB, t = 3, p = 1) ; jeton opaque de 256 bits, seul son SHA-256 en base ; cookie `__Host-session; HttpOnly; Secure; SameSite=Lax` ; jeton neuf à chaque connexion et révocation du jeton présenté (fixation) ; écritures en JSON seulement (CSRF) ; aucun jeton, mot de passe ni email dans les journaux ; débit limité par email et par IP.

Arborescence :

- `internal/` : `auth.service.ts` (adaptateur interne), `auth.controller.ts`, `session.guard.ts`, `password-hasher.ts`, `session-token.ts`, `cookies.ts`, `pg-auth-store.ts` (commandes `core.iam_*`), `policy.ts` (valeurs PROPOSÉES), `throttle.ts`, `notifier.ts` (port vers NTF), `uuid-v7.ts` ;
- `testing/` (**tests seulement**, exclu de la compilation de production) : `FakeAuthStore`, `RecordingIdentityNotifier`, contrat `AuthStore`, scénarios HTTP communs FAKE / PostgreSQL.

Tests : `pnpm --filter @rueda/api test:unit` (FAKE, sans base) ; `pnpm --filter @rueda/api test:int` (PostgreSQL réel sous `app_api`, banc de `@rueda/db` ; la CI fait foi). Schéma : `packages/db/migrations/0010_iam_identity.sql`, `0011_iam_auth_commands.sql`.

Paramètres PROPOSÉS (à inscrire au registre 17 §7.2) : durée de session 14 j (8 h staff, borne de la base) ; lien de vérification 24 h ; mot de passe ≥ 10 caractères, ≤ 1 024 octets ; 10 échecs par email, 100 par IP sur 15 min ; 20 inscriptions par IP et par heure.

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

FAKE : `testing/fake-totp-vault.ts`. Codes : `FORBIDDEN`, `2FA_REQUIRED` (16 ADM-001) ; PROPOSÉS : `AUTH_TOTP_INVALID`, `AUTH_TOTP_LOCKED`, `STAFF_MFA_UNAVAILABLE`, `STAFF_ACTION_UNAVAILABLE`, `STAFF_ACTION_RECORDED`, `STAFF_ACTION_DONE`.

Paramètres PROPOSÉS :

- TOTP SHA-1, 6 chiffres, 30 s, fenêtre ±1 ;
- 5 échecs ⇒ verrou de 15 min (en base) ;
- code d'enrôlement de 80 bits, valable 24 h.
