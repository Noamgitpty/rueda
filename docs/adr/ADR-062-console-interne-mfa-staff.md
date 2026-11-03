# ADR-062 — Console interne : TOTP obligatoire du staff, session élevée liée à la RLS, commandes de console journalisées

- **Statut** : PROPOSÉ (US-012, agent back-end, 2026-11-03). Revues code, **sécurité** (RLS, rôles, `SECURITY DEFINER`, cryptographie, sur un autre modèle que l'auteur) et UX requises ; architecture aussi, car `packages/db/` est touché. À reporter dans 17 §8.1.
- **Stories** : US-012 ; s'appuient dessus US-101 (dossiers), US-107 (création de compte d'hôte), US-208 et les stories d'annulation / no-show (commandes de domaine), US-534 (12 rôles), US-003 (coffre géré). **Sources** : 16 ADM-001, NFR-08 ; 17 §2.3 (matrice, « Limite de la RLS » B8, RLS-18), §3.2.1, §3.2.13, §10 ; ADR-052, ADR-053, ADR-056, ADR-051.

## Contexte

16 ADM-001 exige un TOTP pour tout rôle interne, une matrice rôle × permission en base, un 403 journalisé pour toute action interdite et un journal en ajout seul. Les passations laissaient quatre reports :

- US-010 : `p_mfa_level` libre dans `iam_cmd_open_session` ;
- US-011 : la limite RLS-18. Une identité d'ADMIN forgée sous `app_api` obtient ses lectures, et des sessions persistantes sont forgeables. Il faut la réduire avant le premier compte staff réel. `config_param_value.approved_by` reste lisible par `app_api` ;
- US-007 / ADR-056 : la forme d'appel « un appel = une instruction » ;
- US-009 : l'audit doit être écrit en dernier.

## Décision

1. **Session née sans MFA.** `iam_cmd_open_session` refuse tout niveau autre que `NONE` (`22023`), et la politique d'insertion d'`iam_auth_owner` l'exige aussi. Le seul chemin vers `TOTP` est `core.iam_staff_cmd_elevate`.
2. **TOTP** : RFC 6238, HMAC-SHA-1, 6 chiffres, pas de 30 s, fenêtre ±1 (PROPOSÉ, compatible avec les applications courantes).
   - Le secret n'est jamais en base. `auth_factor.secret_ref` pointe vers un coffre, port `TotpSecretVault`.
   - En production, `UnavailableTotpVault` est utilisé tant qu'US-003 n'a pas livré le coffre géré : aucune élévation n'est possible (fail-closed). En test, on utilise `FakeTotpSecretVault`, refusé hors `RUEDA_ENV` = `development` | `test`.
   - L'API vérifie le code. La base juge seule :
     - le pas est à ±1 de `platform.now()` ;
     - le pas est strictement supérieur au dernier pas consommé (anti-rejeu) ;
     - chaque tentative est **comptée sous `FOR UPDATE` avant que la référence du secret ne sorte** (`iam_staff_cmd_mfa_attempt`, `iam_staff_cmd_enroll_reveal`) : au plus 5 tentatives, la 6e verrouille 15 min (PROPOSÉ) ; une élévation réussie remet le compteur à zéro. Des requêtes parallèles ne dépassent donc jamais 5 tentatives (revue sécurité, MAJEUR 1 ; preuve L0 à 16 tentatives concurrentes). `iam_staff_cmd_begin` ne rend jamais la référence du secret et ne compte rien ;
     - limiteur de débit en mémoire sur `/staff/*` : toute requête par IP (120 / min), tentatives MFA par IP (30 / 15 min) et par compte (10 / 15 min), 429 `RATE_LIMITED` (PROPOSÉ ; le verrou de la base fait foi entre instances).
