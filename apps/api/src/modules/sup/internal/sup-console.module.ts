/**
 * Module Nest des actions de console (US-012, US-101), des files de revue, de la fiche 360°, des
 * notes, des dossiers et des pièces du staff (US-109), importé par le seul processus API après
 * `StaffConsoleModule` (module global d'IAM qui fournit `StaffGuard`).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConsoleController } from './console.controller.js';
import { EvidenceService } from './evidence.js';
import type { EvidenceOptions } from './evidence.js';
import type { FinanceApprovalStore } from './finance-approval-store.js';
import type { ManualActionStore } from './manual-action-store.js';
import { OpsConsoleController } from './ops-console.controller.js';
import type { OpsConsoleStore } from './ops-console-store.js';
import {
  EVIDENCE_SERVICE,
  FINANCE_APPROVAL_STORE,
  MANUAL_ACTION_STORE,
  OPS_CONSOLE_STORE,
} from './tokens.js';

export interface SupConsoleOptions {
  readonly store: ManualActionStore;
  /** Demandes FINANCE en attente et approbation par une seconde personne (US-101). */
  readonly finance: FinanceApprovalStore;
  /** Files de revue, fiche 360°, notes, dossiers, droit aux pièces (US-109). */
  readonly ops: OpsConsoleStore;
  /** Pièces du staff : transaction, antivirus, coffre, stockage (US-109 ; production : indisponibles). */
  readonly evidence: EvidenceOptions;
}

@Module({})
export class SupConsoleModule {
  static register(options: SupConsoleOptions): DynamicModule {
    return {
      module: SupConsoleModule,
      controllers: [ConsoleController, OpsConsoleController],
      providers: [
        { provide: MANUAL_ACTION_STORE, useValue: options.store },
        { provide: FINANCE_APPROVAL_STORE, useValue: options.finance },
        { provide: OPS_CONSOLE_STORE, useValue: options.ops },
        {
          provide: EVIDENCE_SERVICE,
          useValue: new EvidenceService(options.ops, options.evidence),
        },
      ],
    };
  }
}
