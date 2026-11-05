# ADR-077 — Matrice d'autorisations exécutable, tests de sécurité de l'API et gardes d'environnement fail-closed

- **Statut** : PROPOSÉ (US-043, agent back-end, claude-opus-5-5, 2026-11-03). Revues exigées : code, **sécurité** (story ; RLS, rôles, migration, `packages/db/`), QA, et architecture (`packages/db/`), sur un autre modèle que l'auteur. À reporter dans 17 §2.3, §6.6, §8.1 et dans 16 A.8.
- **Sources** : 19 US-043 ; 17 §2.3 (rôles SQL, matrice de permissions, « cloisonnement entre hôtes », RLS-1 à RLS-28, RLS-15), §6.5 point 1 (environnement de la base), §6.6 (exigences de sécurité), §11 (L0-05) ; 16 ADM-001 ; NOUVELLE-16 (minimisation) ; ADR-053 (RLS par acteur et par pays), ADR-062 (console), ADR-064 (rôle hôte), ADR-068 (T1 fail-closed), ADR-074 (contrat OpenAPI), ADR-075 (anti-abus).

## Contexte

Les politiques RLS, les droits par colonne et les gardes des routes existent (US-010 à US-062), chacun prouvé par sa story. Il manquait une vue d'ensemble **exécutable** : qui (acteur, rôle, pays, travailleur) lit ou écrit quoi (table, vue, route), et un contrôle qui fait échouer la CI quand une table ou une route apparaît sans décision. Trois reports visaient aussi la story : gardes `= 'production'` ouvertes sur un environnement NULL (US-025 : 0028, 0039), `RUEDA_API_TRUST_PROXY` derrière un répartiteur (revue sécurité d'US-052) et tests de sécurité de l'API (en-têtes, corps, CORS, erreurs).

## Décision

1. **Matrice de la base** : `packages/db/authorization-matrix.json`, une entrée par table ou vue des schémas `core`, `app`, `platform` de la base de production. Elle porte :
   - `droits` : privilèges EXACTS d'`app_api`, `app_worker` et `app_anon`, par table (`*`) ou par colonnes ;
   - `politiques` : politiques RLS (nom et commande) applicables à chaque rôle ;
   - `lecture` : pour chaque acteur d'`app_api`, le **prédicat exact** des lignes visibles (`tout`, `aucune` ou une condition SQL sur les colonnes, avec `:acteur`, `:org`, `:vehicules`, `:pays`, `:dossiers`) ;
   - `travailleurs` : le prédicat par nom de travailleur (`*` = tout autre nom ; `sans_nom` = `app_worker` sans contexte).

   Acteurs d'`app_api` : sans contexte, voyageur, hôte titulaire, co-hôte de portée `{v1}`, hôte qui pose l'`org_id` d'un compte dont il n'est pas membre, SUPPORT, OPS, FINANCE, ADMIN, SUPERADMIN de portée `{pays}`, ADMIN qui élargit sa portée dans le contexte, ADMIN sans session élevée. Les prédicats viennent de 17 §2.3 et des stories, jamais des politiques.

2. **Preuve de chaque cellule** (`test/l0/l0-us043-authorization-matrix.test.ts`), sous les rôles de production (L0-05), en PA et en PY :
   - inventaire sur la base de production : relations = matrice (une table ou une vue sans entrée fait échouer), RLS `ENABLE` + `FORCE`, vues `security_invoker`, droits égaux, aucun droit ni politique pour `PUBLIC`, aucune politique restrictive, aucun droit sur une séquence, `app_anon` n'exécute aucune fonction ;
   - écritures : tout `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` absent de la matrice est **exécuté** et doit rendre 42501 ;
   - lectures : dans UNE transaction `REPEATABLE READ` par acteur et par pays, les lignes visibles sous la RLS sont comparées à l'attendu calculé par la fixture `9900` (`test_fixture.us043_expected`, sous `migrator`, même instantané) : nombre, empreinte des identifiants et nombre par pays. Chaque relation lisible par `app_api` doit être peuplée dans chaque pays, sinon une cellule `aucune` ne prouverait rien.
3. **Matrice des routes** : `apps/api/security/route-matrix.json`, une entrée par route d'un contrôleur (`controllerRoutes()`, partagé avec le contrat OpenAPI) : `public`, `session` ou `staff` ; pour `staff`, la permission de 17 §2.3, les rôles qui l'ont et la portée (`pays` : IDOR entre pays testé ; `plateforme`). Preuves :
   - `test:unit` (`src/testing/route-matrix.test.ts`) sur l'`ApiModule` réel, adaptateurs en mémoire : complétude, anonyme ⇒ 401 hors `public`, compte sans rôle ⇒ 403 `FORBIDDEN`, staff sans TOTP ⇒ 403 `2FA_REQUIRED`, cookie forgé ⇒ 401, forçage d'`org_id`, de pays ou d'identité par en-tête, paramètre ou corps sans effet ;
   - `test:int` (`src/testing/route-matrix.int.test.ts`) sur PostgreSQL : chaque route × chaque acteur, staff par rôle et par pays, puis le même rôle sur le sujet de l'autre pays (IDOR) ; la permission est jugée par les commandes de la base.
