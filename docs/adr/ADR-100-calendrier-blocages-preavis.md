# ADR-100 — Calendrier par véhicule, blocages de l'hôte par commande et préavis par lieu de remise

- **Statut** : PROPOSÉ (US-119, agent back-end, claude-opus-5-5, 2026-11-12). Revues exigées (`review-requirements.json`, story US-119) : code, architecture (`packages/db/`), **sécurité** (`SECURITY DEFINER`, RLS, contexte `app.*` posé par une commande, concurrence), UX, QA ; RLS, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Sources** : 19 US-119 (critères) ; 16 CAL-001 / CAL-002, CAL-003 / CAL-004, CAL-011, LST-006 (`DATES_NOTICE_TOO_SHORT`), NFR-13 ; 08 BR-BOOK-03 (pas de 30 min), BR-BOOK-04, BR-BOOK-05, BR-BOOK-07 ; 17 §2.3 (sondes publiques, RLS-15, RLS-17), §2.5, §3.2.3 (`location.advance_notice_minutes`), §3.2.4, §7.2 (`advance_notice_minutes` : 180, 1 440 classe LUXE) ; ADR-060, ADR-063, ADR-089, ADR-099 ; pré-mortem L1-PM-11, L1-PM-22.

## Contexte

La table d'occupation unique (ADR-060) et ses commandes de blocage existent depuis le lot 0, mais elles lisent un contexte `app.*` que l'API ne pose pour aucun hôte, et aucun écran ne les sert. Le lieu de remise (ADR-099) n'a pas de préavis, et la pose d'un hold ne le contrôle pas. La sonde de disponibilité de 17 §2.3 (`catalog.vehicle_is_free`) n'existe pas.

## Décision

1. **Une seule source, un seul écrivain** : un blocage reste une occupation `HOST_BLOCK` / `MANUAL` écrite par `core.booking_cmd_place_host_block` (0032, gardes de 0056 : portée, véhicule publié du compte et du pays, verrou consultatif du véhicule, exclusion GiST). Migration 0070 n'ajoute **aucun** écrivain de l'occupation.
2. **Hôte de la session** : les commandes `core.catalog_cmd_place_host_block` et `core.catalog_cmd_remove_host_block` (`catalog_cmd_owner`, `SECURITY DEFINER`, `EXECUTE` au seul `app_api`) désignent l'hôte par l'**empreinte de son jeton** (`core.catalog_host_context`, comme ADR-099), vérifient que le véhicule est au catalogue du compte et du pays, puis posent le contexte `app.*` de **cet** hôte (acteur de la session, compte vérifié) pour l'appel de la commande de 0032 / 0056, qui rejoue ses propres gardes, et l'effacent ensuite. `catalog_cmd_owner` reçoit `EXECUTE` sur ces deux commandes (accordé par `cmd_hold_owner`, liste blanche RLS-15) et une lecture des occupations **actives** par colonnes (ni `ref_type` / `ref_id`, ni `expires_at`, ni `ical_uid`) ; aucun droit d'écriture.
3. **Heure locale du véhicule** : l'hôte saisit des jours (`from`, `to` inclus) ou des heures au pas de 30 min (08 BR-BOOK-03) ; la commande convertit avec le fuseau du véhicule lu au catalogue (hérité du pays, L1-PM-22), jamais le navigateur ni une constante. Bornes `[début, fin)`.
4. **Refus sans détail** : créneau pris (trip, hold, blocage, tampon) ⇒ `VEHICLE_UNAVAILABLE` (409) sans rien de l'occupation en cause ; véhicule non publié ⇒ `VEHICLE_NOT_LISTED` (409, PROPOSÉ ; la commande de 0056 l'exige déjà) ; véhicule, lieu ou blocage d'un autre compte ⇒ même réponse qu'un identifiant inconnu (404).
5. **Préavis par lieu** (16 CAL-003, « comme Turo ») : colonne facultative `catalog_location.advance_notice_minutes` (60 à 10 080 min, pas de 30 ; `NULL` = défaut du pays). Préavis en vigueur d'un véhicule (`core.catalog_effective_notice_minutes`, `SECURITY INVOKER`) : valeur du lieu du véhicule, sinon `advance_notice_minutes` portée `COUNTRY`, au moins la valeur de portée `CATEGORY` de sa classe (1 440 min pour `LUXE`, 08 BR-BOOK-04 « préavis minimal imposé ») ; sans valeur de l'hôte ni du pays : `PARAM_MISSING` (fail-closed). Lieu de remise d'un hold : le lieu du véhicule (un seul en bêta).
6. **Pose d'un hold** : `core.booking_cmd_place_hold` (corps de 0064 recopié) refuse un départ avant `platform.now()` + préavis : `hold_notice_too_short` ⇒ `DATES_NOTICE_TOO_SHORT` (16 CAL-003 ; borne incluse : 3 h pile acceptée, 2 h 59 refusée). Un trip ou un hold déjà posé n'est jamais touché par un changement de préavis.
7. **Calendrier** (16 CAL-001, bêta « liste ») : `core.catalog_host_vehicle_calendar` (fuseau, publication, lieu, préavis de l'hôte et en vigueur) et `core.catalog_host_vehicle_occupancies` (occupations actives non terminées, au plus 500 : type, source, bornes UTC et locales, levée possible) ; jamais le voyageur. Écran A06 `/host/vehicles/{vehicleId}`.
8. **Sonde** `core.catalog_vehicle_is_free(véhicule, période)` (17 §2.3, RLS-17) : propriétaire dédié `catalog_probe_owner` (lecture seule de l'annonce `LISTED` et des occupations actives), booléen seul, `NULL` hors annonce publiée ou période non bornée, période arrondie à l'heure en UTC ; `EXECUTE` au seul `app_api`. La recherche (US-201) la branchera avec sa limite de débit `availability_probe_per_minute`.

## Conséquences

- Les critères 1 à 3 de 19 US-119 sont prouvés sur PostgreSQL sous `app_api`, en PA (USD, UTC−5) et en PY (PYG, UTC−3), y compris la concurrence (deux blocages, blocage contre hold : une seule occupation).
- Tout hold dont le départ est dans le préavis est désormais refusé ; les fixtures historiques (départs à plusieurs jours) ne sont pas touchées.
- Routes `GET …/vehicles/{vehicleId}/calendar`, `POST …/vehicles/{vehicleId}/blocks`, `DELETE …/blocks/{blockId}`, `PUT …/locations/{locationId}/notice` (module CAT : l'espace de l'hôte y vit déjà, avec `SessionGuard` d'IAM ; AVL ne dépend pas d'IAM, 17 §2.2).

## Limites et reports

- Pas de vue mois / semaine ni de prénom du voyageur (bêta « liste ») ; « en revue » d'un hold non distingué (lecture de `checkout_hold` non accordée).
- Un véhicule non publié ne se bloque pas (garde de 0056) ; un blocage d'une annonce dépubliée ne se lève qu'après republication.
- Horaires de remise, durées min / max et préavis par jour de la semaine : hors story (16 CAL-003 P1).
- Sonde sans route publique ni limite de débit : US-201.

## Alternatives écartées

- **Contexte `app.*` posé par l'API** (comme la console du staff) : l'acteur viendrait de l'API sans preuve de possession relue en base ; l'empreinte du jeton suit ADR-099.
- **Nouvel écrivain de l'occupation sous `catalog_cmd_owner`** : deux familles écriraient la même table ; la commande de 0032 reste la seule.
- **Préavis par véhicule** (`listing`) : 08 BR-BOOK-04 et 17 §3.2.3 le portent par lieu.
