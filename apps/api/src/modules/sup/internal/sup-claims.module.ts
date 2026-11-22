/**
 * Module Nest des déclarations de dommage et des décisions dans la console (US-309, ADR-195) :
 * routes `/console/claims` et `/console/claims/{claimId}…`. Module DYNAMIQUE, importé par le seul
 * processus API après `StaffConsoleModule` (StaffGuard, global).
 *
 * Adaptateur choisi par l'appelant : production `postgresClaims(pool)` (portes PostgreSQL sous
 * app_api) ; tests : double du magasin. Sans magasin : 503 après les gardes (fail-closed).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { PgClaimStore, UNAVAILABLE_CLAIM_STORE } from '../../clm/index.js';
import type { ClaimStore, EvidenceSqlPool } from '../../clm/index.js';
import { ClaimsController } from './claims.controller.js';
import { CLAIM_STORE } from './tokens.js';

export interface SupClaimsOptions {
  readonly store?: ClaimStore;
}

/** Production (bêta) : portes PostgreSQL `core.support_staff_*claim*` sous app_api. */
export function postgresClaims(pool: EvidenceSqlPool): SupClaimsOptions {
  return { store: new PgClaimStore(pool) };
}

@Module({})
export class SupClaimsModule {
  static register(options: SupClaimsOptions = {}): DynamicModule {
    return {
      module: SupClaimsModule,
      controllers: [ClaimsController],
      providers: [{ provide: CLAIM_STORE, useValue: options.store ?? UNAVAILABLE_CLAIM_STORE }],
    };
  }
}
