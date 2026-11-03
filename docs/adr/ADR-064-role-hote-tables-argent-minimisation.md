# ADR-064 — Rôle P2P_HOST : permissions de l'hôte, tables d'argent sans écriture directe, décisions FINANCE à deux personnes, minimisation du voyageur

- **Statut** : PROPOSÉ (US-062, agent données, 2026-11-03). Revues code, architecture (`packages/db/`) et **sécurité** (RLS, rôles, `SECURITY DEFINER`, sur un autre modèle que l'auteur) requises ; revue **argent** pour les tables d'argent et la double validation. À reporter dans 17 §8.1.
- **Stories** : US-062 ; s'appuient dessus US-101 (console des actions FINANCE), US-224 et US-709 (création et recouvrement des avances), US-227 (bordereaux, `insurer_ledger_state`), US-125 (interrupteurs, RLS-27), US-043 (matrice d'autorisations), US-207 (`host_guest_v` à l'écran). **Sources** : 17 §2.3 (rôles, matrice, minimisation, SQL des tables d'argent, RLS-2, RLS-21 à RLS-28), §2.9, §3.2.8, §3.2.9 ; passation US-056 (« Réserves ») ; ADR-053, ADR-056, ADR-057, ADR-062.

## Contexte

US-011 a livré la RLS par acteur et par pays et `app.is_org_holder()`, sans `app.has_permission` (aucune table ne la lisait). US-018 et US-019 ont livré les jambes (`settlement_leg`, `trip_leg_balance`, `payment_operation_leg`) avec une politique « titulaire, jambe HOST ». Restaient : la permission des relevés de gains, la lecture de `booking_trip.guest_user_id` par l'hôte (revue code US-011, constat 6), les tables d'argent d'US-056 (avances, assureur, demandes FINANCE) et les réserves de la revue sécurité d'US-056 (points 3 à 5).

## Décision

1. **Matrice et `app.has_permission(code)`.**
   - On sème seulement les permissions lues : `finance.read_org_statements` pour `P2P_HOST` ; `finance.platform_advance` et `finance.insurer_bordereau` pour `FINANCE` et `ADMIN`. Le `CO_HOST` n'en reçoit aucune.
   - La fonction (`policy_fn_owner`, `SECURITY DEFINER`, `STABLE`) relit l'appartenance **active** de l'acteur au compte de la session. Pour le titulaire, elle exige aussi `organization.holder_user_id`. Elle lit ensuite la matrice en vigueur de son rôle, ou les permissions unitaires que le titulaire a accordées (`permission_overrides`).
   - **Écart PROPOSÉ avec 17** : elle ne répond que pour un acteur `HOST`. Le staff relit ses permissions dans les commandes (`core.iam_staff_permitted`, ADR-062) et ses lectures par `app.has_staff_role`. Pour tout autre acteur, elle rend faux (fail-closed).
2. **Jambes de l'hôte (RLS-2, RLS-28).** Les trois politiques hôte exigent à la fois :
   - `app.is_org_holder()` ;
   - aucune réduction de portée par véhicule ;
   - `app.has_permission('finance.read_org_statements')`.

   Un co-hôte muni par erreur de la permission ne lit rien. `payment_operation_leg` reçoit la condition de portée que 0028 n'avait pas.

3. **Minimisation du voyageur (NOUVELLE-16).**
   - `booking_trip.guest_user_id` n'est plus lisible par `app_api`. Une politique peut encore s'en servir (ses expressions ne sont pas soumises au droit de colonne) ; la sous-requête de `operation_guest_read`, elle, y était soumise. Elle s'appuie désormais sur la RLS du trip du voyageur.
   - `core.booking_host_guest_v` est une vue `security_invoker` au-dessus de `core.booking_host_guest_rows()`. Cette fonction est `SECURITY DEFINER`, sans paramètre ; son propriétaire `host_view_owner` est un **nouveau** propriétaire NOLOGIN (famille `host_view`, amorçage et `OWNER_ROLES`) qui ne lit que quatre colonnes de deux tables.
   - Elle rend `trip_id`, le prénom, l'âge en années révolues (à `platform.now()`), la note et le statut de vérification. Elle ne répond que pour un acteur `HOST`, avec la portée véhicule d'un co-hôte (`app.host_covers_vehicle`).
   - Un compte pseudonymisé ne rend plus ni prénom ni âge.
