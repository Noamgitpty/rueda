/**
 * Module Nest du dossier de preuve dans la console (US-308, ADR-184) : routes
 * `/console/evidence-bundles` et `/console/evidence-bundles/{bundleId}…`. Module
 * DYNAMIQUE, importé par le seul processus API après `StaffConsoleModule` (StaffGuard, global).
 *
 * Adaptateurs choisis par l'appelant : production `postgresEvidenceBundle(pool)` (portes
 * PostgreSQL ; coffre et stockage indisponibles : routes 503) ; tests : coffre `SubjectKeyStore`
 * sur `FakeKeyWrapper` et `InMemoryFileStore`. Sans service : magasin, coffre et stockage
 * indisponibles (503 après les gardes).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import {
  EvidenceBundleService,
  EvidenceStoreError,
  PgEvidenceBundleStore,
  UnavailableEvidenceExportFiles,
  UnavailableEvidenceExportVault,
} from '../../clm/index.js';
import type { EvidenceBundleStore, EvidenceSqlPool } from '../../clm/index.js';
import { EvidenceBundleController } from './evidence-bundle.controller.js';
import { EVIDENCE_BUNDLE_SERVICE } from './tokens.js';

export interface SupEvidenceBundleOptions {
  readonly service?: EvidenceBundleService;
}

/** Magasin absent : toute transaction échoue en 503 (fail-closed). */
const UNAVAILABLE_STORE: EvidenceBundleStore = {
  transaction: () => Promise.reject(new EvidenceStoreError(null)),
  request: () => Promise.reject(new EvidenceStoreError(null)),
  status: () => Promise.reject(new EvidenceStoreError(null)),
  open: () => Promise.reject(new EvidenceStoreError(null)),
};

export function unavailableEvidenceBundle(): EvidenceBundleService {
  return new EvidenceBundleService({
    store: UNAVAILABLE_STORE,
    vault: new UnavailableEvidenceExportVault(),
    files: new UnavailableEvidenceExportFiles(),
  });
}

/**
 * Production (bêta) : portes PostgreSQL sous app_api ; coffre KMS et stockage à verrou objet
 * (US-003, lot C ; Q-007) pas encore livrés : indisponibles (routes 503, jamais un FAKE).
 */
export function postgresEvidenceBundle(
  pool: EvidenceSqlPool,
  log?: (line: string) => void,
): SupEvidenceBundleOptions {
  return {
    service: new EvidenceBundleService({
      store: new PgEvidenceBundleStore(pool),
      vault: new UnavailableEvidenceExportVault(),
      files: new UnavailableEvidenceExportFiles(),
      ...(log === undefined ? {} : { log }),
    }),
  };
}

@Module({})
export class SupEvidenceBundleModule {
  static register(options: SupEvidenceBundleOptions = {}): DynamicModule {
    return {
      module: SupEvidenceBundleModule,
      controllers: [EvidenceBundleController],
      providers: [
        {
          provide: EVIDENCE_BUNDLE_SERVICE,
          useValue: options.service ?? unavailableEvidenceBundle(),
        },
      ],
    };
  }
}
