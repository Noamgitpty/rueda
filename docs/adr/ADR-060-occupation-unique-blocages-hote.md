# ADR-060 — Table d'occupation unique : compte d'hôte de l'occupation, blocages de l'hôte et tampons autonomes par commandes

- **Statut** : PROPOSÉ (US-022, agent données, claude-opus-5-5, 2026-11-03). Revues exigées : code, architecture (`packages/db/`, migration 0029), **sécurité / concurrence** (RLS, `SECURITY DEFINER`, liste blanche RLS-15, exclusion GiST) sur un autre modèle que l'auteur, QA. À reporter dans 17 §2.3, §2.5, §3.2.4 et §8.1.
- **Stories** : US-022 ; s'appuient dessus US-023 (`cmd_place_hold` sous le même propriétaire), US-024 (fin anticipée, tampon autonome), US-201 (sonde de disponibilité), la story du catalogue (clé étrangère du véhicule). **Sources** : 16 CAL-011, CAL-004 ; 08 BR-BOOK-05, BR-BOOK-07, BR-BOOK-10 ; 17 §2.3 (droits d'écriture, rôles d'exécution des commandes, RLS-15), §2.5 (sources de vérité, ordre global des verrous, « Blocages iCal »), §3.2.4, §7.2 (`buffer_minutes`) ; ADR-048, ADR-053, ADR-056.

## Contexte

US-006 a posé `booking_vehicle_occupancy` avec l'exclusion `vehicle_occupancy_no_overlap` ; US-007 a prouvé la concurrence des poses de hold (C1) avec une fixture. Il manquait, pour que la table soit **la** source de vérité de tous les canaux (19 US-022, CAL-011) :

- les écrivains autres que le hold : blocage manuel de l'hôte (`HOST_BLOCK`, BR-BOOK-07 : refusé s'il chevauche un trip confirmé) et tampon autonome (`BUFFER`, 17 §2.5 « maintenance après un trip terminé tôt ») ;
- le tampon matérialisé `[début, fin + tampon)` (BR-BOOK-05, CAL-004) calculé en base ;
- un rattachement de l'occupation à un compte d'hôte et à un pays, sans lequel ni le cloisonnement entre hôtes, ni la portée pays du staff, ni le calendrier de l'hôte ne sont exprimables (0025 l'avait reporté « au catalogue »).

Le catalogue (`catalog_vehicle`) n'existe pas encore : aucune table ne dit à quel compte d'hôte appartient un véhicule, et `app.host_covers_vehicle` couvre, pour un titulaire, **tout** identifiant de véhicule.

## Décision

1. **Compte et pays de l'occupation** (migration 0029) : colonnes `org_id` et `country_code` `NOT NULL`, clé composée `(org_id, country_code)` vers `iam_organization (id, country_code)` (un compte d'hôte est mono-pays). Elles ne viennent jamais du client : `app.org_id()` vérifié pour un blocage, le trip pour un tampon, le hold pour un hold (`cmd_place_hold` les lira dans le catalogue, US-023).
2. **Un véhicule, un compte** (PROPOSÉ, en attendant le catalogue) : exclusion `occupancy_vehicle_single_org EXCLUDE USING gist (vehicle_id WITH =, org_id WITH <>)` sur toutes les lignes, actives ou non (`btree_gist` fournit `<>` pour `uuid`). Les commandes de blocage vérifient d'abord, sous le verrou du véhicule, qu'aucune occupation du véhicule n'appartient à un autre compte (`FORBIDDEN`) ; l'exclusion est le filet structurel. Le hold et son occupation désignent le même véhicule, le même compte et le même pays : clé composée `checkout_hold_occupancy_party_fk` vers `UNIQUE (id, vehicle_id, org_id, country_code)`.
3. **Période** : `core.booking_occupied_period(début, fin, minutes)` (`IMMUTABLE`, `[début, fin + minutes)`, bornes invalides refusées `INVALID_PERIOD`) et `core.booking_buffer_minutes(pays)` (`STABLE`, invocateur : `buffer_minutes` du pays en vigueur à `platform.now()`, `NULL` si absent, et l'appelant refuse `PARAM_MISSING`, `fail_mode` BLOCK). `cmd_place_hold` (US-023) calcule la période d'un hold avec ces deux fonctions ; la valeur par annonce viendra du catalogue.
4. **Commandes `SECURITY DEFINER` sous `cmd_hold_owner`** (propriétaire NOLOGIN dédié, jamais `migrator` ; `search_path` figé ; liste blanche RLS-15) :
   - `core.booking_cmd_place_host_block(véhicule, début, fin) → uuid` et `core.booking_cmd_remove_host_block(blocage) → boolean` : `EXECUTE` au seul `app_api` ; `app.actor_kind() = 'HOST'`, `app.host_covers_vehicle` (titulaire actif : tout le compte ; co-hôte actif : sa portée), pays relu du compte ; verrou du véhicule seul (aucun guest touché, ordre global de 17 §2.5) ; identifiant généré par la commande ; levée = désactivation `BLOCK_REMOVED`, jamais une suppression ; rejeu de la levée : `false`. Seuls les blocages `MANUAL` sont levés par l'hôte (iCal hors bêta).
   - `core.booking_cmd_place_buffer(trip, début) → uuid` : `EXECUTE` au seul `app_worker`, travailleur `trip_lifecycle` ; trip ayant rendu le véhicule (`RETURNED`, `TERMINATED_EARLY`, `POST_TRIP`, `COMPLETED` : lecture de SM-1, PROPOSÉ), début ≥ début prévu du trip ; période `[début, début + buffer_minutes du pays)`, rattachée au trip (`ref_type = 'TRIP'`) ; jamais produit par la conversion d'un hold (17 annexe A6). Tampon nul dans le pays : rien n'est posé.
   - **Famille** : `cmd_hold_owner` porte toutes les commandes qui écrivent l'occupation (hold, blocage, tampon), parce qu'elles partagent l'exclusion, le verrou du véhicule et l'ordre des verrous. Ses droits restent séparés **par politique** : `cmd_block_ins` / `cmd_block_upd` (HOST_BLOCK, MANUAL, hôte et compte de la session), `cmd_buffer_ins` (BUFFER, SYSTEM, `trip_lifecycle`), lecture `cmd_occ_sel` (nom de 17 §2.3) ; US-023 ajoutera les politiques du hold.
   - **Erreurs** (sans `DETAIL`, `translateDbError`) : `FORBIDDEN` pour tout refus d'identité, de portée, de compte ou de pays, **sans distinguer** un véhicule ou un blocage d'un tiers d'un identifiant inconnu (17 §2.5, exigence US-060 point 2) ; `VEHICLE_UNAVAILABLE` (23P01 de l'exclusion, quel que soit le canal qui tient le créneau) ; `INVALID_PERIOD` (PROPOSÉ) ; `INVALID_TRANSITION` ; `PARAM_MISSING`.
   - **Forme d'appel** : celle d'ADR-056 point 4 (un appel = une instruction, transaction courte, `ROLLBACK` immédiat).
