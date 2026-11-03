/**
 * Module Nest des actions de console (US-012), importé par le seul processus API après
 * `StaffConsoleModule` (module global d'IAM qui fournit `StaffGuard`).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConsoleController } from './console.controller.js';
import type { ManualActionStore } from './manual-action-store.js';
import { MANUAL_ACTION_STORE } from './tokens.js';

export interface SupConsoleOptions {
  readonly store: ManualActionStore;
}

@Module({})
export class SupConsoleModule {
  static register(options: SupConsoleOptions): DynamicModule {
    return {
      module: SupConsoleModule,
      controllers: [ConsoleController],
      providers: [{ provide: MANUAL_ACTION_STORE, useValue: options.store }],
    };
  }
}
