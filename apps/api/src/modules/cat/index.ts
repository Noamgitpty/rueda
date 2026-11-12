// Point d'entrée public du module CAT. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, cat.module.ts) est privé (règle rueda/module-boundaries).
export { CatModule } from './cat.module.js';

// Port MapTiles (US-020, ADR-058) : types seulement ; l'adaptateur est injecté.
export type { MapTiles, MapTilesOutcome, Tile, TileRequest } from './internal/map-tiles.port.js';

// Catalogue de référence des véhicules (US-113, ADR-094) : lecture et préremplissage ; routes de
// l'hôte branchées par US-115 (filtre du marché du compte d'hôte) ; magasin PostgreSQL sous app_api.
export { CatalogError } from './internal/vehicle-catalog/errors.js';
export type { CatalogErrorCode } from './internal/vehicle-catalog/errors.js';
export { prefillFromVariant, US_REFERENCE_LABEL } from './internal/vehicle-catalog/prefill.js';
export type {
  ConsumptionPrefill,
  VariantView,
  VehicleFuel,
  VehiclePrefill,
  VehicleTransmission,
} from './internal/vehicle-catalog/prefill.js';
export { PgVehicleCatalogStore } from './internal/vehicle-catalog/store.js';
export type {
  MakeOption,
  ModelOption,
  VariantOption,
  VehicleCatalogStore,
} from './internal/vehicle-catalog/store.js';
export { VehicleCatalogService } from './internal/vehicle-catalog/vehicle-catalog.service.js';

// Lieux de remise, véhicules et annonces de l'hôte (US-115, ADR-099) : routes /host/accounts/…,
// fiche publique /listings/{id}, adaptateurs PostgreSQL de production.
export {
  CatHostModule,
  postgresCatAdapters,
  UNAVAILABLE_CAT_HOST,
} from './internal/host-listings/cat-host.module.js';
export type { CatHostOptions } from './internal/host-listings/cat-host.module.js';
export { HOST_LISTING_MESSAGES } from './internal/host-listings/errors.js';
export { HostListingsService } from './internal/host-listings/host-listings.service.js';
export type { PhotoPipeline } from './internal/host-listings/host-listings.service.js';
export {
  DEFAULT_PHOTO_LIMITS,
  preparePhoto,
  sniffPhotoMime,
  UnavailablePhotoScanner,
  UnavailablePhotoStorage,
} from './internal/host-listings/photo-ingest.js';
export type { PhotoScanner, PhotoStorage } from './internal/host-listings/photo-ingest.js';
export { PgHostListingStore, UnavailableHostListingStore } from './internal/host-listings/store.js';
export type { HostListingStore } from './internal/host-listings/store.js';

// Calendrier par véhicule, blocages et préavis de l'hôte (US-119, ADR-102) : routes
// /host/accounts/{orgId}/vehicles/{vehicleId}/calendar|blocks, …/locations/{locationId}/notice.
export {
  PgHostCalendarStore,
  UnavailableHostCalendarStore,
} from './internal/host-calendar/store.js';
export type {
  CalendarEntry,
  CalendarHeader,
  HostCalendarStore,
  OccupancyKind,
} from './internal/host-calendar/store.js';
