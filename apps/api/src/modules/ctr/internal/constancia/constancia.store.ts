/**
 * Port et adaptateur PostgreSQL de la constancia d'arrendamiento (US-212, ADR-162 ; fonctions de la
 * migration 0137). L'adaptateur n'appelle QUE :
 *   - `core.booking_trip_constancia` (faits figés du dernier contrat, pour une partie du trip) ;
 *   - `core.booking_host_constancia_search` (trips du compte d'hôte par plaque et date, EC-48).
 * Les deux sont `SECURITY DEFINER`, `EXECUTE` au seul `app_api` ; la personne est désignée par
 * l'empreinte de son jeton de session (`proof`), jamais par un identifiant reçu : la base juge la
 * partie et rend `NOT_FOUND` à toute autre personne. Requêtes paramétrées ; une erreur de la base
 * devient `ConstanciaStoreError` (SQLSTATE seulement).
 */

export type ConstanciaReadResult =
  | { readonly outcome: 'OK'; readonly row: Readonly<Record<string, unknown>> }
  | { readonly outcome: 'NOT_FOUND' | 'NOT_AVAILABLE' | 'NOT_GENERATED' | 'ERASED' };

export interface ConstanciaSearchRow {
  readonly tripId: string;
  readonly tripRef: string;
  readonly status: string;
  readonly startLocal: string;
  readonly endLocal: string;
}

export type ConstanciaSearchResult =
  | { readonly outcome: 'DONE'; readonly trips: readonly ConstanciaSearchRow[] }
  | { readonly outcome: 'AUTH_REQUIRED' | 'REQUEST_INVALID' };

export interface TripConstanciaStore {
  read(proof: Buffer, tripId: string): Promise<ConstanciaReadResult>;
  /** `date` : date locale `AAAA-MM-JJ` du pays du trip. */
  search(proof: Buffer, plate: string, date: string): Promise<ConstanciaSearchResult>;
}

export class ConstanciaStoreError extends Error {
  override readonly name = 'ConstanciaStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`CTR : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

/** Magasin indisponible (aucun adaptateur fourni) : toute route répond 503 (fail-closed). */
export class UnavailableTripConstanciaStore implements TripConstanciaStore {
  read(): Promise<ConstanciaReadResult> {
    return Promise.reject(new ConstanciaStoreError('constancia indisponible', undefined));
  }

  search(): Promise<ConstanciaSearchResult> {
    return Promise.reject(new ConstanciaStoreError('constancia indisponible', undefined));
  }
}

/** Sous-ensemble de `pg.Pool` utilisé ici. */
export interface ConstanciaSqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

const sqlstateOf = (error: unknown): string | undefined =>
  typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const REFUSALS = new Set(['NOT_FOUND', 'NOT_AVAILABLE', 'NOT_GENERATED', 'ERASED']);

export class PgTripConstanciaStore implements TripConstanciaStore {
  constructor(private readonly db: ConstanciaSqlExecutor) {}

  async read(proof: Buffer, tripId: string): Promise<ConstanciaReadResult> {
    let rows: Record<string, unknown>[];
    try {
      rows = (
        await this.db.query<Record<string, unknown>>(
          'SELECT * FROM core.booking_trip_constancia($1, $2::uuid)',
          [proof, tripId],
        )
      ).rows;
    } catch (error) {
      throw new ConstanciaStoreError('lecture de la constancia', sqlstateOf(error));
    }
    const outcome = rows[0]?.['outcome'];
    if (rows.length !== 1) {
      throw new ConstanciaStoreError('lecture de la constancia : réponse illisible', undefined);
    }
    if (typeof outcome === 'string' && REFUSALS.has(outcome)) {
      return { outcome: outcome as 'NOT_FOUND' };
    }
    if (outcome !== 'OK') {
      throw new ConstanciaStoreError('lecture de la constancia : issue inconnue', undefined);
    }
    // la forme des faits est contrôlée par le service (parseConstanciaFacts), jamais devinée
    return { outcome: 'OK', row: rows[0]! };
  }

  async search(proof: Buffer, plate: string, date: string): Promise<ConstanciaSearchResult> {
    let rows: Record<string, unknown>[];
    try {
      rows = (
        await this.db.query<Record<string, unknown>>(
          'SELECT * FROM core.booking_host_constancia_search($1, $2, $3::date)',
          [proof, plate, date],
        )
      ).rows;
    } catch (error) {
      throw new ConstanciaStoreError('recherche de constancia', sqlstateOf(error));
    }
    const first = rows[0]?.['outcome'];
    if (rows.length === 1 && (first === 'AUTH_REQUIRED' || first === 'REQUEST_INVALID')) {
      return { outcome: first };
    }
    const trips: ConstanciaSearchRow[] = [];
    for (const r of rows) {
      const id = r['trip_id'];
      const ref = r['public_ref'];
      const status = r['status'];
      const start = r['start_local'];
      const end = r['end_local'];
      if (
        r['outcome'] !== 'DONE' ||
        typeof id !== 'string' ||
        !UUID.test(id) ||
        typeof ref !== 'string' ||
        ref.length === 0 ||
        typeof status !== 'string' ||
        typeof start !== 'string' ||
        !LOCAL.test(start) ||
        typeof end !== 'string' ||
        !LOCAL.test(end)
      ) {
        // ligne mal formée : refus de toute la réponse (jamais une liste partielle)
        throw new ConstanciaStoreError('recherche de constancia : ligne illisible', undefined);
      }
      trips.push({ tripId: id, tripRef: ref, status, startLocal: start, endLocal: end });
    }
    return { outcome: 'DONE', trips };
  }
}
