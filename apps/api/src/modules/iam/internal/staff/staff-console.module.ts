/**
 * Module Nest de la console interne côté IAM (US-012) : MFA du staff, suspension, réinitialisation
 * du TOTP, journal. Module DYNAMIQUE et global, importé par le seul processus API, APRÈS
 * `IamAuthModule` (il réutilise `SessionGuard` et l'horloge). `StaffGuard` et `StaffAuthService`
 * sont injectables par les autres modules (SUP : actions de console).
 *
 * Adaptateurs choisis par l'appelant : production `postgresStaffAdapters` (coffre indisponible
 * tant qu'US-003 n'a pas livré le coffre géré : fail-closed) ; tests : FAKE de `../../testing/`.
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { StaffController } from './staff.controller.js';
import { StaffGuard } from './staff.guard.js';
import { StaffAuthService } from './staff.service.js';
import type { StaffOptions } from './staff.service.js';
import { STAFF_OPTIONS } from './staff-tokens.js';

@Module({})
export class StaffConsoleModule {
  static register(options: StaffOptions): DynamicModule {
    return {
      module: StaffConsoleModule,
      global: true,
      controllers: [StaffController],
      providers: [{ provide: STAFF_OPTIONS, useValue: options }, StaffAuthService, StaffGuard],
      exports: [StaffAuthService, StaffGuard],
    };
  }
}
