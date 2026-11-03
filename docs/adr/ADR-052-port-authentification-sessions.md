# ADR-052 — Port d'authentification : adaptateur interne, sessions serveur à jeton opaque, commandes IAM `SECURITY DEFINER`

- **Statut** : PROPOSÉ (US-010, agent back-end, 2026-11-03). Revues code, architecture et **sécurité** requises, sur un autre modèle que l'auteur. À reporter dans 17 §8.1 (ligne ADR-021 : défaut appliqué) et dans la liste blanche RLS-15 (US-011).
- **Stories** : US-010 ; s'appuient dessus US-011 (RLS par acteur), US-012 (TOTP staff), NTF (envoi des emails). **Sources** : 17 §2.3, §3.1.4, §3.2.1, §6.6 ; 16 ACC-001 ; 08 BR-ACC-01 ; ADR-021 (en attente, défaut : implémentation interne derrière le port), ADR-044, ADR-048.

## Contexte

ADR-021 (« interne ou service géré ») n'est pas tranché. Le défaut de 19 US-010 est une implémentation interne **derrière un port**, pour pouvoir la remplacer sans toucher aux modules. La consigne interdit tout fournisseur réel et tout identifiant réel : seul un adaptateur `FAKE` existe pour les tests, jamais actif en production.

L'authentification a lieu **avant** qu'un acteur soit connu : aucun contexte `app.*` n'est posé, donc aucune politique RLS par acteur (US-011) ne peut s'appliquer à la lecture d'un hachage ou à l'ouverture d'une session.

## Décision

1. **Port.** Les autres modules ne voient que `AuthenticationPort.resolveSession(token)` et `SessionGuard` (exportés par `modules/iam/index.ts`). L'adaptateur interne (`AuthService`) s'appuie sur un port de persistance `AuthStore` : `PgAuthStore` en production, `FakeAuthStore` en test. Un **contrat commun** (`testing/auth-store-contract.ts`) tourne sur les deux (test:unit et test:int).
2. **FAKE jamais en production, par construction.** `testing/` est exclu de `tsconfig.build.json` : le FAKE n'existe pas dans `dist/`. Aucun interrupteur d'environnement ne choisit l'adaptateur ; `main.ts` monte toujours `postgresIamAdapters(pool)`. Un test vérifie l'exclusion et l'absence d'import.
3. **Mots de passe.** argon2id (`node:crypto`, natif depuis Node 24.7), format PHC, m = 64 MiB, t = 3, p = 1, sel 16 octets, empreinte 32 octets (PROPOSÉ). Normalisation NFKC. Vérification aux paramètres bornés de la chaîne stockée, comparaison en temps constant. Une contrainte `CHECK` de la base refuse toute valeur qui n'est pas une chaîne PHC argon2id.
4. **Sessions serveur.** Jeton opaque de 32 octets aléatoires (base64url) ; la base ne stocke que son SHA-256. Cookie `__Host-session; Path=/; HttpOnly; Secure; SameSite=Lax`, sans option pour retirer `Secure`. Expiration et révocation jugées par la base (`platform.now()`). Durée absolue 14 j (PROPOSÉ), ramenée par la base à 8 h pour un compte qui a un rôle interne (17 §3.2.1). La révocation est définitive (trigger `session_guarded_columns` : ni annulation, ni prolongation, ni changement de titulaire, quel que soit l'écrivain).
5. **Fixation de session.** Aucun identifiant fourni par le client n'est adopté : chaque connexion émet un jeton neuf et révoque (`ROTATED`) celui que présentait le navigateur. Le préfixe `__Host-` empêche un sous-domaine de poser le cookie.
6. **CSRF.** `SameSite=Lax` plus exigence `Content-Type: application/json` sur toutes les écritures (415 sinon).
7. **Anti-énumération (ACC-001).** Inscription : même réponse que l'email soit libre ou pris (seul l'email envoyé diffère). Connexion : même erreur et même coût (vérification argon2id factice) pour un email inconnu, un mauvais mot de passe, un compte fermé ou banni.
8. **Commandes IAM `SECURITY DEFINER` sous `migrator`** (migration 0201) : `core.iam_cmd_register`, `iam_cmd_verify_email`, `iam_auth_lookup`, `iam_cmd_open_session`, `iam_session_resolve`, `iam_cmd_revoke_session`, `iam_cmd_revoke_all_sessions`. `search_path` figé, noms qualifiés, aucun SQL dynamique, `EXECUTE` au seul `app_api`. `app_api` n'a **aucun** droit de table IAM. Les sessions sont désignées par l'empreinte du jeton (preuve de possession), jamais par un identifiant de personne, sauf l'ouverture qui suit la vérification du mot de passe. Propriétaire `migrator`, pour la même raison qu'ADR-048 (`migrator` ne peut pas céder une fonction à un propriétaire `NOLOGIN` sans en être membre). **Famille `iam_auth`** à inscrire dans la liste blanche RLS-15.
9. **Journaux.** Aucun jeton, mot de passe ni email : `PgAuthStore` remplace toute erreur de la base par une erreur qui ne garde que le SQLSTATE ; le principal est rangé dans une `WeakMap`, pas sur la requête. Un test capture le logger Nest, stdout et stderr pendant les parcours et y cherche les secrets.
10. **Démarrage.** L'API refuse de démarrer si sa connexion n'est pas `app_api` sans `SUPERUSER` ni `BYPASSRLS` (L0-05 appliqué à la production). Connexion par les variables standard de libpq (`PGHOST`, `PGUSER`, `PGPASSWORD`…) : aucun secret dans le code ni dans une URL.
11. **Débit.** Limiteur en mémoire à fenêtre fixe (10 échecs par email et 100 par IP sur 15 min, 20 inscriptions par IP et par heure, PROPOSÉ). Clés hachées.

