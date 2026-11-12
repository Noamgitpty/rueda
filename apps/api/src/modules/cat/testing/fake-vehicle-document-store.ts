/**
 * FAKE du magasin des pièces et de l'éligibilité du véhicule (US-124) — TESTS SEULEMENT (absent de
 * la compilation de production). L'issue de chaque commande est imposée par le test ; les règles
 * elles-mêmes (âge, compteur, catalogue, titre, prenda, pièces exigées, IDOR) sont prouvées sur
 * PostgreSQL (packages/db/test/l0/l0-us124-vehicle-documents.test.ts).
 */
import { HostListingStoreError } from '../internal/host-listings/store.js';
import type { SqlExecutor } from '../internal/host-listings/store.js';
import type { DeclarationInput, DocumentType } from '../internal/vehicle-documents/model.js';
import type {
  ClaimView,
  DepositFn,
  FileRecord,
  Submission,
  VehicleDocumentStore,
  VehicleEligibility,
} from '../internal/vehicle-documents/store.js';

/** Exécuteur de la « transaction » du FAKE : aucune requête attendue. */
const TX: SqlExecutor = {
  query: () => Promise.reject(new Error('aucune requête attendue dans la transaction du FAKE')),
};

export class FakeVehicleDocumentStore implements VehicleDocumentStore {
  /** Issue imposée par méthode (défaut : succès). */
  readonly outcome: Record<string, string> = {};
  readonly reasons: string[] = [];
  failing = false;
  readonly deposited: { key: string; type: DocumentType | 'CLAIM'; file: FileRecord }[] = [];
  vehicles: VehicleEligibility[] = [];
  claimsList: ClaimView[] = [];

  #out(method: string, fallback: string): Promise<string> {
    if (this.failing) return Promise.reject(new HostListingStoreError('panne', '08006'));
    return Promise.resolve(this.outcome[method] ?? fallback);
  }

  /** Dernières déclarations reçues (la validation du corps a eu lieu avant le magasin). */
  readonly declared: DeclarationInput[] = [];

  declare(_proof: Buffer, _org: string, _vehicle: string, input: DeclarationInput) {
    this.declared.push(input);
    return this.#out('declare', 'DONE');
  }

  documentPermitted() {
    return this.#out('documentPermitted', 'OK');
  }

  async #deposit(
    method: string,
    key: string,
    type: DocumentType | 'CLAIM',
    file: FileRecord,
    prepare: (tx: SqlExecutor) => Promise<void>,
    deposit: DepositFn,
  ): Promise<string> {
    const outcome = await this.#out(method, 'DONE');
    await prepare(TX);
    if (outcome !== 'DONE') return outcome;
    await deposit(TX, key);
    this.deposited.push({ key, type, file });
    return 'DONE';
  }

  addDocument(
    _p: Buffer,
    orgId: string,
    vehicleId: string,
    type: DocumentType,
    _until: string | null,
    file: FileRecord,
    prepare: (tx: SqlExecutor) => Promise<void>,
    deposit: DepositFn,
  ) {
    const key = `vehicle-documents/${orgId}/${vehicleId}/${file.fileId}`;
    return this.#deposit('addDocument', key, type, file, prepare, deposit);
  }

  async submit(): Promise<Submission> {
    const outcome = await this.#out('submit', 'DONE');
    return {
      outcome,
      itemId: outcome === 'DONE' ? '00000000-0000-4000-8000-0000000000c1' : null,
      reasons:
        outcome === 'DONE' || outcome === 'ELIGIBLE'
          ? []
          : this.reasons.length > 0
            ? [...this.reasons]
            : [outcome],
    };
  }

  async eligibility(): Promise<VehicleEligibility[]> {
    await this.#out('eligibility', 'OK');
    return this.vehicles;
  }

  claimPermitted() {
    return this.#out('claimPermitted', 'OK');
  }

  openClaim(
    _p: Buffer,
    orgId: string,
    _plate: string,
    _vin: string | null,
    file: FileRecord,
    prepare: (tx: SqlExecutor) => Promise<void>,
    deposit: DepositFn,
  ) {
    const key = `vehicle-documents/${orgId}/${file.fileId}/${file.fileId}`;
    return this.#deposit('openClaim', key, 'CLAIM', file, prepare, deposit);
  }

  async claims(): Promise<ClaimView[]> {
    await this.#out('claims', 'OK');
    return this.claimsList;
  }
}
