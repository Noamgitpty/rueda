# CAT — Catalog / Listings (`apps/api/src/modules/cat`)

**CAT — Catalog / Listings** : lieux, véhicules, annonces, photos, politique de caution, import CSV, flux iCal. Dépendances autorisées : IAM, KYC, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 CAT --> KYC).

## Responsabilité

CAT décrit l'offre de l'hôte : lieux de remise, véhicules, documents du véhicule, annonces (SM-2), photos, politique de caution, catalogue de référence des marques, modèles et variantes, demandes d'ajout au catalogue, flux iCal déclarés (17 §2.2, §3.2.3).

CAT ne tient pas la disponibilité (AVL, table d'occupation unique) et ne fixe pas le prix d'un trip (PRC). L'import CSV d'une flotte est historique depuis le pivot P2P (`fleet_import_job`, 17 §3.2.3).

État réel : `CatModule` est vide (US-001). Existent le port `MapTiles` (US-020, ADR-058) et le **catalogue de référence des véhicules** (US-113, ADR-094) : tables, graine et lecture avec préremplissage. La file d'ajout arrive avec US-114, les lieux, véhicules et annonces avec US-115 (qui branche la route et l'assistant A10), la publication avec US-118 et US-509, les documents du véhicule avec US-124.

## Entités

- **Créées** (US-113, migration `0063_catalog_vehicle_reference`, ADR-094) : `core.catalog_vehicle_make`, `core.catalog_vehicle_model`, `core.catalog_vehicle_variant` (17 §3.2.3 `vehicle_make`, `vehicle_model`, `vehicle_variant`). `source` et `license_note` obligatoires et non vides ; retrait par `RETIRED`, jamais de suppression ; lecture des lignes `ACTIVE` et `RETIRED` par `app_api`, sans provenance ; aucune écriture applicative.
- **Cibles 17, pas encore créées** : `location`, `vehicle`, `vehicle_document`, `listing`, `listing_photo`, `deposit_policy`, `ical_feed`, `catalog_addition_request`. `fleet_import_job` est historique, sans objet.

### Catalogue de référence des véhicules (US-113)

| Fichier                                               | Rôle                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/vehicle-catalog.json`                           | **Donnée** : graine v1 PROPOSÉE (14 marques, 43 modèles, 45 variantes), saisie à la main par l'équipe, sans copie d'un tiers ; licences des sources (`sourceLicenses`, `consumptionLicenses`) et provenances (`source`, `sourceRef`, `licenseNote`) |
| `internal/vehicle-catalog/model.ts`                   | énumérations de 17 §3.2.3 ; `parseVehicleCatalog` (fail-closed : `CATALOG_SOURCE_MISSING`, `CATALOG_SOURCE_UNLICENSED`, `CATALOG_DATA_INVALID`) ; `catalogId` (UUID stable du chemin de la ligne)                                                   |
| `internal/vehicle-catalog/seed-sql.ts`                | rendu de la section générée de la migration 0063 (une instruction `INSERT` par table)                                                                                                                                                               |
| `internal/vehicle-catalog/prefill.ts`                 | `prefillFromVariant` : places, boîte, carburant, transmission intégrale, consommation (EPA = « référence US ») ; libellés en clés i18n `common.vehicle.*`                                                                                           |
| `internal/vehicle-catalog/store.ts`                   | port `VehicleCatalogStore` et `PgVehicleCatalogStore` (lecture sous `app_api`)                                                                                                                                                                      |
| `internal/vehicle-catalog/vehicle-catalog.service.ts` | `VehicleCatalogService` : marques → modèles → variantes de l'année → préremplissage ; `CATALOG_VARIANT_RETIRED`, `CATALOG_VARIANT_NOT_FOUND`                                                                                                        |

Modifier la graine : éditer les données, puis `RUEDA_WRITE_CATALOG_SEED=1 pnpm --filter @rueda/api exec vitest run src/modules/cat` réécrit la section de 0063. Une migration appliquée en environnement partagé est immuable (ADR-044) : une correction ultérieure passe par une nouvelle migration. Une source n'est chargée que si sa licence est `VALIDATED` (OQ-CAT-01 ; aujourd'hui `OPS_CURATED` et `WIKIDATA`).

En attendant, AVL ne connaît aucun véhicule en production : `core.booking_vehicle_party` est fail-closed jusqu'à US-115 (`packages/db/README.md`).

## Événements

Émis (cible 17 §4.5) : `catalog.listing.status_changed`, `catalog.vehicle.restricted`, `catalog.deposit_policy.changed` (17 §2.2), `catalog.addition_request.resolved`, `catalog.vehicle_document.expiring`. **Aucun n'est émis aujourd'hui.**

Consommés (cible 17 §4.5) : `kyc.host_verification.decided` (KYC), `review.published` (REV), `catalog.addition_request.resolved` (rattachement de la variante). Aucun consommateur n'est branché.

## Ports

- `MapTiles` (`internal/map-tiles.port.ts`, types exportés par `index.ts` : `MapTiles`, `MapTilesOutcome`, `Tile`, `TileRequest`) : fonds de carte seuls, sans géocodage. Refus `OUT_OF_RANGE` et `QUOTA_EXCEEDED`. Adaptateur FAKE `FakeMapTiles` (`@rueda/fake-adapters/maps`) ; fournisseur réel à choisir. L'adaptateur est injecté.

`VehicleCatalogStore` (`internal/vehicle-catalog/store.ts`) : lecture du catalogue de référence ; adaptateur `PgVehicleCatalogStore` sous `app_api`, aucun FAKE nécessaire.

`index.ts` exporte aussi `CatModule`, `VehicleCatalogService`, `PgVehicleCatalogStore`, `prefillFromVariant`, `CatalogError` et leurs types.

## Commandes de test

- Unitaires (sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/cat` (`internal/map-tiles.port.test.ts`, `internal/vehicle-catalog/seed-sql.test.ts`, `internal/vehicle-catalog/vehicle-catalog.service.test.ts`).
- Intégration : `internal/vehicle-catalog/vehicle-catalog.int.test.ts` (`pnpm --filter @rueda/api test:int`, sous `app_api`, PA et PY).
- Preuves L0 : `packages/db/test/l0/l0-us113-vehicle-catalog.test.ts` ; fixture `packages/db/test-migrations/9970_test_us113_catalog_fixtures.sql`.

`test:int` et `test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