## Écarts avec 17 (à reporter dans 17 §3.2.1 par l'orchestrateur)

- `user_account.email` : `text` en minuscules (CHECK) au lieu de `citext` (aucune extension de plus à l'amorçage).
- `user_account.status` : ajout de `PENDING_EMAIL` (16 ACC-001).
- `session` : ajout de `token_hash` et `revoked_reason`.
- `staff_role_assignment.country_scope text[] NN` (17 §2.3, portée par pays).
- `role_permission` : colonnes de configuration versionnée.

## Conséquences

- (+) Remplacer l'adaptateur (service géré si ADR-021 le décide) ne touche ni les modules ni les gardes.
- (+) Une fuite de la base ne livre ni mot de passe ni jeton utilisable.
- (−) **Limite** (17 §2.3, RLS-18) : du SQL arbitraire sous `app_api` peut appeler ces commandes, par exemple ouvrir une session pour un compte. La parade reste l'absence de SQL construit côté API.
- (−) Limiteur par processus : contournable par répartition sur plusieurs instances. Limite partagée à faire avant l'ouverture élargie.
- (−) Les comptes restent `PENDING_EMAIL` tant que NTF n'envoie pas les emails (le notificateur de production n'envoie rien et le journalise, sans donnée personnelle).

## Options écartées

- Jeton signé sans état (JWT) : révocation immédiate impossible sans liste de révocation ; 17 §6.6 demande des sessions serveur.
- Droits de table directs pour `app_api` avec une politique `USING (true)` : expose toutes les lignes à un filtre oublié.
- Propriétaire dédié `iam_auth_owner` : souhaitable (17 §2.3, un propriétaire par famille), mais impossible sans changer l'amorçage (ADR-044) ; **PROPOSÉ** à la revue sécurité pour une story d'amorçage.
- Bibliothèque argon2 native (`argon2`, `@node-rs/argon2`) : dépendance de build native inutile depuis Node 24.7.
