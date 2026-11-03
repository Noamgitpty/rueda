# ADR-053 — RLS par type d'acteur et par pays, propriétaires NOLOGIN des fonctions `SECURITY DEFINER`

- **Statut** : PROPOSÉ (US-011, agent données, 2026-11-03). Revues code, architecture et **sécurité** (RLS, rôles, `SECURITY DEFINER`) requises, la sécurité sur un autre modèle que l'auteur. À reporter dans 17 §2.3 et §8.1.
- **Stories** : US-011 ; reports d'US-006 (ADR-048), US-010 (ADR-052, revue sécurité constat 1 MAJEUR), US-009 (ADR-051) ; s'appuient dessus US-012, US-023, US-062. **Sources** : 17 §2.3 (rôles SQL, contexte, portée par pays, fonctions de politique, RLS-1 à RLS-20), §3.2.1, §3.2.13, §11 (L0-05, L0-07) ; ADR-027, ADR-035, ADR-044 (amendé ici).

## Contexte

Jusqu'ici, `app_api` n'avait aucun droit de lecture sur les tables AVL, PAY et IAM, et toutes les fonctions `SECURITY DEFINER` (triggers d'intégrité, commandes d'authentification, trigger de chaîne d'audit) appartenaient à `migrator`, propriétaire de toutes les tables et capable de DDL. La raison : `migrator` ne peut céder une fonction qu'à un rôle dont il est membre, et l'amorçage refusait toute appartenance.

## Décision

1. **Propriétaires NOLOGIN par famille** (17 §2.3, VERIF_17-B6). L'amorçage crée, en plus des quatre rôles d'US-005, `iam_auth_owner`, `integrity_owner`, `audit_chain_owner`, `cmd_money_owner` et `cmd_golive_owner`. Aucun ne se connecte, aucun n'est `SUPERUSER` ni `BYPASSRLS`, aucun ne possède de table ni de schéma. Chacun n'a que les droits de table, colonne par colonne, dont ses fonctions ont besoin. Il voit les lignes par une politique explicite à son nom, car il est soumis à `FORCE ROW LEVEL SECURITY` comme tout le monde.
2. **Amendement d'ADR-044 (amorçage)**. Une seule appartenance est admise : `GRANT <propriétaire> TO migrator WITH ADMIN FALSE, INHERIT FALSE, SET TRUE` (PostgreSQL 16).
   - `migrator` peut alors faire `ALTER FUNCTION … OWNER TO <propriétaire>`, sans hériter d'aucun droit du propriétaire (`pg_has_role(…, 'USAGE')` faux).
   - Le propriétaire n'hérite de rien.
   - Toute autre appartenance qui touche un rôle géré fait échouer l'amorçage.
   - Un contrôle final refuse `ADMIN` ou `INHERIT` sur ces lignes.
   - Le transfert exige `CREATE` sur le schéma pour le nouveau propriétaire : la migration l'accorde puis le retire dans la même transaction (0022, 0024, 0026).
3. **Familles transférées** (liste blanche RLS-15, `packages/db/security-definer-allowlist.json`) :
   - `integrity_trigger` : les 3 triggers d'ADR-048, propriétaire `integrity_owner`, en lecture seule ;
   - `iam_auth` : les 7 commandes d'ADR-052, propriétaire `iam_auth_owner`. Ses politiques `INSERT` / `UPDATE` encodent les transitions admises (un compte naît `PENDING_EMAIL`, une session ne fait qu'être révoquée, un lien ne fait qu'être consommé) ;
   - `audit_chain` : `core.audit_log_chain()`, propriétaire `audit_chain_owner`. Il lit l'état des clés : le verrou `FOR SHARE` exige un droit `UPDATE`, que borne une politique `WITH CHECK (false)`. Il avance aussi la tête de chaîne ;
   - `policy_fn` (nouvelle) : les fonctions de politique, propriétaire `policy_fn_owner`.

   Un test vérifie sur la base de production : la liste exacte, le propriétaire, `search_path = pg_catalog, pg_temp`, les rôles qui ont `EXECUTE`, et l'absence de `PUBLIC`. Toute fonction de `core`, `app` et `platform` a un `search_path` figé (RLS-16). `app_api` n'a ni `TEMP` ni `CREATE`.

4. **Contexte de session** (17 §2.3). `app.actor_kind()`, `app.actor_id()`, `app.org_id()`, `app.vehicle_scope()`, `app.country_scope()` et `app.worker_name()` lisent `current_setting(…, true)`. Une valeur absente, vide ou mal formée vaut `NULL` : aucune ligne, et aucune erreur (RLS-8).

   Côté application, une seule fonction pose ce contexte : `setSessionContext` (`@rueda/db`). Elle écrit toujours les six paramètres par `set_config(…, true)` à paramètres liés, après validation.

5. **Le contexte ne peut que réduire une portée relue en base** (écarts PROPOSÉS avec 17 §2.3) :
   - `app.has_staff_role(rôle, pays)`. Le pays est un paramètre. Il doit appartenir à la fois à `app.country_scope()` et au `country_scope` d'une attribution en cours de `staff_role_assignment`. Un OPS `{PA}` dont la couche d'accès poserait `{PA,PY}` ne lit rien du Paraguay (RLS-20). Un acteur sans rôle qui se dit `STAFF` ne lit rien ;
   - `app.host_covers_vehicle(véhicule)`. La portée est relue dans `membership` : le titulaire actif couvre tous les véhicules de son compte, le co-hôte actif seulement son `vehicle_scope`. `app.vehicle_scope()` ne fait que réduire. 17 écrivait « `vehicle_scope() IS NULL` ⇒ tout », ce qui laissait tout ouvert à un co-hôte si la couche d'accès oubliait le paramètre ;
   - `app.staff_case_covers(type, id)`. Il faut un dossier `OPEN` ou `PENDING` assigné à l'acteur, dans la portée posée, et un rôle OPS ou SUPPORT en cours sur le pays du dossier. En Bêta, seul le type `TRIP` est couvert. `review_queue_item` viendra avec sa story ;
   - `app.is_org_holder()`. Vrai seulement pour le titulaire actif du compte d'hôte de la session, jamais pour un co-hôte (RLS-28).

   Ces fonctions ne prennent aucun identifiant de personne et ne renvoient qu'un booléen sur l'acteur de la session. `app.has_permission(code)` n'est pas créée : aucune table ne la lit encore (US-062).

6. **Politiques d'`app_api`, en lecture seule** (0025). Une politique par type d'acteur, chacune exigeant son `app.actor_kind()` :
   - **GUEST** : ses trips, holds, occupations, opérations et son compte, quel que soit l'hôte ou le pays ;
   - **HOST** : les trips de son compte d'hôte réduits à sa portée, son compte d'hôte (titulaire seulement) et les appartenances (le titulaire voit toutes celles du compte, un co-hôte la sienne). **Aucun hold** : avant la réservation, l'hôte ne voit aucune donnée du voyageur (NOUVELLE-16). C'est un écart avec la politique `hold_host_read` de 17. Les créneaux « en attente » passeront par une vue minimisée (US-062) ;
   - **STAFF** : toujours borné au pays (`country_code = ANY (app.country_scope())` et rôle sur ce pays). ADMIN et FINANCE voient tout le pays. OPS et SUPPORT voient les objets d'un dossier ouvert qui leur est assigné.

   Colonnes jamais accordées : `password_hash`, clés d'idempotence et référence PSP. Aucune lecture `app_api` sur les occupations de véhicule (pas d'`org_id` avant le catalogue), les compensations, les dispositions, les webhooks, les sessions, les facteurs, les OTP, les rôles internes, les permissions, les restrictions et l'outbox.

