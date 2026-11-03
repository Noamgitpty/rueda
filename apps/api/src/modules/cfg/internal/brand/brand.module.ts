/**
 * Module Nest du socle de marque (US-034), importé par le seul processus API. Module DYNAMIQUE et
 * global : `BrandConsoleService` (écritures, appelées par la console SUP sous `StaffGuard`) et
 * `BrandReadService` (lecture publique mise en cache) sont injectables par les autres modules.
 *
 * Adaptateurs choisis par l'appelant : production `PgBrandStore` + `UnavailableBrandFileStore`
 * (aucun stockage objet avant US-003 : fail-closed) ; tests : `InMemoryFileStore` (FAKE).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { BrandController } from './brand.controller.js';
import { BrandConsoleService, BrandReadService } from './brand.service.js';
import type { BrandOptions } from './brand.service.js';
import { BRAND_FILES, BRAND_PARAMS } from './tokens.js';

@Module({})
export class BrandModule {
  static register(options: BrandOptions): DynamicModule {
    const read = new BrandReadService(options);
    const console = new BrandConsoleService(options, read);
    return {
      module: BrandModule,
      global: true,
      controllers: [BrandController],
      providers: [
        { provide: BrandReadService, useValue: read },
        { provide: BrandConsoleService, useValue: console },
        { provide: BRAND_FILES, useValue: options.files },
        { provide: BRAND_PARAMS, useValue: options.params },
      ],
      exports: [BrandReadService, BrandConsoleService],
    };
  }
}
