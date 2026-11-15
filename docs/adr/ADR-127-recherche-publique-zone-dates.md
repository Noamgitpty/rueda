# ADR-127 — Recherche publique par zone, lieu, dates et heures : deux fonctions en base, sonde de disponibilité limitée par IP

- **Statut** : PROPOSÉ (US-201, agents back-end et front-end, claude-opus-5-5, 2026-11-14). Revues exigées : `node scripts/ci/check-story-reviews.mjs` (voir la passation `docs/team/handoffs/US-201.md`) ; RLS, rôles et `SECURITY DEFINER` sur un autre modèle que l'auteur.
- **Sources** : 19 US-201 (critères 1 à 4 ; notes techniques : « liste de zones et de lieux déclarés par les hôtes (autocomplétion différée, US-512) ; lecture via `vehicle_is_free` (RLS-17) ») ; 16 SRC-001 / SRC-002 (bêta : SRC-001 simplifié, liste des villes et zones du pays ouvert ; `SEARCH_DATES_INVALID`, `SEARCH_LOCATION_REQUIRED`, `SEARCH_DURATION_EXCEEDED`), LST-006, LST-007 ; 08 BR-BOOK-03 à BR-BOOK-06 ; 17 §0.1, §2.3 (sondes publiques, RLS-15, RLS-17, `availability_probe_per_minute`), §3.2.3, §7.2 ; 22 OQ-P2P-05 ; 10b S01, UX-64 ; BOARD N-78 ; pré-mortem du lot 2 L2-PM-13, L2-PM-29, L2-PM-32 ; ADR-075 (anti-abus), ADR-099 (fiche publique), ADR-101 (sonde, préavis), ADR-114 (publication).

## Contexte

Le voyageur doit trouver une voiture disponible près du bon endroit et au bon créneau, sans jamais voir l'adresse exacte de l'hôte (L1-PM-19) et sans que la recherche serve à sonder le calendrier d'un hôte (L2-PM-32). La sonde `core.catalog_vehicle_is_free` (US-119) existait sans appelant ; la fiche publique `/listings/{id}` (US-115) ne sert que les colonnes C0. La bêta n'a ni géocodage (ADR-099) ni autocomplétion (US-512).

## Décision

