# CAT — Catalog / Listings (`apps/api/src/modules/cat`)

**CAT — Catalog / Listings** : lieux, véhicules, annonces, photos, politique de caution, import CSV, flux iCal. Dépendances autorisées : IAM, KYC, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 CAT --> KYC).

## Responsabilité

CAT décrit l'offre de l'hôte : lieux de remise, véhicules, documents du véhicule, annonces (SM-2), photos, politique de caution, catalogue de référence des marques, modèles et variantes, demandes d'ajout au catalogue, flux iCal déclarés (17 §2.2, §3.2.3).

CAT ne tient pas la disponibilité (AVL, table d'occupation unique) et ne fixe pas le prix d'un trip (PRC). L'import CSV d'une flotte est historique depuis le pivot P2P (`fleet_import_job`, 17 §3.2.3).

État réel : `CatModule` est vide (US-001). Existent le port `MapTiles` (US-020, ADR-058), le **catalogue de référence des véhicules** (US-113, ADR-094) et les **lieux de remise, véhicules et annonces de l'hôte** (US-115, ADR-099 : `CatHostModule`, routes `/host/accounts/{orgId}/…` et fiche publique `/listings/{id}`). La file d'ajout au catalogue est livrée par US-114 (ADR-104 : un véhicule hors catalogue ouvre sa demande, son annonce n'est pas publiable tant que l'ops ne l'a pas rattaché à une variante ; route `POST /host/accounts/{orgId}/vehicles/{vehicleId}/catalog-request` ; `GET …/vehicles` rend `catalogRequest`), la publication avec US-118 et US-509, les documents du véhicule avec US-124, le **calendrier, les blocages et le préavis** avec US-119 (ADR-101, ci-dessous), l'assistant complet par étapes avec US-508 ; écrans A10 `/host` et S03 `/listings/{id}` : `apps/web` (US-115).

## Entités

- **Créées** (US-113, migration `0063_catalog_vehicle_reference`, ADR-094) : `core.catalog_vehicle_make`, `core.catalog_vehicle_model`, `core.catalog_vehicle_variant` (17 §3.2.3 `vehicle_make`, `vehicle_model`, `vehicle_variant`). `source` et `license_note` obligatoires et non vides ; retrait par `RETIRED`, jamais de suppression ; lecture des lignes `ACTIVE` et `RETIRED` par `app_api`, sans provenance ; aucune écriture applicative.
- **Créées** (US-115, migration `0067_catalog_host_listings`, ADR-099) : `core.catalog_location`, `core.catalog_vehicle`, `core.catalog_listing`, `core.catalog_listing_photo`, `core.catalog_deposit_policy` (17 §3.2.3). Aucun droit applicatif : tout passe par les fonctions `core.catalog_cmd_*` et `core.catalog_host_*` (`SECURITY DEFINER`, propriétaire `catalog_cmd_owner`, hôte désigné par l'empreinte du jeton) et `core.catalog_public_listing`.
- **Créée** (US-114, migration `0074_catalog_addition_requests`, ADR-104) : `core.catalog_addition_request` (17 §3.2.3) : demande d'ajout d'un véhicule hors catalogue, élément de la file `CATALOG_ADDITION` d'US-109 ; aucun droit applicatif ; commandes de l'hôte `core.catalog_cmd_request_addition`, `core.catalog_host_addition_requests`, fonctions de domaine `core.catalog_addition_detail` et `core.catalog_resolve_addition` (appelées par la console de SUP).
- **Cibles 17, pas encore créées** : `vehicle_document`, `ical_feed`. `fleet_import_job` est historique, sans objet.

### Lieux de remise, véhicules et annonces de l'hôte (US-115)

| Fichier                                               | Rôle                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/host-listings/model.ts`                     | validation champ par champ (UX-50) : lieu (épingle facultative, jamais à moitié posée), véhicule (plaque et VIN normalisés, variante ou repli texte), tarif (unités mineures en chaîne d'entier)                                                                                                   |
| `internal/host-listings/store.ts`                     | port `HostListingStore`, `PgHostListingStore` (fonctions `core.catalog_*` de 0067, paramètres liés), `UnavailableHostListingStore` (503)                                                                                                                                                           |
| `internal/host-listings/photo-ingest.ts`              | photo : taille, type réel (JPEG, PNG, WebP), dimensions avant décodage, retrait des métadonnées par liste blanche (EXIF dont GPS, XMP, IPTC, MPF, textes ; rien après la fin du JPEG ; fragments PNG et WebP connus seulement) ; ports `PhotoScanner`, `PhotoStorage`, indisponibles en production |
| `internal/host-listings/host-listings.service.ts`     | `HostListingsService` : issues de la base vers codes stables ; catalogue filtré par le marché du compte d'hôte                                                                                                                                                                                     |
| `internal/host-listings/host-listings.controller.ts`  | routes de l'hôte (`SessionGuard`) ; tout objet d'un autre hôte : 404                                                                                                                                                                                                                               |
| `internal/host-listings/public-listing.controller.ts` | `GET /listings/{listingId}` : annonce `LISTED`, colonnes C0, zone approximative seulement                                                                                                                                                                                                          |
| `internal/host-listings/cat-host.module.ts`           | `CatHostModule.register(options)`, `postgresCatAdapters(db, pool)` ; sans options : 503 partout                                                                                                                                                                                                    |
| `testing/fake-host-listing-store.ts`                  | FAKE du magasin (tests de contrat seulement)                                                                                                                                                                                                                                                       |

Codes : ceux de 16 (`VEHICLE_PLATE_DUPLICATE`, `VEHICLE_FIELD_REQUIRED`, `PHOTO_MIN_COUNT`, `PHOTO_FORMAT`, `PRICE_INVALID`, `MILEAGE_CONFIG_INVALID`, `HOST_NOT_ACTIVATED`, `LISTING_TRANSITION_FORBIDDEN`, `REQUEST_MODE_NOT_ALLOWED`) et les PROPOSÉS d'`internal/host-listings/errors.ts`, dont `TERMS_REACCEPT_REQUIRED` (409, CGU de l'hôte à accepter avant la soumission, garde de la commande en base, US-126) ; messages `common.listing.*` en es, en, fr et pt. Photos : `POST /host/accounts/{orgId}/listings/{listingId}/photos` (base64, corps borné à 100 Kio jusqu'à l'URL signée d'US-003) ; en production, antivirus ClamAV (DEC-FONDATEUR-20, adaptateur à livrer) et stockage objet sont indisponibles : 503.

### Calendrier, blocages et préavis de l'hôte (US-119)

| Fichier                                              | Rôle                                                                                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/host-calendar/model.ts`                    | saisie : blocage par jours (`from`, `to` inclus) ou par heures (`start`, `end`, pas de 30 min) en heure LOCALE du véhicule ; préavis de 60 à 10 080 min au pas de 30, ou `null` (pays) |
| `internal/host-calendar/store.ts`                    | port `HostCalendarStore`, `PgHostCalendarStore` (fonctions `core.catalog_*` de 0071, paramètres liés), `UnavailableHostCalendarStore` (503)                                            |
| `internal/host-calendar/host-calendar.service.ts`    | `HostCalendarService` : issues de la base vers codes stables (`VEHICLE_UNAVAILABLE` sans détail de l'occupation, `VEHICLE_NOT_LISTED`, `BLOCK_NOT_FOUND`, `INVALID_PERIOD`)            |
| `internal/host-calendar/host-calendar.controller.ts` | `GET …/vehicles/{vehicleId}/calendar`, `POST …/blocks`, `DELETE …/blocks/{blockId}`, `PUT …/locations/{locationId}/notice` (`SessionGuard`) ; tout objet d'un autre hôte : 404         |
| `testing/fake-host-calendar-store.ts`                | FAKE du calendrier (tests de contrat seulement)                                                                                                                                        |

La disponibilité reste celle d'AVL : un blocage est écrit par la commande `core.booking_cmd_place_host_block` de la table d'occupation unique (exclusion GiST, verrou du véhicule), appelée par `core.catalog_cmd_place_host_block` pour l'hôte de la session (ADR-101). Le préavis du lieu est contrôlé à la pose d'un hold (`DATES_NOTICE_TOO_SHORT`). Écran A06 `/host/vehicles/{vehicleId}` : `apps/web`.

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

Depuis US-115, `core.booking_vehicle_party` lit `catalog_vehicle` et son annonce `LISTED` ; occupations, holds et trips portent une clé étrangère `(vehicle_id, org_id, country_code)` vers `catalog_vehicle` (ADR-060, ADR-089, ADR-099). Sans annonce publiée (US-118), aucun hold ni blocage n'est possible en production.

### Documents et éligibilité du véhicule, contestation de plaque (US-124, ADR-107)

- Migrations `0077_catalog_vehicle_documents` (tables `catalog_vehicle_document`, `catalog_vehicle_eligibility_check`, `catalog_vehicle_claim` ; colonnes `title_holder`, `eligibility_reasons`, `eligibility_submitted_at`, `eligibility_checked_at`, `released_at` sur `catalog_vehicle`) et `0078_config_vehicle_eligibility_params` (paramètres `elig_*`, générée).
- Routes : `GET /host/accounts/{orgId}/vehicle-eligibility`, `PUT …/vehicles/{vehicleId}/declaration`, `POST …/vehicles/{vehicleId}/documents` (503 en production : antivirus, coffre et stockage pas encore livrés), `POST …/vehicles/{vehicleId}/eligibility` (motifs dans `reasons`), `GET|POST …/vehicle-claims`. Console (SUP) : `POST /console/queues/items/{id}/vehicle|vehicle/decide|vehicle-claim|vehicle-claim/decide|files/{fileId}`.
- Ports `DocumentScanner`, `DocumentVault`, `DocumentFileStore` (`internal/vehicle-documents/ports.ts`, exportés par `index.ts` pour la console) ; production : `UNAVAILABLE_DOCUMENTS`.
- Fiche publique : `hostFirstName` (premier mot du prénom légal, BOARD N-37).
- Correctif (migration `0083_catalog_vehicle_chassis_formats`, ADR-113) : numéro de châssis VIN ISO 3779 ou non ISO (5 à 16 caractères, châssis court d'importation japonaise), sans règle d'année ; refus `VEHICLE_VIN_INVALID` (422, `common.vehicleDocs.vinInvalid`) à la création et à la déclaration ; `normalizeVin` ne juge que les caractères. `PUT …/declaration` accepte `locale` (langue de l'écran, défaut `es`) : la base historise chaque engagement avec la version du catalogue et le libellé exact (`catalog_vehicle_attestation`, ajout seul).

## Événements

Émis : `catalog.addition_request.resolved` (US-114, outbox, par `core.catalog_resolve_addition` : `request_id`, `status`, `resolved_variant_id`, extensions `vehicle_id`, `org_id`, `host_user_id`, `reject_reason` ; consommé par NTF). Cible 17 §4.5, pas encore émis : `catalog.listing.status_changed`, `catalog.vehicle.restricted`, `catalog.deposit_policy.changed` (17 §2.2), `catalog.vehicle_document.expiring`.

Consommés (cible 17 §4.5) : `kyc.host_verification.decided` (KYC), `review.published` (REV), `catalog.addition_request.resolved` (rattachement de la variante). Aucun consommateur n'est branché.

## Ports

- `MapTiles` (`internal/map-tiles.port.ts`, types exportés par `index.ts` : `MapTiles`, `MapTilesOutcome`, `Tile`, `TileRequest`) : fonds de carte seuls, sans géocodage. Refus `OUT_OF_RANGE` et `QUOTA_EXCEEDED`. Adaptateur FAKE `FakeMapTiles` (`@rueda/fake-adapters/maps`) ; fournisseur réel à choisir. L'adaptateur est injecté.

`VehicleCatalogStore` (`internal/vehicle-catalog/store.ts`) : lecture du catalogue de référence ; adaptateur `PgVehicleCatalogStore` sous `app_api`, aucun FAKE nécessaire. Depuis US-115, `listVariants` et `findVariant` prennent le pays du compte d'hôte (`market` nul ou égal).

`HostListingStore`, `PhotoScanner`, `PhotoStorage` (`internal/host-listings/`) : voir la section US-115 ; FAKE du scanner et du stockage : `@rueda/fake-adapters/files`.

`index.ts` exporte aussi `CatModule`, `VehicleCatalogService`, `PgVehicleCatalogStore`, `prefillFromVariant`, `CatalogError` et leurs types.

## Commandes de test

- Unitaires (sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/cat` (`internal/map-tiles.port.test.ts`, `internal/vehicle-catalog/seed-sql.test.ts`, `internal/vehicle-catalog/vehicle-catalog.service.test.ts`, `internal/host-listings/model.test.ts`, `internal/host-listings/photo-ingest.test.ts`, contrat HTTP `testing/host-listings.contract.test.ts`).
- Intégration : `internal/vehicle-catalog/vehicle-catalog.int.test.ts` (`pnpm --filter @rueda/api test:int`, sous `app_api`, PA et PY).
- Preuves L0 : `packages/db/test/l0/l0-us114-catalog-addition.test.ts` (fixture `9988_test_us114_catalog_addition_fixtures.sql`) ; `packages/db/test/l0/l0-us113-vehicle-catalog.test.ts` ; fixture `packages/db/test-migrations/9970_test_us113_catalog_fixtures.sql` ; `packages/db/test/l0/l0-us115-host-listings.test.ts` ; fixture `packages/db/test-migrations/9985_test_us115_catalog_host_fixtures.sql`.

`test:int` et `test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
