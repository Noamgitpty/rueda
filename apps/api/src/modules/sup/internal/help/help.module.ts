/**
 * Module Nest de l'aide et de l'urgence (US-310, ADR-182), importé par le seul processus API après
 * IAM (SessionGuard) et `StaffConsoleModule` (StaffGuard) : routes `/help`, `/trips/{id}/help`,
 * `/trips/{id}/help-requests` et `/console/help-requests`. Sans magasin : 503 (fail-closed) ; la
 * route publique `/help` ne lit que la configuration pays.
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { CfgModule } from '../../../cfg/index.js';
import { HelpConsoleController } from './help-console.controller.js';
import { HelpController } from './help.controller.js';
import { TripHelpController } from './trip-help.controller.js';
import { UnavailableHelpStore } from './help-store.js';
import type { HelpStore } from './help-store.js';
import { HELP_STORE } from './tokens.js';

@Module({})
export class SupHelpModule {
  static register(store?: HelpStore): DynamicModule {
    return {
      module: SupHelpModule,
      imports: [CfgModule],
      controllers: [HelpController, TripHelpController, HelpConsoleController],
      providers: [{ provide: HELP_STORE, useValue: store ?? new UnavailableHelpStore() }],
    };
  }
}
