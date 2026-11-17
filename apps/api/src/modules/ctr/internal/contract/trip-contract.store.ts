/**
 * Port et adaptateur PostgreSQL du contrat de location d'un trip (US-211 partie 211b, ADR-149 ;
 * fonctions de la migration 0122, ADR-143). L'adaptateur n'appelle QUE :
 *   - `core.booking_trip_contract` (lecture d'une version par une partie du trip) ;
 *   - `core.booking_cmd_sign_contract` (signature du voyageur, empreinte présentée).
 * Les deux sont `SECURITY DEFINER`, `EXECUTE` au seul `app_api` ; la personne est désignée par
 * l'empreinte de son jeton de session (`proof`), jamais par un identifiant reçu : la base juge la
 * partie (voyageur ou titulaire du compte d'hôte) et rend `NOT_FOUND` à toute autre personne.
 * Requêtes paramétrées ; une erreur de la base devient `ContractStoreError` (SQLSTATE seulement).
 */

export type ContractViewerRole = 'GUEST' | 'HOST';

export interface ContractSignatureRow {
  readonly signatureId: string;
  readonly signedAt: Date;
  readonly sealSha256: string;
}

/** Une version du contrat telle que la base la rend à une partie du trip. */
export interface ContractDocumentRow {
  readonly viewerRole: ContractViewerRole;
  readonly documentId: string;
  readonly version: number;
  readonly latestVersion: number;
  /** Langue de la traduction de courtoisie (en, fr, pt). */
  readonly locale: string;
  readonly generatedAt: Date;
  /** SHA-256 (hexadécimal) du PDF du document à signer. */
  readonly sha256: string;
  readonly renderer: string;
  readonly terms: unknown;
  readonly derived: unknown;
  /** Texte figé ; `null` après pseudonymisation de la partie nominative. */
  readonly body: unknown;
  /** Gabarit non validé par l'avocat (BROUILLON, GL-23). */
  readonly draft: boolean;
  readonly signature: ContractSignatureRow | null;
}

export type ContractReadResult =
  | { readonly outcome: 'OK'; readonly document: ContractDocumentRow }
  | { readonly outcome: 'NOT_FOUND' | 'NOT_GENERATED' };

export type ContractSignOutcome =
  | {
      readonly outcome: 'SIGNED' | 'ALREADY_SIGNED';
      readonly signatureId: string;
      readonly signedAt: Date;
      readonly sealSha256: string;
    }
  | {
      readonly outcome:
        | 'NOT_FOUND'
        | 'CONTRACT_SUPERSEDED'
        | 'NOT_SIGNABLE'
        | 'CONTRACT_HASH_MISMATCH'
        | 'REQUEST_INVALID';
    };

export interface TripContractStore {
  /** `version` absente : la dernière. */
  read(proof: Buffer, tripId: string, version: number | null): Promise<ContractReadResult>;
  sign(
    proof: Buffer,
    tripId: string,
    documentId: string,
    sha256: Buffer,
  ): Promise<ContractSignOutcome>;
}

export class ContractStoreError extends Error {
  override readonly name = 'ContractStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`CTR : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

/** Magasin indisponible (aucun adaptateur fourni) : toute route répond 503 (fail-closed). */
export class UnavailableTripContractStore implements TripContractStore {
  read(): Promise<ContractReadResult> {
    return Promise.reject(new ContractStoreError('contrat indisponible', undefined));
  }

  sign(): Promise<ContractSignOutcome> {
    return Promise.reject(new ContractStoreError('contrat indisponible', undefined));
  }
}

/** Sous-ensemble de `pg.Pool` utilisé ici. */
export interface ContractSqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

const sqlstateOf = (error: unknown): string | undefined =>
  typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const dateOf = (v: unknown): Date | null => {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  return d !== null && Number.isFinite(d.getTime()) ? d : null;
};
const SIGN_REFUSALS = new Set([
  'NOT_FOUND',
  'CONTRACT_SUPERSEDED',
  'NOT_SIGNABLE',
  'CONTRACT_HASH_MISMATCH',
  'REQUEST_INVALID',
]);

export class PgTripContractStore implements TripContractStore {
  constructor(private readonly db: ContractSqlExecutor) {}

