/**
 * Module Nest des vues de la bêta et du rapprochement assisté (US-311, ADR-194), importé par le
 * seul processus API après `StaffConsoleModule` (StaffGuard) : routes `/console/beta-views/…` et
 * `/console/reconciliation/…`. Sans magasin : 503 (fail-closed).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ReportConsoleController } from './console.controller.js';
import { UnavailableReportStore } from './store.js';
import type { ReportStore } from './store.js';
import { REPORT_STORE } from './tokens.js';

@Module({})
export class RptConsoleModule {
  static register(store?: ReportStore): DynamicModule {
    return {
      module: RptConsoleModule,
      controllers: [ReportConsoleController],
      providers: [{ provide: REPORT_STORE, useValue: store ?? new UnavailableReportStore() }],
    };
  }
}
