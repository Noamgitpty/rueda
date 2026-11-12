/**
 * Port et adaptateur PostgreSQL des pièces et de l'éligibilité du véhicule (US-124, migration
 * 0077). L'adaptateur n'appelle QUE les fonctions `core.catalog_*` (SECURITY DEFINER, propriétaire
 * catalog_cmd_owner, EXECUTE au seul app_api) : app_api n'a aucun droit sur les tables. L'hôte est
 * désigné par l'empreinte de son jeton (`proof`), jamais par un identifiant reçu du client.
 * Requêtes paramétrées ; une erreur de la base devient `HostListingStoreError` (SQLSTATE seulement).
 */
import { HostListingStoreError } from '../host-listings/store.js';
import type { SqlClient, SqlExecutor, SqlPool } from '../host-listings/store.js';
import type { DeclarationInput, DocumentType, EligibilityStatus, TitleHolder } from './model.js';
import { attestationWording } from './model.js';

export interface DocumentView {
  readonly documentId: string;
  readonly type: DocumentType;
  readonly status: 'SUBMITTED' | 'VALID' | 'REJECTED';
  readonly validUntil: string | null;
  readonly rejectReason: string | null;
  readonly mime: string;
  readonly bytes: number;
  readonly createdAt: string;
}

/** Éligibilité d'un véhicule vue par l'hôte : jamais la clé de stockage, jamais l'auteur. */
export interface VehicleEligibility {
  readonly vehicleId: string;
  readonly eligibilityStatus: EligibilityStatus;
  readonly titleHolder: TitleHolder | null;
  readonly lienDeclared: boolean;
  readonly odometerKm: number | null;
  readonly ownershipAttested: boolean;
  readonly lienAttested: boolean;
  readonly hasVin: boolean;
  readonly reasons: readonly string[];
  readonly released: boolean;
  readonly publishable: boolean;
  readonly underReview: boolean;
  readonly submittedAt: string | null;
  readonly checkedAt: string | null;
  readonly requiredDocuments: readonly DocumentType[];
  readonly documents: readonly DocumentView[];
}

export interface ClaimView {
  readonly claimId: string;
  readonly plate: string;
  readonly status: 'OPEN' | 'UPHELD' | 'DISMISSED';
  readonly dismissReason: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

export interface FileRecord {
  readonly fileId: string;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: Buffer;
}

export interface Submission {
  readonly outcome: string;
  readonly itemId: string | null;
  readonly reasons: readonly string[];
}

/** Rappel de la transaction d'un dépôt : clé de la personne, chiffrement et dépôt de l'objet. */
export type DepositFn = (tx: SqlExecutor, storageKey: string) => Promise<void>;

export interface VehicleDocumentStore {
  declare(proof: Buffer, orgId: string, vehicleId: string, i: DeclarationInput): Promise<string>;
  /** Droit de déposer, jugé AVANT l'antivirus (n'écrit rien). */
  documentPermitted(proof: Buffer, orgId: string, vehicleId: string): Promise<string>;
  /**
   * Transaction : `prepare(tx)` (clé de la personne), ligne `file_asset` et pièce, puis
   * `deposit(tx, storageKey)` AVANT la validation ; tout échec annule. Issue de la base.
   */
  addDocument(
    proof: Buffer,
    orgId: string,
    vehicleId: string,
    type: DocumentType,
    validUntil: string | null,
    file: FileRecord,
    prepare: (tx: SqlExecutor) => Promise<void>,
    deposit: DepositFn,
  ): Promise<string>;
  submit(proof: Buffer, orgId: string, vehicleId: string): Promise<Submission>;
  eligibility(proof: Buffer, orgId: string): Promise<VehicleEligibility[]>;
  claimPermitted(proof: Buffer, orgId: string, plate: string, vin: string | null): Promise<string>;
  openClaim(
    proof: Buffer,
    orgId: string,
    plate: string,
    vin: string | null,
    file: FileRecord,
    prepare: (tx: SqlExecutor) => Promise<void>,
    deposit: DepositFn,
  ): Promise<string>;
  claims(proof: Buffer, orgId: string): Promise<ClaimView[]>;
}

/** Magasin indisponible : toute route répond 503 (fail-closed). */
export class UnavailableVehicleDocumentStore implements VehicleDocumentStore {
  #fail(): Promise<never> {
    return Promise.reject(new HostListingStoreError('pièces : magasin indisponible', undefined));
  }
  declare = (): Promise<string> => this.#fail();
  documentPermitted = (): Promise<string> => this.#fail();
  addDocument = (): Promise<string> => this.#fail();
  submit = (): Promise<Submission> => this.#fail();
  eligibility = (): Promise<VehicleEligibility[]> => this.#fail();
  claimPermitted = (): Promise<string> => this.#fail();
  openClaim = (): Promise<string> => this.#fail();
  claims = (): Promise<ClaimView[]> => this.#fail();
}

