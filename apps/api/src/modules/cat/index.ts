// Point d'entrée public du module CAT. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, cat.module.ts) est privé (règle rueda/module-boundaries).
export { CatModule } from './cat.module.js';

// Port MapTiles (US-020, ADR-058) : types seulement ; l'adaptateur est injecté.
export type { MapTiles, MapTilesOutcome, Tile, TileRequest } from './internal/map-tiles.port.js';

// Catalogue de référence des véhicules (US-113, ADR-094) : lecture et préremplissage. La route et
// l'assistant de l'hôte (A10) arrivent avec US-115 ; le magasin PostgreSQL lit sous app_api.
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
