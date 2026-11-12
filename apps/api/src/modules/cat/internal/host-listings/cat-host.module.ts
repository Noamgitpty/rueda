/**
 * Module Nest des lieux, véhicules et annonces de l'hôte (US-115, ADR-099). Module DYNAMIQUE,
 * importé par le seul processus API (`api.module.ts`), après `IamAuthModule` (il utilise
 * `SessionGuard`).
 *
 * Adaptateurs choisis par l'appelant : production `postgresCatAdapters(pool)` (magasin et
 * catalogue de référence sous app_api ; antivirus et stockage objet INDISPONIBLES tant que Q-019
 * et US-003 ne sont pas livrés : photos 503, fail-closed) ; tests : FAKE de `../../testing/`.
 * Sans options, toute route répond 503 (aucun magasin). Calendrier de l'hôte (US-119, ADR-102) :
 * magasin `calendar` (production : commandes `core.catalog_*` de 0072).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { HostCalendarController } from '../host-calendar/host-calendar.controller.js';
import { HostCalendarService } from '../host-calendar/host-calendar.service.js';
import { PgHostCalendarStore, UnavailableHostCalendarStore } from '../host-calendar/store.js';
import type { HostCalendarStore } from '../host-calendar/store.js';
import { VehicleCatalogService } from '../vehicle-catalog/vehicle-catalog.service.js';
import { PgVehicleCatalogStore } from '../vehicle-catalog/store.js';
import { HostListingsController } from './host-listings.controller.js';
import { HostListingsService } from './host-listings.service.js';
import type { PhotoPipeline } from './host-listings.service.js';
import { UnavailablePhotoScanner, UnavailablePhotoStorage } from './photo-ingest.js';
import { PublicListingController } from './public-listing.controller.js';
import { PgHostListingStore, UnavailableHostListingStore } from './store.js';
import type { HostListingStore, SqlExecutor, SqlPool } from './store.js';

export interface CatHostOptions {
  readonly store: HostListingStore;
  /** Catalogue de référence (US-113) ; `null` : listes de choix 503. */
  readonly catalog: VehicleCatalogService | null;
  readonly photos: PhotoPipeline;
  /** Calendrier, blocages et préavis (US-119) ; absent : 503 (fail-closed). */
  readonly calendar?: HostCalendarStore;
}

/** Aucun adaptateur : 503 partout (fail-closed). */
export const UNAVAILABLE_CAT_HOST: CatHostOptions = {
  store: new UnavailableHostListingStore(),
  catalog: null,
  photos: { scanner: new UnavailablePhotoScanner(), storage: new UnavailablePhotoStorage() },
};

/**
 * Production : commandes `core.catalog_*` et catalogue sous app_api ; photos fail-closed. `pool` :
 * pool de connexions (transaction du dépôt d'une photo) ; sans pool, le dépôt est refusé.
 */
export function postgresCatAdapters(db: SqlExecutor, pool: SqlPool | null = null): CatHostOptions {
  return {
    store: new PgHostListingStore(db, pool),
    catalog: new VehicleCatalogService(new PgVehicleCatalogStore(db)),
    photos: { scanner: new UnavailablePhotoScanner(), storage: new UnavailablePhotoStorage() },
    calendar: new PgHostCalendarStore(db),
  };
}

@Module({})
export class CatHostModule {
  static register(options: CatHostOptions = UNAVAILABLE_CAT_HOST): DynamicModule {
    return {
      module: CatHostModule,
      controllers: [HostListingsController, PublicListingController, HostCalendarController],
      providers: [
        {
          provide: HostListingsService,
          useValue: new HostListingsService(options.store, options.catalog, options.photos),
        },
        {
          provide: HostCalendarService,
          useValue: new HostCalendarService(options.calendar ?? new UnavailableHostCalendarStore()),
        },
      ],
    };
  }
}