const sqlstateOf = (error: unknown): string | undefined =>
  typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v);

/** Échec d'un dépôt (clé, chiffrement, stockage) : la transaction est annulée. */
export class DepositError extends Error {
  override readonly name = 'DepositError';
}

export class PgVehicleDocumentStore implements VehicleDocumentStore {
  constructor(
    private readonly db: SqlExecutor,
    private readonly pool: SqlPool | null = null,
  ) {}

  async #one<R extends Record<string, unknown>>(
    operation: string,
    sql: string,
    values: readonly unknown[],
  ): Promise<R | undefined> {
    try {
      return (await this.db.query<R>(sql, values)).rows[0];
    } catch (error) {
      throw new HostListingStoreError(operation, sqlstateOf(error));
    }
  }

  async declare(proof: Buffer, orgId: string, vehicleId: string, i: DeclarationInput) {
    // libellé affiché des engagements, historisé par la base avec sa version (ADR-113)
    const wording = attestationWording(i.locale);
    const r = await this.#one<{ outcome: string }>(
      'déclaration du véhicule',
      `SELECT r.outcome FROM core.catalog_cmd_declare_vehicle($1, $2::uuid, $3::uuid, $4, $5::boolean,
                                                              $6::integer, $7::boolean,
                                                              $8::boolean, $9, $10, $11::integer,
                                                              $12, $13) AS r`,
      [
        proof,
        orgId,
        vehicleId,
        i.titleHolder,
        i.lienDeclared,
        i.odometerKm,
        i.ownershipAttested,
        i.lienAttested,
        i.vin,
        wording.locale,
        wording.catalogVersion,
        wording.ownership,
        wording.lien,
      ],
    );
    return r?.outcome ?? 'LISTING_UNAVAILABLE';
  }

  async documentPermitted(proof: Buffer, orgId: string, vehicleId: string) {
    const r = await this.#one<{ outcome: string }>(
      'droit de dépôt',
      'SELECT r.outcome FROM core.catalog_vehicle_document_permitted($1, $2::uuid, $3::uuid) AS r',
      [proof, orgId, vehicleId],
    );
    return r?.outcome ?? 'LISTING_UNAVAILABLE';
  }

  async #transaction(
    operation: string,
    prepare: (tx: SqlExecutor) => Promise<void>,
    command: (tx: SqlExecutor) => Promise<{ outcome: string; key: string | null }>,
    deposit: DepositFn,
  ): Promise<string> {
    if (this.pool === null)
      throw new HostListingStoreError(`${operation} : pool requis`, undefined);
    let client: SqlClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw new HostListingStoreError(`${operation} : connexion`, sqlstateOf(error) ?? '08006');
    }
    try {
      await client.query('BEGIN');
      await prepare(client);
      const r = await command(client);
      if (r.outcome !== 'DONE' || r.key === null) {
        await client.query('ROLLBACK');
        return r.outcome === 'DUPLICATE' ? 'DONE' : r.outcome;
      }
      // ligne d'abord (collision de clé refusée par la base), objet ensuite, validation enfin
      await deposit(client, r.key);
      await client.query('COMMIT');
      return 'DONE';
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof DepositError || error instanceof HostListingStoreError) throw error;
      if (sqlstateOf(error) !== undefined)
        throw new HostListingStoreError(operation, sqlstateOf(error));
      throw error;
    } finally {
      client.release();
    }
  }

  addDocument(
    proof: Buffer,
    orgId: string,
    vehicleId: string,
    type: DocumentType,
    validUntil: string | null,
    file: FileRecord,
    prepare: (tx: SqlExecutor) => Promise<void>,
    deposit: DepositFn,
  ): Promise<string> {
    return this.#transaction(
      'pièce',
      prepare,
      async (tx) => {
        const { rows } = await tx.query<{ outcome: string; storage_key: string | null }>(
          `SELECT r.outcome, r.storage_key
             FROM core.catalog_cmd_add_vehicle_document($1, $2::uuid, $3::uuid, $4::uuid, $5, $6,
                                                        $7::bigint, $8, $9::date) AS r`,
          [
            proof,
            orgId,
            vehicleId,
            file.fileId,
            type,
            file.mime,
            file.bytes,
            file.sha256,
            validUntil,
          ],
        );
        return {
          outcome: rows[0]?.outcome ?? 'LISTING_UNAVAILABLE',
          key: rows[0]?.storage_key ?? null,
        };
      },
      deposit,
    );
  }

  async submit(proof: Buffer, orgId: string, vehicleId: string): Promise<Submission> {
    const r = await this.#one<{
      outcome: string;
      item_id: string | null;
      reasons: string[] | null;
    }>(
      'soumission du véhicule',
      `SELECT r.outcome, r.item_id::text AS item_id, r.reasons
         FROM core.catalog_cmd_submit_vehicle_eligibility($1, $2::uuid, $3::uuid) AS r`,
      [proof, orgId, vehicleId],
    );
    return {
      outcome: r?.outcome ?? 'LISTING_UNAVAILABLE',
      itemId: r?.item_id ?? null,
      reasons: r?.reasons ?? [],
    };
  }

  async eligibility(proof: Buffer, orgId: string): Promise<VehicleEligibility[]> {
    let rows: { body: Record<string, unknown> }[];
    try {
      rows = (
        await this.db.query<{ body: Record<string, unknown> }>(
          'SELECT r.body FROM core.catalog_host_vehicle_eligibility($1, $2::uuid) AS r',
          [proof, orgId],
        )
      ).rows;
    } catch (error) {
      throw new HostListingStoreError('éligibilité', sqlstateOf(error));
    }
    return rows.map(({ body: b }) => ({
      vehicleId: String(b['vehicleId']),
      eligibilityStatus: b['eligibilityStatus'] as EligibilityStatus,
      titleHolder: (b['titleHolder'] ?? null) as TitleHolder | null,
      lienDeclared: b['lienDeclared'] === true,
      odometerKm: typeof b['odometerKm'] === 'number' ? b['odometerKm'] : null,
      ownershipAttested: b['ownershipAttested'] === true,
      lienAttested: b['lienAttested'] === true,
      hasVin: b['hasVin'] === true,
      reasons: Array.isArray(b['reasons']) ? (b['reasons'] as string[]) : [],
      released: b['released'] === true,
      publishable: b['publishable'] === true,
      underReview: b['underReview'] === true,
      submittedAt: iso(b['submittedAt']),
      checkedAt: iso(b['checkedAt']),
      requiredDocuments: Array.isArray(b['requiredDocuments'])
        ? (b['requiredDocuments'] as DocumentType[])
        : [],
      documents: Array.isArray(b['documents'])
        ? (b['documents'] as Record<string, unknown>[]).map((d) => ({
            documentId: String(d['documentId']),
            type: d['type'] as DocumentType,
            status: d['status'] as DocumentView['status'],
            validUntil: iso(d['validUntil']),
            rejectReason: (d['rejectReason'] ?? null) as string | null,
            mime: String(d['mime']),
            bytes: Number(d['bytes']),
            createdAt: iso(d['createdAt']) ?? '',
          }))
        : [],
    }));
  }

  async claimPermitted(proof: Buffer, orgId: string, plate: string, vin: string | null) {
    const r = await this.#one<{ outcome: string }>(
      'droit de contestation',
      'SELECT r.outcome FROM core.catalog_vehicle_claim_permitted($1, $2::uuid, $3, $4) AS r',
      [proof, orgId, plate, vin],
    );
    return r?.outcome ?? 'LISTING_UNAVAILABLE';
  }

  openClaim(
    proof: Buffer,
    orgId: string,
    plate: string,
    vin: string | null,
    file: FileRecord,
    prepare: (tx: SqlExecutor) => Promise<void>,
    deposit: DepositFn,
  ): Promise<string> {
    return this.#transaction(
      'contestation',
      prepare,
      async (tx) => {
        const { rows } = await tx.query<{ outcome: string; storage_key: string | null }>(
          `SELECT r.outcome, r.storage_key
             FROM core.catalog_cmd_open_vehicle_claim($1, $2::uuid, $3, $4, $5::uuid, $6,
                                                      $7::bigint, $8) AS r`,
          [proof, orgId, plate, vin, file.fileId, file.mime, file.bytes, file.sha256],
        );
        return {
          outcome: rows[0]?.outcome ?? 'LISTING_UNAVAILABLE',
          key: rows[0]?.storage_key ?? null,
        };
      },
      deposit,
    );
  }

  async claims(proof: Buffer, orgId: string): Promise<ClaimView[]> {
    let rows: Record<string, unknown>[];
    try {
      rows = (
        await this.db.query<Record<string, unknown>>(
          'SELECT * FROM core.catalog_host_vehicle_claims($1, $2::uuid)',
          [proof, orgId],
        )
      ).rows;
    } catch (error) {
      throw new HostListingStoreError('contestations', sqlstateOf(error));
    }
    return rows.map((r) => ({
      claimId: String(r['claim_id']),
      plate: String(r['plate']),
      status: r['status'] as ClaimView['status'],
      dismissReason: (r['dismiss_reason'] ?? null) as string | null,
      createdAt: iso(r['created_at']) ?? '',
      decidedAt: iso(r['decided_at']),
    }));
  }
}