1. **Deux fonctions en base, lecture seule** (`SECURITY DEFINER`, propriétaire `catalog_cmd_owner`, déjà propriétaire de la fiche publique ; `EXECUTE` au seul `app_api`, route publique de l'API comme la fiche ; ni `app_worker` ni `app_anon`) : `core.catalog_public_areas(pays)` (villes et zones des annonces cherchables, fuseau du pays ; pays nul : tous) et `core.catalog_public_search(pays, ville, zone, début local, fin local, limite)`. Migration `0103_catalog_public_search`.
2. **Annonce cherchable** : `LISTED`, véhicule non libéré, **hôte activable** (`core.catalog_search_host_open`) : compte `ACTIVE`, titulaire sans restriction active (la pose d'un hold la refuse aussi), `p2p_private_hosts_enabled` et `insurer_contract_active` ouverts dans le pays (absent = false, 17 §0.1). En production, tant que le fondateur n'a rien ouvert, la recherche est vide. **Réservation immédiate seulement** (`instant_book`) : tant que le cycle sur demande (`REQUEST`, US-223) n'existe pas, une annonce sur demande serait réservée comme immédiate ; elle est écartée de la recherche et des zones (consigne de l'orchestrateur, revue d'US-219 ; fail-closed, PROPOSÉ, **à lever par US-223**).
3. **Colonnes C0 seulement**, celles de la fiche : prix, véhicule, ville, zone saisie par l'hôte, point arrondi au centième de degré ; jamais le nom ni l'adresse du lieu, son point exact, la plaque, le VIN, le compte d'hôte ni l'occupation (19 US-201 critère 4).
4. **Heures** : saisies en heure LOCALE du lieu (`AAAA-MM-JJTHH:MM`, pas de 30 min, BR-BOOK-03), converties par la base dans le fuseau du pays (contrôles) et du véhicule (disponibilité) ; l'instant UTC rendu porte le fuseau du véhicule, que le site utilise pour l'affichage (critère 3). Horloge : `platform.now()`.
5. **Refus** (une ligne d'issue, aucune exception) : pays inconnu ou ville absente ⇒ `SEARCH_LOCATION_REQUIRED` ; date mal formée, hors pas de 30 min, fin ≤ début ou début passé ⇒ `SEARCH_DATES_INVALID` (critère 1) ; durée > `max_trip_days` ⇒ `SEARCH_DURATION_EXCEEDED` ; `max_trip_days` ou `buffer_minutes` absent ⇒ `SEARCH_UNAVAILABLE` (503, fail-closed). L'API rejoue la forme (et fin ≤ début) avant tout appel.
6. **Disponibilité lue UNIQUEMENT par la sonde** `catalog_vehicle_is_free` (RLS-17 ; `EXECUTE` donné à `catalog_cmd_owner` par `catalog_probe_owner`), sur la période occupée `[début, fin + buffer_minutes)` (BR-BOOK-05, la même que la pose d'un hold) : un trip, un hold vivant ou un blocage de l'hôte écartent le véhicule ; la sonde arrondit à l'heure, donc la recherche ne révèle ni les bornes d'un trip ni un hold à la seconde. Le préavis du lieu (`catalog_effective_notice_minutes`, ADR-101) écarte aussi le véhicule (préavis inconnu : écarté).
7. **Limite de la sonde (N-78)** : chaque recherche datée compte une sonde par IP, au plus `availability_probe_per_minute` du pays par minute (graine : 60, PROPOSÉ), en plus de la portée `search` du garde global (ADR-075). Le compteur est celui de RISK (`AbuseGuard.checkAvailabilityProbe`, portée `availability_probe_ip`, repli en mémoire si la base ne répond pas) ; CAT déclare le port `AvailabilityProbeLimiter`, satisfait par structure (`availabilityProbeLimiter`, câblé par `main.ts`) : CAT ne dépend pas de RISK. Au-delà : `429 RATE_LIMITED` et `Retry-After` ; limiteur en panne : 503.
8. **Site** : S01 porte le formulaire (lieu choisi dans la liste des zones, départ et retour en date et heure, heures du lieu), en GET vers `/search` ; la page liste les annonces disponibles (véhicule, zone approximative, période dans le fuseau du véhicule, prix par jour) et mène à la fiche avec les dates (`?start=&end=`), que la fiche reprend avec un lien de retour (critère 2). La carte, le total TTC et la caution arrivent avec US-203.

## Défauts PROPOSÉS

- `availability_probe_per_minute` = 60 par IP (graine US-013) ; aucune limite par session ajoutée : la limite par compte de la portée `search` (US-052) s'applique déjà à un visiteur connecté.
- Au plus 50 résultats (20 par défaut), les plus récemment publiés d'abord ; au plus 500 zones. Le tri par prix ou par distance relève d'US-203.
- Début passé : `SEARCH_DATES_INVALID` (16 SRC-001 « début dans le passé → refus », sans code propre).
- `SEARCH_UNAVAILABLE` (503) : PROPOSÉ, à reporter dans 16 A.8.
- Horaires de prise et de retour (BR-BOOK-06, 7 h–22 h) : aucun paramètre dans 17 §7.2 ; non filtrés (« jamais plus lourd que Turo » : l'hôte bloque ses heures, US-119). Suite à ouvrir si le fondateur veut un paramètre par pays.
- Libellés du formulaire repris des maquettes US-033 (« Dónde lo recoges », « Buscar autos ») ; « Cerca de mí » (géolocalisation) n'est pas livré : aucun géocodage en bêta.

## Conséquences et limites

- La période arrondie à l'heure par la sonde peut écarter un véhicule libre à moins d'une heure près (fail-closed) ; la pose du hold (US-208) reste juge au créneau exact.
- Un hold expiré mais pas encore balayé occupe encore le créneau jusqu'au balayage (17 §2.5) : le véhicule reste écarté quelques minutes.
- Chaque résultat appelle la sonde et le préavis : coût linéaire au nombre d'annonces LISTED de la ville ; p95 à mesurer avec US-203 (N-16, N-102).
- `catalog_cmd_owner` gagne la lecture de `max_trip_days`, `buffer_minutes` et de l'existence d'une restriction active (`user_id`, `active`), plus l'`EXECUTE` de la sonde.
- L'accueil appelle désormais l'API (`/search/areas`) : API injoignable ⇒ message « réessayer » à la place du formulaire (10b S01, « Lieux non chargés → réessayer »).

## Retour arrière

Voir l'en-tête de `0103_catalog_public_search.sql` ; côté API, ne plus monter `CatSearchModule` (les routes disparaissent) ; côté site, retirer le formulaire de S01 et la page `/search`.