3. **Preuve d'élévation (réduction de RLS-18).**
   - L'API envoie `HMAC-SHA-256(clé, "rueda-staff-mfa-v1" ‖ SHA-256(jeton) ‖ UUID du facteur ‖ pas)`. La base la recalcule avec `core.iam_hmac_sha256`, écrit sur `sha256()` natif sans extension et vérifié par les vecteurs RFC 4231.
   - La clé se trouve dans `core.iam_mfa_proof_key`, lisible par le seul `iam_staff_owner`.
   - Du SQL arbitraire sous `app_api` peut ouvrir une session pour un ADMIN connu (limite d'US-010). Il ne peut plus l'élever.
   - La clé est un secret géré (`RUEDA_STAFF_MFA_PROOF_KEY` côté API). La même valeur est installée en base par l'exploitation, sous `migrator` (§ Procédures). Aucune valeur n'est dans le dépôt.
   - Sans clé, aucune élévation n'est possible.
4. **Contexte STAFF lié à une session élevée.**
   - `app.has_staff_role` et `app.staff_case_covers` (remplacés sous `policy_fn_owner`, par `SET LOCAL ROLE`, ADR-044 amendé) exigent en plus que `app.session_token_hash` désigne une session de l'acteur. Cette session doit être vivante, non révoquée et de niveau `TOTP`.
   - Le paramètre est posé par `setSessionContext`, qui passe de six à sept paramètres ; `sessionTokenHash` est obligatoire pour `STAFF`.
   - **Session élevée bornée à 8 h** (revue sécurité, MAJEUR 2) : l'élévation pose `expires_at = LEAST(expires_at, platform.now() + 8 h)`, même pour une session ouverte avant l'attribution du rôle (durée de client) ; jamais de prolongation (`session_guarded_columns`). Preuve L0.
   - Effets :
     - connaître l'UUID d'un ADMIN ne donne plus rien ;
     - un rôle sans MFA ne lit rien ;
     - une suspension ou une révocation coupe aussitôt les lectures.
5. **Commandes de console.** Une commande `core.iam_staff_*` (`SECURITY DEFINER`, propriétaire `iam_staff_owner`, `EXECUTE` au seul `app_api`) représente un appel en autocommit (ADR-056). Chaque commande :
   - retrouve la session par l'empreinte du jeton (preuve de possession) ;
   - exige le niveau `TOTP` ;
   - relit en base les rôles en cours, leur portée pays et la matrice `iam_role_permission` ;
   - relit le pays du sujet (jamais reçu du client) ;
   - agit ou refuse, puis écrit l'audit **en dernier**.

   Un refus ne lève pas d'erreur : il est journalisé (`STAFF_ACCESS_DENIED` pour la MFA, `STAFF_FORBIDDEN` pour la permission, la portée pays ou un sujet introuvable), puis l'issue est rendue et l'API répond 403. Un sujet introuvable et un sujet hors portée donnent la même issue, pour qu'il n'y ait pas d'oracle d'existence. Les commandes sont les suivantes :
   - `iam_staff_cmd_manual_action` : `manual_action` (17 §3.2.13), catalogue fermé `support_manual_action_catalog` et idempotence `(action_code, subject_id, request_id)`. Une action dont la commande de domaine n'existe pas encore (`CANCEL_TRIP_PLATFORM`, `DECLARE_NO_SHOW`) rend `UNAVAILABLE`, journalisé, sans simuler de changement d'état (17 §10 NN9). `RECORD_CLAIM` (enregistrement seul) est disponible ;
   - `iam_staff_cmd_suspend` : tous les rôles en cours prennent fin (`expires_at` = maintenant), toutes les sessions sont révoquées (`ADMIN`) et les facteurs sont désactivés. Le membre perd tout ;
   - `iam_staff_cmd_reset_totp` : réinitialisation par un **autre** membre (16 ADM-001). Elle crée un nouveau facteur en attente et un code d'enrôlement de 80 bits, rendu une fois à l'auteur et remis hors bande ; seule son empreinte est stockée (24 h, PROPOSÉ) ;
   - `iam_staff_audit_read` : `audit.read`. ADMIN et SUPERADMIN lisent tout le journal ; OPS et FINANCE (« lim. ») lisent leurs propres lignes. Jamais d'IP chiffrée.

6. **Autorité sur un membre du staff.**
   - Jamais sur soi-même.
   - Il faut `iam.staff_roles_write` sur **tous** les pays des rôles en cours de la cible.
   - Une cible ADMIN ou SUPERADMIN ne peut être visée que par un SUPERADMIN (17 §2.3 : ADMIN « lim. (non-admin) »).
7. **Matrice.** Seules les permissions des commandes d'US-012 sont semées : `ops.platform_cancel`, `trip.declare_no_show`, `claim.declare`, `iam.staff_roles_write`, `audit.read`, colonnes staff de 17 §2.3. `app.has_permission` reste à US-062.
8. **Domaine distinct.** Le back-office appelle l'API par un mandataire de même origine (`/api/*` → `RUEDA_API_URL`). Le cookie `__Host-session` reste lié au domaine du back-office.
9. **Report US-011.** `approved_by` de `config_param_value` n'est plus lisible par `app_api` (lecture par colonnes).
10. **Journal borné au pays** (décision de l'orchestrateur, fail-closed, entrée de `docs/team/COMME_TURO.md`).
    - Chaque ligne écrite par la console porte ses pays dans `after.countries`. Ils sont dérivés de l'action et de sa cible par `core.iam_staff_audit_countries`, jamais reçus du client :
      - pays relu par la commande ;
      - pays du trip ;
      - pays des rôles de la cible ;
      - à défaut, pays des rôles de l'acteur.
    - Ces pays entrent dans le hachage chaîné, donc ils sont immuables. Un tableau vide désigne une action **globale**.
    - `iam_staff_audit_read`, seul chemin de lecture du journal pour `app_api` (aucun droit `SELECT` ni politique `app_api` sur `audit_audit_log`), rend :
      - à un SUPERADMIN : tout le journal ;
      - à un ADMIN : les lignes dont tous les pays sont dans la portée de ses rôles ADMIN en cours, et les lignes globales seulement s'il est ADMIN de **tous** les pays de `config_country` ;
      - à OPS, FINANCE et à chacun : ses propres lignes.
    - Les lignes écrites hors console (sans `countries`) sont globales.

## Procédures hors application (runbook US-405 à compléter)

- **Clé de preuve** : générer 32 octets aléatoires dans le gestionnaire de secrets, les fournir à l'API (`RUEDA_STAFF_MFA_PROOF_KEY`, en hexadécimal) et les insérer en base sous `migrator` (`INSERT INTO core.iam_mfa_proof_key (id, key) VALUES (1, …)`), sans écho ni journal. Une rotation remplace les deux valeurs dans la même fenêtre de maintenance ; les sessions élevées en cours restent valables jusqu'à leur échéance (8 h).
- **Premier ADMIN** : sous `migrator`, attribuer le rôle (`granted_by` NULL = amorçage) et créer un facteur TOTP en attente. Pour cela, déposer le secret au coffre, puis inscrire sa référence et l'empreinte d'un code d'enrôlement. Le code est remis en main propre.
- **Bris de glace de production `SUPERADMIN`** : hors application, à deux personnes (17 §2.3), journalisé dans le registre de l'exploitation. Aucune commande de la console ne l'ouvre.

## Limites et conséquences

- **RLS-18 réduite, pas fermée.**
  - Qui lit la mémoire ou l'environnement du processus API (clé de preuve, jetons en vol) a tous les pouvoirs.
  - Qui détient le jeton d'une session élevée, ou son empreinte, agit comme son titulaire jusqu'à l'échéance (8 h) ou la révocation.
  - Le rôle `app_staff` séparé (17 §2.3, lot 4) reste une option. Le test RLS-18 montre désormais la réduction.
  - `api_insert` du journal (0021, US-009) reste ouvert : du SQL arbitraire sous `app_api` peut **ajouter** des lignes d'audit au nom de n'importe quel acteur (jamais en modifier ni en effacer : ajout seul et chaîne). Les lignes de la console sont écrites par `iam_staff_owner` ; une ligne ajoutée par `app_api` se distingue par l'absence de `after.countries` et passe pour globale. Fermeture PROPOSÉE avec le rôle `app_staff` ou une commande d'audit dédiée (lot 4), qui touche US-009.
- Chaque requête de console appelle `iam_staff_cmd_begin`, soit un aller-retour de plus. Les refus d'accès et les tentatives MFA sont journalisés, ce qui produit du volume en cas d'insistance (atténué par le limiteur de `/staff/*`).
- En-têtes du back-office (`apps/backoffice/security-headers.ts`) : CSP de même origine avec `frame-ancestors 'none'`, `X-Frame-Options: DENY`, HSTS, `Referrer-Policy: no-referrer`, `nosniff`. `'unsafe-inline'` reste nécessaire aux scripts de Next et à la feuille de thème, faute de nonce (PROPOSÉ).
- **Amorçage** : `bootstrap/0000_instance_roles.sql` crée `iam_staff_owner` ; il doit être rejoué **avant** 0031 (sinon `GRANT … TO iam_staff_owner` échoue).
- La comparaison de la preuve en SQL n'est pas à temps constant. Elle n'est exploitable que depuis du SQL déjà arbitraire, que la preuve vise justement à contenir.
- Le pays du journal est dans `after.countries` et non dans une colonne : aucune modification de la table chaînée ni de sa forme canonique (ADR-051). Le filtre est appliqué par la commande de lecture, pas par une politique `app_api`, car `app_api` ne lit jamais le journal directement.
- `has_staff_role` fait une lecture indexée de plus (`session_token_unique`). Le test de plan d'US-011 borne les appels par ligne, pas leur coût.
- Aucun membre du staff ne peut être élevé en production tant que le coffre (US-003) et la clé ne sont pas installés : comportement voulu.
