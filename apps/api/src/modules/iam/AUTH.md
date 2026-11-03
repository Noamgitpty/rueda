# IAM — port d’authentification (US-010, ADR-052)

Complément du README du module (une ligne, règle US-001).

API publique (`index.ts`) :

| Export                                      | Usage                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `SessionGuard`                              | garde Nest d'une route authentifiée : 401 `AUTH_REQUIRED` si la session est absente, expirée, révoquée |
| `principalOf(request)`                      | principal posé par la garde (`userId`, `sessionId`, `mfaLevel`, `expiresAt`)                           |
| `AUTHENTICATION_PORT`, `AuthenticationPort` | port : `resolveSession(token)` ; l'implémentation se remplace sans toucher aux modules (ADR-021)       |
| `IamAuthModule.register(options)`           | routes `/auth` ; monté par l'API seulement (`api.module.ts`), jamais par le travailleur                |
| `postgresIamAdapters(pool)`                 | adaptateurs de production ; refuse une connexion qui n'est pas `app_api`                               |

Routes : `POST /auth/signup` (202, réponse identique si l'email existe), `POST /auth/login` (cookie), `GET /auth/session`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/verify-email`. Corps de réponse `{ code, messageKey, values? }` : la clé est dans `@rueda/i18n` (es, en, fr, espace `common.auth.*`).

Sécurité : argon2id (m = 64 MiB, t = 3, p = 1) ; jeton opaque de 256 bits, seul son SHA-256 en base ; cookie `__Host-session; HttpOnly; Secure; SameSite=Lax` ; jeton neuf à chaque connexion et révocation du jeton présenté (fixation) ; écritures en JSON seulement (CSRF) ; aucun jeton, mot de passe ni email dans les journaux ; débit limité par email et par IP.

Arborescence :

- `internal/` : `auth.service.ts` (adaptateur interne), `auth.controller.ts`, `session.guard.ts`, `password-hasher.ts`, `session-token.ts`, `cookies.ts`, `pg-auth-store.ts` (commandes `core.iam_*`), `policy.ts` (valeurs PROPOSÉES), `throttle.ts`, `notifier.ts` (port vers NTF), `uuid-v7.ts` ;
- `testing/` (**tests seulement**, exclu de la compilation de production) : `FakeAuthStore`, `RecordingIdentityNotifier`, contrat `AuthStore`, scénarios HTTP communs FAKE / PostgreSQL.

Tests : `pnpm --filter @rueda/api test:unit` (FAKE, sans base) ; `pnpm --filter @rueda/api test:int` (PostgreSQL réel sous `app_api`, banc de `@rueda/db` ; la CI fait foi). Schéma : `packages/db/migrations/0200_iam_identity.sql`, `0201_iam_auth_commands.sql`.

Paramètres PROPOSÉS (à inscrire au registre 17 §7.2) : durée de session 14 j (8 h staff, borne de la base) ; lien de vérification 24 h ; mot de passe ≥ 10 caractères, ≤ 1 024 octets ; 10 échecs par email, 100 par IP sur 15 min ; 20 inscriptions par IP et par heure.