  async read(proof: Buffer, tripId: string, version: number | null): Promise<ContractReadResult> {
    let row: Record<string, unknown> | undefined;
    try {
      row = (
        await this.db.query<Record<string, unknown>>(
          'SELECT * FROM core.booking_trip_contract($1, $2::uuid, $3::integer)',
          [proof, tripId, version],
        )
      ).rows[0];
    } catch (error) {
      throw new ContractStoreError('lecture du contrat', sqlstateOf(error));
    }
    const outcome = row?.['outcome'];
    if (outcome === 'NOT_FOUND' || outcome === 'NOT_GENERATED') return { outcome };
    // ligne mal formée : refus de toute la réponse (jamais un contrat partiel)
    const role = row?.['viewer_role'];
    const generatedAt = dateOf(row?.['generated_at']);
    if (
      row === undefined ||
      outcome !== 'OK' ||
      (role !== 'GUEST' && role !== 'HOST') ||
      typeof row['document_id'] !== 'string' ||
      typeof row['version'] !== 'number' ||
      typeof row['latest_version'] !== 'number' ||
      typeof row['locale'] !== 'string' ||
      generatedAt === null ||
      typeof row['sha256'] !== 'string' ||
      !HEX64.test(row['sha256']) ||
      typeof row['renderer_version'] !== 'string' ||
      typeof row['is_draft'] !== 'boolean'
    ) {
      throw new ContractStoreError('lecture du contrat : ligne illisible', undefined);
    }
    let signature: ContractSignatureRow | null = null;
    if (row['signature_id'] !== null && row['signature_id'] !== undefined) {
      const signedAt = dateOf(row['signed_at']);
      const seal = row['seal_sha256'];
      if (
        typeof row['signature_id'] !== 'string' ||
        signedAt === null ||
        typeof seal !== 'string' ||
        !HEX64.test(seal)
      ) {
        throw new ContractStoreError('lecture du contrat : signature illisible', undefined);
      }
      signature = { signatureId: row['signature_id'], signedAt, sealSha256: seal };
    }
    return {
      outcome: 'OK',
      document: {
        viewerRole: role,
        documentId: row['document_id'],
        version: row['version'],
        latestVersion: row['latest_version'],
        locale: row['locale'],
        generatedAt,
        sha256: row['sha256'],
        renderer: row['renderer_version'],
        terms: row['terms'],
        derived: row['derived'],
        body: row['body'] ?? null,
        draft: row['is_draft'],
        signature,
      },
    };
  }

  async sign(
    proof: Buffer,
    tripId: string,
    documentId: string,
    sha256: Buffer,
  ): Promise<ContractSignOutcome> {
    let row: Record<string, unknown> | undefined;
    try {
      row = (
        await this.db.query<Record<string, unknown>>(
          'SELECT * FROM core.booking_cmd_sign_contract($1, $2::uuid, $3::uuid, $4)',
          [proof, tripId, documentId, sha256],
        )
      ).rows[0];
    } catch (error) {
      throw new ContractStoreError('signature du contrat', sqlstateOf(error));
    }
    const outcome = row?.['outcome'];
    if (typeof outcome === 'string' && SIGN_REFUSALS.has(outcome)) {
      return { outcome: outcome as 'NOT_FOUND' };
    }
    const signedAt = dateOf(row?.['signed_at']);
    const id = row?.['signature_id'];
    const seal = row?.['seal_sha256'];
    if (
      (outcome !== 'SIGNED' && outcome !== 'ALREADY_SIGNED') ||
      typeof id !== 'string' ||
      !UUID.test(id) ||
      signedAt === null ||
      typeof seal !== 'string' ||
      !HEX64.test(seal)
    ) {
      throw new ContractStoreError('signature du contrat : réponse illisible', undefined);
    }
    return { outcome, signatureId: id, signedAt, sealSha256: seal };
  }
}
