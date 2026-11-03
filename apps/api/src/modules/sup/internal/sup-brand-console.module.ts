/**
 * Module Nest de la console « Apparence / Marque » (US-034), importé par le seul processus API
 * après `StaffConsoleModule` (StaffGuard) et `BrandModule` de CFG (BrandConsoleService), tous deux
 * globaux.
 */
import { Module } from '@nestjs/common';
import { BrandConsoleController } from './brand-console.controller.js';

@Module({ controllers: [BrandConsoleController] })
export class SupBrandConsoleModule {}