4. **Durcissement HTTP** (`apps/api/src/http-hardening.ts`, appliqué par `main.ts`), PROPOSÉ :
   - en-têtes sur toute réponse : CSP `default-src 'none'; frame-ancestors 'none'`, HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP, CORP `same-site`, `Permissions-Policy`, `Cache-Control: no-store` par défaut ; `X-Powered-By` retiré ;
   - corps JSON et formulaire bornés à 100 Kio (la valeur implicite d'Express, désormais explicite et testée) ; au-delà, 413 `PAYLOAD_TOO_LARGE` ;
   - **aucun CORS** : l'API ne sert que des clients de même origine (mandataires `/api`) ;
   - filtre global `ErrorHygieneFilter` : une erreur HTTP sans corps métier est rendue `{ code, messageKey }` (`REQUEST_INVALID`, `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR` ; texte existant `common.auth.requestInvalid`, aucun texte nouveau). Les corps métier passent tels quels.
5. **Gardes d'environnement fail-closed** : migration `0048_security_env_guard_fail_closed` (six fonctions PAY réécrites avec `COALESCE(platform.deployment_env(), 'production')`, sans modifier les migrations fusionnées). Deux contrôles empêchent une nouvelle garde ouverte :
   - lint `sql-env-guard` (`pnpm lint:sql`) : toute lecture de l'environnement hors `COALESCE(…, 'production')` dans une migration est refusée, sauf les lectures historiques remplacées, listées une à une avec leur migration de remplacement dans `packages/db/env-guard-allowlist.json` ;
   - test L0 `l0-us043-env-guard` : `pg_proc` de la base de production, et environnement NULL ⇒ refus pour chaque fonction, en PA et en PY.
6. **`RUEDA_API_TRUST_PROXY`** : `docs/ops/ENV_VARS.md` explique que la variable est obligatoire derrière un répartiteur (sinon tous les compteurs par IP deviennent un seul compteur global), avec le nombre exact de sauts. La valeur par environnement reste à US-003.

## Failles trouvées et corrigées

| Faille                                                                                                                                                                                 | Correction                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Gardes « jamais un FAKE en production » ouvertes sur NULL : trigger des comptes PSP, `payment_cmd_record_operation`, `payment_cmd_receive_webhook`, `payment_cmd_register_submerchant` | 0048, lint, test L0        |
| `payment_startup_guard()` rendait NULL, que l'API lisait comme « pas production » : démarrage admis avec des comptes FAKE                                                              | 0048 (rend « production ») |
| Corps JSON illisible : le message de `JSON.parse` renvoyait un extrait du corps (donnée personnelle) au client                                                                         | `ErrorHygieneFilter`       |
| Route inconnue : « Cannot GET /…?email=… » renvoyait l'URL et sa requête                                                                                                               | `ErrorHygieneFilter`       |
| Aucun en-tête de sécurité ; `X-Powered-By: Express` exposé ; 413 au format brut d'Express                                                                                              | `applyHttpHardening`       |

Constat de la matrice des routes en CI (0049) : `GET /staff/audit` (SUPPORT), `GET /console/brand/versions[/{id}]` (tout rôle sans `brand.edit` sur tous les pays) et `GET /console/security/abuse` (rôle sans `security.read_abuse`, et ADMIN d'un pays sur le tableau de l'autre pays) étaient refusés en base, refus journalisé et aucune ligne rendue, mais l'API répondait **200 avec une liste vide**. Aucune donnée ne fuyait, mais le refus se présentait comme un succès (contraire à 16 ADM-001). Correction : migration `0049_staff_read_access_outcome`, `core.iam_staff_read_access(jeton, permission, portée)` (`iam_staff_owner`, liste blanche RLS-15, EXECUTE `app_api`, sans écriture, liste fermée des trois permissions), appelée par les stores PostgreSQL quand la lecture est vide ; la route répond alors 401 / 403. La matrice des routes distingue désormais les portées `pays`, `tous_les_pays` (marque commune : rôle sur tous les pays déclarés, ADR-067) et `sans_pays` (journal).

Défaut d'un test (corrigé, aucune cellule affaiblie) : la matrice des routes sur PostgreSQL appelait `POST /auth/logout` avec la session de l'acteur, révoquée pour toutes les routes suivantes (401 en cascade) ; chaque déconnexion utilise une session neuve du même acteur.

## Conséquences

- Toute nouvelle table, vue ou route exige une entrée de matrice revue (sécurité) : c'est voulu.
- La matrice de la base est longue (une entrée par relation). Elle est générée à la main avec les prédicats de 17 §2.3, jamais copiée des politiques ; un écart en CI est soit une erreur de la matrice (corrigée avec sa source), soit une faille (corrigée par migration).
- La fixture 9900 exécute un prédicat de la matrice en SQL dynamique sous `migrator`. Elle n'existe que dans la base de test (jamais dans la base de production du banc) ; la relation et les colonnes sont validées par le catalogue, les valeurs passent en paramètres liés.
- Les codes `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` et `INTERNAL_ERROR` sont PROPOSÉS (16 A.8) ; ils réutilisent le texte `common.auth.requestInvalid` (es, en, fr, pt). Un texte propre à chacun pourra suivre (story i18n).

## Limites

- Les routes de l'hôte n'existent pas encore : la règle « une route d'hôte rend 404 à l'hôte B sur l'identifiant de l'hôte A » (17 §2.3 point 5) est imposée par la matrice (`idor` obligatoire), et sera éprouvée par la première story qui ajoute une telle route.
- Les cellules des travailleurs sur une table vide sont comparées sur zéro ligne (aucune donnée de ces files dans le monde de test) ; les politiques qui les portent sont figées par l'inventaire.
- Contrôles d'ASVS niveau 2 retenus : liste complète, avec la preuve ou la story de chacun, dans [`docs/qa/STRATEGIE_TESTS.md`](../qa/STRATEGIE_TESTS.md) §3.9 (US-039) ; ceux couverts ici sont V4 (contrôle d'accès), V8.3 (données personnelles dans les erreurs), V12.1 (taille des requêtes), V13.1 (CORS), V14.4 (en-têtes). L'analyse des dépendances (`pnpm audit`, élevée et critique) et des secrets (gitleaks) refuse déjà la fusion (jobs `dependances` et `secrets` de `ci.yml`, inchangés).