4. **Tables d'argent (RLS-21 à RLS-23).**
   - Tables : `settlement_finance_approval`, `settlement_platform_advance`, `settlement_insurer_ledger_state`, `settlement_insurer_bordereau`, `settlement_insurer_bordereau_line`, toutes en `ENABLE` + `FORCE`.
   - Écritures : aucun droit d'écriture pour `app_api`, `app_worker` ni `app_anon`. `DELETE` et `TRUNCATE` sont refusés à tous les rôles par trigger.
   - Lectures d'`app_api` : par colonnes, **sans identifiant du personnel ni référence PSP**. FINANCE et ADMIN lisent leur pays ; OPS, SUPPORT, le voyageur et le co-hôte ne lisent rien.
   - L'hôte titulaire lit ses avances de cause `RELEASED_LEG` par `core.settlement_host_advance_v` (RLS-26).
   - Les travailleurs de la liste blanche ont la lecture seule. Les politiques d'écriture de `cmd_money_owner` sont posées pour les futurs écrivains (US-224, US-227, US-709), au plus juste.
5. **Décisions FINANCE à deux personnes (RLS-24 ; réserve 5 d'US-056).**
   - Commandes : `core.settlement_cmd_request_finance_action(jeton, demande, action, sujet, motif)` puis `core.settlement_cmd_approve_finance_action(jeton, demande)`, sous `cmd_money_owner`, `EXECUTE` au seul `app_api`. **Écart de signature avec 17** : le jeton (empreinte SHA-256) est un paramètre, comme dans les commandes de console d'ADR-062.
   - Forme d'appel d'ADR-056 : un appel = une instruction, en autocommit.
   - L'identité est celle de la **session** désignée par le jeton, vivante et élevée par TOTP. Elle ne vient jamais de `app.actor_id` ni d'un paramètre de personne. Une seconde session du demandeur reste la même personne : `SELF_APPROVAL`, journalisé, sans effet.
   - Les refus sont journalisés, puis rendus comme issue. Un sujet introuvable ou inéligible a la même issue qu'un sujet hors portée. L'audit est écrit en dernier.
   - L'approbation verrouille la demande, puis le sujet. Si le sujet n'est plus éligible, la demande passe `REJECTED` (`SUBJECT_CHANGED`).
   - **Défense en profondeur** : les triggers de garde n'acceptent `decided_by` / `decision_second_by`, `written_off_*` et `issued_by` / `second_validated_by` qu'en recopie exacte d'une demande `APPROVED` de la même action, sur le même sujet, par ces deux personnes. Cela vaut même sous `migrator`.
   - La politique `cmd_advance_upd` ne laisse jamais un travailleur écrire `WRITTEN_OFF` (réserve 3).
   - `core.settlement_advance_approvers(jeton, avance)` rend les deux approbateurs à FINANCE et ADMIN de la portée seulement ; à tout autre appelant, elle ne rend aucune ligne.
6. **Droits élargis de `cmd_money_owner`** (revue code US-062). Pour réutiliser les aides de la console d'ADR-062 (`core.iam_staff_session`, `core.iam_staff_permitted`, `core.iam_staff_audit`, `core.iam_staff_audit_countries`, `SECURITY INVOKER`), le propriétaire des commandes d'argent reçoit, par politiques `cmd_money_sel` / `cmd_money_ins` à son nom :
   - lecture par colonnes de `iam_session` (`id`, `user_id`, `token_hash`, `expires_at`, `revoked_at`, `mfa_level`), `iam_user_account` (`id`, `status`), `iam_staff_role_assignment` (`user_id`, `role`, `country_scope`, `expires_at`) et `iam_role_permission` (`role`, `permission_code`, `valid_from`, `valid_to`) ;
   - écriture au journal d'audit en ajout seul (colonnes de `iam_staff_owner`) et lecture de la seule colonne `id` (`RETURNING`) ;
   - `EXECUTE` sur les quatre aides et sur `app.country_scope()`.

   Aucune de ces lectures ne sort de la famille : les fonctions ne rendent qu'une issue et un identifiant. Alternative écartée : un propriétaire FINANCE distinct (17 §2.3 place les commandes FINANCE sous `cmd_money_owner`). La famille `cmd_money` lit donc désormais des empreintes de jetons : toute nouvelle fonction de la famille est revue en sécurité.

7. **Lecture des travailleurs.** `app_worker` lit `platform_advance` et `insurer_bordereau` par colonnes, sans identifiant du personnel (`decided_by`, `decision_second_by`, `written_off_by`, `write_off_second_by`, `issued_by`, `second_validated_by`) ; `finance_approval` lui reste illisible.
8. **Âge de `host_guest_v`** : années révolues à la date locale du trip (`booking_trip.timezone`, fuseau du pays), jamais au fuseau de la session.
9. **Réserve 4 d'US-056.** Le `GRANT` de `platform_advance` ne cite que des colonnes existantes ; le test des colonnes compare la liste exacte. `trip_id` est déjà dénormalisé dans `settlement_leg` (0027) et `payment_operation_leg` (0028).

## Limites et conséquences

- **Tables sans écrivain** : avances, bordereaux et position de l'assureur n'ont pas encore d'écrivain métier. Les preuves posent leurs lignes par la fixture 9700. Les clés étrangères vers `insurer` / `insurer_contract` arrivent avec US-227 (`ALTER`, sans recréation). Les écritures E4 du grand livre ne sont pas faites par l'approbation.
- **Pas de commande de rejet ni d'expiration** d'une demande FINANCE : elles viendront avec la console (US-101). Une demande en attente bloque une autre demande de la même action sur le même sujet.
- **Note et statut de vérification** de `host_guest_v` restent `NULL` jusqu'à `rating_aggregate` (story des avis) et `identity_verification` (KYC du voyageur), qui remplaceront `core.booking_host_guest_rows()`.
- **Adresse de l'hôte vue par le voyageur** jusqu'à la fin du trip + `review_window_days` : aucune table de lieux n'existe. Ce point est reporté à US-514 (lieux de prise et de retour), qui portera la vue du voyageur.
- **`cmd_apply_leg_movement`** (RLS-25) n'existe pas : la preuve porte sur la commande d'argent existante (`settlement_cmd_record`) et sur les lectures. US-061 / US-223 rejouent la preuve.
- **RLS-27** (interrupteurs de mise en service, réserves 1 et 2 d'US-056) relève d'**US-125** (19 : RLS-27 n'est pas dans les références d'US-062). `cmd_golive_owner` existe déjà (amorçage, `OWNER_ROLES`) ; il entrera dans la liste blanche RLS-15 avec ses fonctions.
- **`platform_advance.org_id`** n'est pas contraint à « compte d'hôte du trip » (seules les clés étrangères composées avec le pays le sont) : la commande de création (**US-224**) le relira du trip, comme la fixture 9700 ; à prouver par sa revue.
- **Gouvernance** : tant qu'un second approbateur n'existe pas, aucune décision FINANCE n'est possible (défaut fail-closed de la passation US-056).
- **Reports dans 17**, par l'orchestrateur :
  - §2.3 : signature à jeton des commandes FINANCE ; `has_permission` réservée à `HOST` ; famille `host_view` ; `guest_user_id` non lisible ; `host_guest_v` réduite aux quatre champs de 19 (17 cite aussi photo, nombre de trips et téléphone masqué) ;
  - §3.2.8 : `platform_advance.created_at` / `updated_at` / `row_version`, contrainte `receivable_minor ≤ amount_minor` ;
  - §3.2.9 : issues des commandes FINANCE.

## Alternatives écartées

- **Identité de l'approbateur lue dans `app.actor_id`** : ce réglage est forgeable sous `app_api` (RLS-18, réserve 5).
- **Politique de lecture de l'hôte sur `iam_user_account`** : les droits de colonne valent pour tout le rôle, donc l'hôte aurait lu l'email, le téléphone et la date de naissance du voyageur.
- **`host_guest_v` sous `policy_fn_owner`** : cela élargirait les droits de la famille des fonctions de politique ; un propriétaire par famille (17 §2.3, VERIF_17-B6).
