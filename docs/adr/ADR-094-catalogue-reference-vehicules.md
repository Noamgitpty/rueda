# ADR-094 — Catalogue de référence des véhicules : tables, graine maison sous licence, lecture publique

- **Statut** : PROPOSÉ (US-113, agent back-end, claude-opus-5-5, 2026-11-11). Revues exigées : code, **architecture** (`packages/db/`, migration 0063, schéma), qa. À reporter dans 17 §3.2.3 et §8.1 (ADR-034 détaillé), et les codes d'erreur dans 16 A.8, par une demande de fusion sur `docs/specs/`.
- **Sources** : 19 US-113 ; 16 HST-050 ; 17 §3.2.3 (`vehicle_make`, `vehicle_model`, `vehicle_variant`, `vehicle`), ADR-034 ; 22 OQ-CAT-01 (a)(b)(f)(g) ; CLAUDE.md contraintes 3, 8 et 9 ; ADR-049 (graines générées), ADR-060 et ADR-089 (clé du véhicule à poser par US-115).

## Contexte

L'hôte doit choisir marque, modèle, année et finition dans un catalogue qui préremplit les caractéristiques de son véhicule (HST-050). 17 décrit trois tables et exige `source` et `license_note` sur chaque ligne. Les licences des sources externes (NHTSA vPIC, EPA, CarQuery, Teoalida) sont **À VALIDER** (OQ-CAT-01). Le défaut de 22 : n'importer que les sources dont la licence est validée. Rien ne doit venir de Turo, d'annonces ou de sites de constructeurs.