5. **Lectures d'`app_api`** (par colonnes : `id`, `vehicle_id`, `org_id`, `country_code`, `kind`, `source`, `period`, `active`, `expires_at`, `deactivated_reason`, `created_at`, `updated_at`) : calendrier de l'hôte (`org_id = app.org_id()` et `app.host_covers_vehicle`) et ADMIN du pays (`country_code = ANY (app.country_scope())`, `has_staff_role('ADMIN', pays)`). Jamais `ref_type` / `ref_id` (un hold ne doit rien révéler du voyageur à l'hôte, NOUVELLE-16), ni `ical_uid`, ni les colonnes d'audit. Le voyageur ne lit pas la table (sonde `catalog.vehicle_is_free`, US-201).
6. **Lecture de configuration** : `cmd_hold_owner` lit `config_param_value` pour la seule clé `buffer_minutes` (politique `cmd_hold_read`) ; US-023 élargira la liste aux clés de ses commandes (`hold_ttl_minutes`…).

## Conséquences

- Les fixtures de test qui posent des occupations (9001, 9002, 9300) renseignent `org_id` et `country_code` ; elles restent hors de la base de production.
- Tests : `test/l0/l0-occ-single-occupancy.test.ts` (PA et PY) ; inventaires mis à jour (`l0-rls-columns`, RLS-12, politiques AVL, IAM et configuration, RLS-15).
- C1 « tous canaux » : holds et blocages concurrents du même créneau, 40 connexions (C1 à 100 poses est prouvé par L0-02) ; 0 `40P01` exigé, pas de seuil de temps (journal CI `[US-022 C1 tous canaux]`).

## Limites et reports

- **Squat d'un identifiant de véhicule** : tant que le catalogue n'existe pas, le premier compte qui écrit une occupation d'un véhicule en devient le compte. Un titulaire peut donc poser un blocage sur un identifiant de véhicule qui n'a encore aucune occupation. Effet borné : il ne voit rien d'un tiers et ne bloque qu'un identifiant qu'aucun hold n'a jamais visé. **Fermeture** : la story du catalogue ajoute la clé étrangère `(vehicle_id, org_id, country_code)` vers `catalog_vehicle` sur l'occupation, le hold et le trip, puis `app.host_covers_vehicle` relit le compte du véhicule (report à porter dans sa DoR).
- La cohérence compte / pays entre une occupation `TRIP` et son trip n'est pas encore structurelle (seul le véhicule l'est, par I-OCC) : la conversion recopie le compte du hold ; à fermer avec la clé du catalogue.
- Une occupation `HOLD` échue mais non encore balayée bloque un blocage de l'hôte jusqu'au passage de l'expiration (60 s au plus) : le blocage n'exécute pas l'expiration ciblée 2a, qui appartient à `cmd_place_hold` (US-023).
- Durée maximale d'un blocage, blocage journalier et par lot (BR-BOOK-07 : « un ou plusieurs véhicules ») : non fixés par les spécifications ; à trancher avec le calendrier de l'hôte (écran, P0-A).

## Alternatives écartées

- **Nouveau propriétaire NOLOGIN `cmd_calendar_owner`** : sépare les familles, mais exige un nouveau rôle d'amorçage pour deux commandes qui partagent l'exclusion et le verrou des holds ; les politiques par type d'occupation donnent la même séparation des droits. À reconsidérer si la revue sécurité le demande.
- **Lecture du calendrier par jointure sur les holds et les trips** : impossible pour les blocages et les tampons, et coûteuse sous RLS.
- **Droit d'`INSERT` direct pour `app_worker` (tampon)** : contraire à « écritures uniquement par commandes » (CAL-011) et à l'inventaire d'US-006 (`app_worker` n'insère aucune occupation).