7. **Clés d'audit par sujet** (report US-009). Pour `app_api`, la clé `USER` n'est accessible qu'au compte de la session, et la clé `ORG` qu'au titulaire du compte d'hôte de la session. `PLATFORM` n'est jamais accessible. Les travailleurs nommés gardent l'accès de 0021, car ils agissent pour tous les sujets.
8. **Intégrité référentielle et pays** (0023, report US-010) :
   - `guest_user_id` → `iam_user_account` ;
   - `(org_id, country_code)` des holds et trips → `iam_organization (id, country_code)` : un trip porte le pays de son compte d'hôte, c'est sur ce pays que filtrent les politiques du staff ;
   - `(trip_id, country_code)` du dossier de support → `booking_trip (id, country_code)`.
9. **`core.support_support_case`**, sous-ensemble de 17 §3.2.13. Il porte l'assignation (`assignee_id`) qui ouvre un objet à OPS ou SUPPORT. Un dossier `BREAK_GLASS` exige un motif de 10 à 2 000 caractères. Il est écrit par la console (US-012) : aucun rôle applicatif n'a de droit d'écriture.

## Limites (documentées, non fermées)

- **RLS-18**. Le contexte `app.*` reste forgeable par du SQL arbitraire sous `app_api` : poser l'`actor_id` d'un ADMIN réel donne ses lectures (le test le montre). La relecture en base réduit le dégât d'un défaut de la couche d'accès, pas celui d'une injection. Les parades restent celles de 17 : requêtes paramétrées, pose par la seule `setSessionContext`, et au lot 4 un jeton signé (HMAC) vérifié par une fonction `SECURITY DEFINER` ou un rôle `app_staff` distinct.
- **Nom de travailleur forgeable** (report, revues US-006 et US-009). `app.worker_name` est déclaratif sous `app_worker`. Les politiques « par travailleur » protègent contre une erreur de code, **pas** contre un travailleur compromis, et ne sont pas une frontière de sécurité. **Proposition** (lot 4, sans casser US-006 ni US-008) : un rôle de connexion par famille de travailleurs (`app_worker_booking`, `app_worker_bus`, `app_worker_audit`…), membre de rien, chacun avec ses propres identifiants. Les politiques passent alors de `app.worker_name() IN (…)` à `TO app_worker_<famille>`. Les noms actuels se regroupent sans changer le code des travailleurs, seulement leur chaîne de connexion.
- La journalisation d'un bris de glace (`data_access_log`) et sa revue hebdomadaire relèvent de la console (US-012).

