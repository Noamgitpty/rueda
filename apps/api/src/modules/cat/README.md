# CAT — Catalog / Listings (`apps/api/src/modules/cat`)

**CAT — Catalog / Listings** : lieux, véhicules, annonces, photos, politique de caution, import CSV, flux iCal. Dépendances autorisées : IAM, KYC, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 CAT --> KYC).

## Responsabilité

CAT décrit l'offre de l'hôte : lieux de remise, véhicules, documents du véhicule, annonces (SM-2), photos, politique de caution, catalogue de référence des marques, modèles et variantes, demandes d'ajout au catalogue, flux iCal déclarés (17 §2.2, §3.2.3).

CAT ne tient pas la disponibilité (AVL, table d'occupation unique) et ne fixe pas le prix d'un trip (PRC). L'import CSV d'une flotte est historique depuis le pivot P2P (`fleet_import_job`, 17 §3.2.3).

État réel : **squelette**. `CatModule` est vide (US-001). Seul le port `MapTiles` existe (US-020, ADR-058). Le catalogue de référence arrive avec US-113 et US-114, les lieux, véhicules et annonces avec US-115, la publication avec US-118 et US-509, les documents du véhicule avec US-124.

## Entités

Toutes les entités de 17 §3.2.3 sont **cibles 17, pas encore créées** : `location`, `vehicle`, `vehicle_document`, `listing`, `listing_photo`, `deposit_policy`, `ical_feed`, `vehicle_make`, `vehicle_model`, `vehicle_variant`, `catalog_addition_request`. `fleet_import_job` est historique, sans objet.

En attendant, AVL ne connaît aucun véhicule en production : `core.booking_vehicle_party` est fail-closed jusqu'à US-115 (`packages/db/README.md`).

## Événements

Émis (cible 17 §4.5) : `catalog.listing.status_changed`, `catalog.vehicle.restricted`, `catalog.deposit_policy.changed` (17 §2.2), `catalog.addition_request.resolved`, `catalog.vehicle_document.expiring`. **Aucun n'est émis aujourd'hui.**

Consommés (cible 17 §4.5) : `kyc.host_verification.decided` (KYC), `review.published` (REV), `catalog.addition_request.resolved` (rattachement de la variante). Aucun consommateur n'est branché.

## Ports

- `MapTiles` (`internal/map-tiles.port.ts`, types exportés par `index.ts` : `MapTiles`, `MapTilesOutcome`, `Tile`, `TileRequest`) : fonds de carte seuls, sans géocodage. Refus `OUT_OF_RANGE` et `QUOTA_EXCEEDED`. Adaptateur FAKE `FakeMapTiles` (`@rueda/fake-adapters/maps`) ; fournisseur réel à choisir. L'adaptateur est injecté.

`index.ts` exporte aussi `CatModule`.

## Commandes de test

- Unitaires (sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/cat` (`internal/map-tiles.port.test.ts`).
- Intégration et preuves L0 : aucun test du module, faute de table.

`test:int` et `test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
