/**
 * Module Nest des déclarations de dommage et des décisions dans la console (US-309, ADR-195) :
 * routes `/console/claims` et `/console/claims/{claimId}…` ; décision de l'ops sur un frais annexe
 * contesté (US-706, ADR-197) : routes `/console/incidental-fees/{invoiceId}…`. Module DYNAMIQUE, importé par le seul
 * processus API après `StaffConsoleModule` (StaffGuard, global).
 *
 * Adaptateur choisi par l'appelant : production `postgresClaims(pool)` (portes PostgreSQL sous
 * app_api) ; tests : double du magasin. Sans magasin : 503 après les gardes (fail-closed).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import {
  PgClaimStore,
  PgIncidentalStaffStore,
  UNAVAILABLE_CLAIM_STORE,
  UNAVAILABLE_INCIDENTAL_STAFF_STORE,
} from '../../clm/index.js';
import type { ClaimStore, EvidenceSqlPool, IncidentalStaffStore } from '../../clm/index.js';
import { ClaimsController } from './claims.controller.js';
import { IncidentalFeesController } from './incidental-fees.controller.js';
import { CLAIM_STORE, INCIDENTAL_STAFF_STORE } from './tokens.js';

export interface SupClaimsOptions {
  readonly store?: ClaimStore;
  /** Décision de l'ops sur un frais annexe contesté (US-706) ; absent : 503. */
  readonly incidental?: IncidentalStaffStore;
}

/**
 * Production (bêta) : portes PostgreSQL `core.support_staff_*claim*` et
 * `core.support_staff_*incidental` sous app_api.
 */
export function postgresClaims(pool: EvidenceSqlPool): SupClaimsOptions {
  return { store: new PgClaimStore(pool), incidental: new PgIncidentalStaffStore(pool) };
}

@Module({})
export class SupClaimsModule {
  static register(options: SupClaimsOptions = {}): DynamicModule {
    return {
      module: SupClaimsModule,
      controllers: [ClaimsController, IncidentalFeesController],
      providers: [
        { provide: CLAIM_STORE, useValue: options.store ?? UNAVAILABLE_CLAIM_STORE },
        {
          provide: INCIDENTAL_STAFF_STORE,
          useValue: options.incidental ?? UNAVAILABLE_INCIDENTAL_STAFF_STORE,
        },
      ],
    };
  }
}
