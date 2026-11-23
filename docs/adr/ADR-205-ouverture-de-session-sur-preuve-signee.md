# ADR-205 — Ouverture de session sur preuve signée (HMAC) : fermeture de F-RLS-03

- **Statut** : PROPOSÉ (US-410, S-07 ; agent de story, rôle back-end, claude-opus-5-5, 2026-11-23). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` (code, architecture, sécurité, qa) ; sécurité, RLS / rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Ferme** : F-RLS-03 (ADR-089), EXC-003 (`docs/team/DECISIONS.md` §3), RT-RLS-03 et L0-PM-13 (`docs/team/RISKS.md`), condition GL-01 de `docs/ops/GO_LIVE_CHECKLIST.md`. **Complète** : ADR-052 (sessions serveur, US-010), ADR-062 (preuve d'élévation MFA, même construction), ADR-082 (rotation sans coupure).
- **Sources** : BOARD, fiche US-410 (critères 1 à 6) ; 17 §2.3 RLS-18 (« contexte forgeable sous SQL arbitraire » ; parade « contexte signé ») et §6.6 (secrets, rotation) ; revue sécurité de la PR n° 92 (n° 3) ; pré-mortem du lot 4, L4-PM-01 à L4-PM-05 et scénarios RT-L4-S01 à S05.

## Contexte

`core.iam_cmd_open_session(session, compte, empreinte, durée, …)` (0011, 0033) est une commande `SECURITY DEFINER` appelée par l'API après la vérification du mot de passe. Elle faisait confiance à son appelant : du SQL arbitraire sous `app_api` (une injection) ouvrait une session **persistante** pour n'importe quel compte, avec un jeton choisi par l'attaquant. Le test RT-RLS-18 caractérisait cette limite. EXC-003 l'acceptait pour la bêta et la rendait bloquante pour la production.

Deux parades étaient admises par la fiche : un **contexte signé** (HMAC d'un secret que `app_api` ne lit pas) ou un **rôle de connexion distinct** de celui des requêtes métier.

## Décision

### 1. Contexte signé HMAC (choix)

La commande n'ouvre une session que sur une **preuve** : HMAC-SHA-256 calculé par l'API sous une clé de son coffre (`RUEDA_SESSION_OPEN_KEY`), recalculé par la base sous la même clé, gardée dans `core.iam_session_open_key`. Cette table est lue par `iam_auth_owner` seulement, le propriétaire de la commande. Aucun rôle applicatif n'y a de droit, aucune fonction exécutable par eux ne rend la clé, aucun réglage `app.*` ne la porte. Du SQL arbitraire sous `app_api` peut appeler la commande, mais il ne peut pas signer.

**Pourquoi pas le rôle de connexion distinct.** Il demande un quatrième rôle de connexion (et son mot de passe, sa rotation, son pool dans l'API), une modification de l'assertion L0-05 et des rôles de production des tests, et touche le harnais de CI (`scripts/ci/`, revue sécurité au SHA fusionné). Il ne protège pas mieux : un attaquant qui lit la mémoire de l'API obtient le mot de passe du rôle aussi bien que la clé HMAC. Le contexte signé reprend une construction déjà relue et en service (preuve MFA, ADR-062 ; rotation, 0053), et ne change ni les rôles ni le harnais.

### 2. Message signé (forme v1)

UTF-8(`rueda-session-open-v1`) ‖ UUID de session (16 octets) ‖ UUID du compte (16) ‖ empreinte SHA-256 du jeton (32) ‖ durée demandée (int4 gros-boutiste) ‖ instant d'émission en millisecondes (int8 gros-boutiste). Changer un seul champ rend la preuve fausse.

- **Pas de rôle ni de pays** dans le message : une session ne porte ni l'un ni l'autre (17 §6.6). Le rôle de staff est relu en base à chaque commande. Le niveau MFA est imposé à `NONE` par la commande (0033).
- **Adresse IP et agent utilisateur** ne sont pas signés : ce sont des informations, pas des droits. Une preuve capturée ne permet pas de les changer utilement, puisqu'elle est à usage unique.

### 3. Fraîcheur, usage unique, comparaison

- **Fraîcheur** : l'instant est celui de `platform.now()`. L'API le lit juste avant de signer (`SELECT … platform.now()`), ce qui évite tout écart d'horloge entre l'API et la base et suit l'horloge virtuelle des tests. La base refuse une preuve émise plus de 60 s avant l'appel ou plus de 5 s après (`session_proof_expired`).
- **Usage unique** : la session (clé primaire) et l'empreinte du jeton (`session_token_unique`) sont uniques. Un rejeu, même session ou même jeton, est refusé `session_proof_replayed`. Deux rejeux concurrents se départagent sur l'index unique : le second attend la fin du premier, puis il est refusé. L'exception `unique_violation` est traduite en 42501 dans la commande.
- **Comparaison** : sur les empreintes SHA-256 des deux preuves, pas sur les preuves. Le temps de la comparaison ne dépend pas des octets communs de la preuve fournie, puisque l'attaquant ne contrôle pas l'empreinte.
- **Ordre** : la preuve est jugée **avant** toute lecture du compte. Sans preuve valable, la commande ne dit rien de l'existence ni de l'état d'un compte.

### 4. Échec fermé

Tous les refus sont `42501` (`insufficient_privilege`), avec un message court (`session_proof_unavailable`, `session_proof_refused`, `session_proof_expired`, `session_proof_replayed`), sans valeur. Sans clé installée en base, aucune session ne s'ouvre. Côté API, `RUEDA_SESSION_OPEN_KEY` absente fait refuser l'ouverture sans appel. Mal formée, elle empêche l'API de démarrer, sans afficher la valeur. L'erreur remonte comme une `AuthStoreError` (500, sans message de la base) : aucun texte visible nouveau.

### 5. Provisionnement et rotation sans coupure

Comme la clé MFA (0053, ADR-082) : deux emplacements en base, 1 pour la clé courante et 2 pour la suivante. Pendant une rotation, la base accepte les deux. L'ancienne cesse d'être acceptée **24 h** au plus après la pose de la suivante, même sans `PROMOTE` : cette fenêtre est bornée en base. Les gestes `INSTALL`, `STAGE`, `PROMOTE` et `ABORT` passent par `core.iam_session_open_key_rotate`, sous `migrator` seulement (EXECUTE accordé à personne). La CLI est `node packages/db/src/rotation/cli.ts session-open-key <geste>`, avec `RUEDA_SESSION_OPEN_KEY_NEXT`. Ordre d'une rotation : `STAGE`, redéploiement de l'API avec la nouvelle clé, `PROMOTE`. Les sessions déjà ouvertes ne dépendent d'aucune clé (jeton opaque) : une rotation ne coupe personne.

- Runbook : `docs/ops/SECRET_ROTATION.md` § 3.4 (cloud, par le fondateur) et § 4.4 (préproduction locale, rejouée par le job CI « reprise », étape 2d de `scripts/ops/rotation-drill.sh`).
- IaC : contenant `session_open_key` (`infra/opentofu/modules/environment/secrets.tf`), injecté dans la seule tâche `api`.
- Inventaire : `RUEDA_SESSION_OPEN_KEY` et `RUEDA_SESSION_OPEN_KEY_NEXT` dans `docs/ops/ENV_VARS.md`.

### 6. Compatibilité (expand / contract)

L'ancienne signature à 7 arguments est **supprimée** dans la même migration (0185), et non gardée le temps d'un déploiement : la garder laisserait la faille ouverte. Aucune version de l'API n'est servie en production (GL-01). En préproduction, une instance de l'ancienne version encore servie pendant un déploiement voit ses connexions refusées : l'échec est fermé, la faille n'est pas rouverte. L'exception est déclarée et motivée dans `packages/db/expand-contract-allowlist.json`.

### 7. Tests

- `packages/db/test/l0/l0-us410-session-open-proof.test.ts` (L0, rôles de production, PA et PY) : témoin ; refus pour une preuve absente, tronquée, allongée, au hasard, signée sous une autre clé, ou d'un champ modifié ; preuve périmée ou datée du futur ; rejeu séquentiel et **concurrent** (deux connexions, attente prouvée par `pg_locks`) ; clé absente ; rotation `STAGE`, `PROMOTE`, `ABORT` et fenêtre de 24 h ; recherche de la clé sous `app_api`, `app_worker` et `app_anon` dans la base de **production** du banc (droits, rôle `iam_auth_owner`, fonctions, réglages) ; aucune session ouverte dans cette base, faute de clé.
- **RT-RLS-18 inversé** (`rt-rls-actors.test.ts`) : refus sous les trois rôles, contre un compte de staff et contre l'hôte de chaque pays, avec un témoin signé qui réussit.
- Les tests qui ouvrent une session la signent avec une clé de **test publique** (fixture 9901, `TEST_SESSION_OPEN_KEY` de `@rueda/db/testing`), recalculée par `node:crypto`. Aucune aide n'ouvre une session sans preuve.

## Conséquences

- F-RLS-03 est fermé : une injection SQL sous `app_api` ne permet plus d'ouvrir une session au nom d'un compte. Elle garde ses autres effets, bornés par la RLS (RLS-18 reste vraie pour le contexte `app.*` d'une transaction).
- Hors périmètre, à ne pas confondre : `core.iam_auth_lookup` rend toujours l'empreinte argon2id du mot de passe à `app_api`, car l'API la vérifie (revue sécurité US-011 n° 3). C'est un risque de lecture, pas d'ouverture : l'empreinte ne suffit pas à ouvrir une session, il faut la preuve. Les trois contournements connus de `rueda/no-dynamic-sql` (N-10) restent à fermer dans `packages/config/` (un autre propriétaire de chemins).
- **Action du fondateur** (aucun agent n'a d'accès au cloud) : tirer la clé dans le contenant `session_open_key` de chaque environnement, puis `INSTALL` en base **avant le premier déploiement** (sans clé, aucune connexion ne marche), comme le décrit `SECRET_ROTATION.md` § 3.4. La clé de production n'existe pas encore. Jusque-là, seule la CI tire des clés, au hasard, pour la répétition.
- Une ouverture de session coûte un aller-retour de plus vers la base (lecture de `platform.now()`) et un HMAC en SQL. C'est négligeable devant le hachage argon2id du mot de passe.