## Conséquences

- Les tests RLS tournent sous `app_api`, `app_worker` et `app_anon`, avec le contexte posé par `setSessionContext`, en USD (PA) et en PYG (PY) : `test/l0/l0-rls-actors.test.ts` et `l0-rls-15-security-definer.test.ts`.
- Une fonction `SECURITY DEFINER` ajoutée sans entrée dans la liste blanche fait échouer la CI. Une nouvelle famille demande un rôle de plus dans l'amorçage et dans `OWNER_ROLES` (test de cohérence).
- Les fixtures L0 créent désormais de vrais comptes (`test_fixture.ensure_party`, 9300).
- Hors périmètre : RLS-2, RLS-3, RLS-4, RLS-10, RLS-11, RLS-14, RLS-17, RLS-19 (attendent le catalogue, les commandes de hold US-023 ou la console) et RLS-21 à RLS-28 (US-062).

## Alternatives écartées

- **`BYPASSRLS` pour les propriétaires** : contraire à 17 §2.3 et à CLAUDE.md, point 5.
- **Appartenance avec `INHERIT TRUE`** : `migrator` cumulerait les droits de tous les propriétaires.
- **Amorçage qui fait lui-même `ALTER FUNCTION … OWNER TO`** : il dépendrait de l'état des migrations, alors qu'il doit rester rejouable avant elles.
- **Faire confiance à `app.vehicle_scope` / `app.country_scope`** comme dans 17 : un oubli de la couche d'accès élargit la portée (ouvert par défaut).