ADR-060 et ADR-089 attendent une table `catalog_vehicle` (le véhicule de l'hôte, US-115) pour poser la clé `(vehicle_id, org_id, country_code)` des occupations et des holds. Le catalogue de référence n'est **pas** cette table : il décrit des modèles, pas les voitures des hôtes. `vehicle.variant_id` (US-115) pointera vers `catalog_vehicle_variant`.

## Décision

1. **Tables** (migration 0063, schéma Bêta `core`, préfixe `catalog_` de CAT) : `catalog_vehicle_make`, `catalog_vehicle_model`, `catalog_vehicle_variant`, aux colonnes de 17 §3.2.3, plus `created_at`. Les énumérations de 17 sont des `CHECK`. `source` et `license_note` sont `NOT NULL` avec un `CHECK` « non vide » sur les trois tables. Une consommation n'existe jamais sans sa source (`CHECK`). `verified_by` / `verified_at` vont ensemble. Clés uniques : `slug` de la marque, `(make_id, slug)` du modèle, clé naturelle de la variante (années, finition, boîte, carburant, transmission, marché ; `NULLS NOT DISTINCT`).
2. **Écarts à 17**, PROPOSÉS :
   - `market` est un code pays (clé étrangère vers `config_country`), `NULL` voulant dire « tous les pays ». La valeur `BOTH` de 17 et les valeurs `PA` / `PY` en dur seraient des constantes de pays (contrainte 3). Ajouter un pays ne demande aucun changement de schéma.
   - `source` exclut `AGENCY_REQUEST` (historique, hors produit : DEC-FONDATEUR-13).
   - `category_default` n'est pas créée : 17 n'en donne pas la nomenclature. US-115 l'ajoutera avec la catégorie du véhicule (migration additive).
3. **Graine maison, générée** : la donnée est `apps/api/src/modules/cat/data/vehicle-catalog.json`. `parseVehicleCatalog` la valide, fail-closed. Une ligne sans provenance, ou une provenance sans `source` ou sans `licenseNote`, donne `CATALOG_SOURCE_MISSING`. Une source (ou une source de consommation) dont la licence n'est pas `VALIDATED` donne `CATALOG_SOURCE_UNLICENSED`. Toute autre forme invalide donne `CATALOG_DATA_INVALID`. `renderVehicleCatalogSeedSql` rend une instruction `INSERT` par table entre deux marqueurs, à la fin de 0063. `seed-sql.test.ts` compare la section au rendu, comme les graines de configuration (ADR-049). La graine v1 est **minimale** : 14 marques, 43 modèles et 45 variantes courantes dans les deux pays. Elle est saisie à la main par l'équipe, à partir de caractéristiques techniques de notoriété publique, sans aucune copie d'un tiers. Sa source est `OPS_CURATED`, son statut PROPOSÉ, et elle n'est pas vérifiée (`verified_at` nul). L'ops la complète vers environ 150 modèles (curation hors développement, OQ-CAT-01 f). Elle ne contient aucune consommation EPA tant qu'OQ-CAT-01 (b) est ouverte.
4. **Critère 1 en base** : la migration est une transaction. Une ligne sans licence viole `NOT NULL` ou `CHECK`, et toute l'instruction échoue, donc toute la migration. La fixture de test `9970`, jouée sous `migrator` par le banc, exécute de telles instructions. Elle lève une exception si une seule ligne passe : le banc et la CI échouent alors. `l0-us113-vehicle-catalog.test.ts` vérifie ensuite, sous `app_api`, qu'aucune ligne refusée n'est restée.
5. **Identifiants stables** : UUID version 8 (RFC 9562) tiré du SHA-256 du chemin de la ligne (`variant/<marque>/<modèle>/<clé>`). La même variante a le même identifiant dans toutes les bases, ce qui permet à US-115 de rattacher `vehicle.variant_id` et à l'ops de corriger une ligne sans changer son identifiant.
6. **Droits** : RLS `ENABLE` + `FORCE`, `migrator_all`. `app_api` lit des colonnes nommées, sans provenance, vérificateur ni horodatage, sur les lignes `ACTIVE` et `RETIRED` (politique `api_read`). Les lignes `PENDING_REVIEW` restent à l'ops (US-114). `app_worker` et `app_anon` ne lisent rien. Aucune écriture applicative : la bêta charge la graine par migration, sans écran d'administration (16 HST-050, « Bêta pilote »). Aucune fonction `SECURITY DEFINER`. Une garde (`SECURITY INVOKER`, tous rôles, `migrator` compris) refuse `DELETE` et `TRUNCATE` : la classe de suppression est D, et le retrait se fait par `RETIRED`.
7. **Préremplissage** (`prefillFromVariant`, module CAT) : places, portes, carrosserie, boîte, carburant, transmission et consommation. Correspondance vers les colonnes du véhicule (PROPOSÉ) :
   - boîte : `MT` donne `MANUAL` ; `AT`, `CVT` et `DCT` donnent `AUTOMATIC`, et la boîte exacte reste fournie ;
   - carburant : `PHEV` donne `HYBRID` ; `LPG` donne `null`, car le véhicule n'a pas de valeur GPL et l'hôte choisit ;
   - transmission intégrale : `AWD` et `4X4`.
     Une consommation `EPA_US_REFERENCE` porte toujours la clé `common.vehicle.consumption.usReference` (« référence US » en es, en, fr et pt). Une variante, un modèle ou une marque retirés donnent `CATALOG_VARIANT_RETIRED` ; une variante inconnue ou en attente donne `CATALOG_VARIANT_NOT_FOUND`.
8. **Libellés** : `common.vehicle.*`, dans les quatre catalogues (version 15). Le préremplissage rend des clés, jamais du texte. Les noms de marque, de modèle et de finition sont des données sans langue : les finitions de la graine sont purement techniques (« 2.4 »).

## Conséquences

- La route HTTP et l'écran A10 arrivent avec l'assistant d'annonce (US-115). `VehicleCatalogService` et `PgVehicleCatalogStore` sont exportés par `apps/api/src/modules/cat/index.ts`.
- US-114 (file d'ajout) écrira dans ces tables par une commande `SECURITY DEFINER` (`HOST_REQUEST`, `PENDING_REVIEW`) ; elle devra déclarer sa licence dans `sourceLicenses`.
- US-115 : `vehicle.variant_id` vers `catalog_vehicle_variant (id)` ; véhicule sans variante non publiable (OQ-CAT-01 g). La clé `(vehicle_id, org_id, country_code)` d'ADR-060 et d'ADR-089 vise la table du véhicule de l'hôte (`catalog_vehicle`), pas ce catalogue.
- Une correction de la graine après application en environnement partagé passe par une **nouvelle** migration (0063 est immuable, ADR-044) ; le test d'égalité devra alors se limiter à la version 1.

## Alternatives écartées

- **Graine écrite à la main en SQL** : deux sources, aucune validation de licence avant le chargement.
- **Table des licences de source en base** (refus par déclencheur d'une source non validée) : utile quand un import réel existera (HST-051, P2). Aujourd'hui, seule la graine écrit, et le générateur la refuse déjà ; `NOT NULL` et `CHECK` suffisent comme filet.
- **Import de NHTSA vPIC ou d'EPA dès maintenant** : licences non validées (OQ-CAT-01 a, b), défaut fail-closed de 22.
- **Lecture des lignes `PENDING_REVIEW` par l'hôte demandeur** : relève de la file d'US-114.
