/**
 * Magasin des demandes de réservation de l'hôte (US-223 partie 223c, ADR-146 ; 17 §2.5 « Hold de
 * demande REQUEST » ; migration 0126) sous app_api : lecture `core.booking_host_requests`
 * (host_view_owner), acceptation `core.booking_cmd_accept_booking_request`, affinage de la capture
 * `core.booking_cmd_request_record_capture` et refus `core.booking_cmd_decline_booking_request`
 * (SECURITY DEFINER de cmd_hold_owner). L'hôte est désigné par l'empreinte de son jeton de session,
 * le compte par `{orgId}` revérifié en base (compte TITULAIRE de la session) ; paramètres liés,
 * aucun SQL construit. Montant et jambes de la capture viennent du devis ENGAGÉ au checkout,
 * rejoués par la base, jamais du client ni de l'API. Toute issue inconnue ⇒ panne (503).
 */
import { LEGS } from '../../../pay/index.js';
import type { Leg } from '../../../pay/index.js';
import type { SqlExecutor } from './store.js';

/** Une demande du compte (A05, 16 HDB-002) : heure limite, période, gains, voyageur réduit. */
export interface HostRequestRow {
  readonly holdId: string;
  /** `AWAITING_HOST` : à accepter ou refuser ; `CAPTURING` : acceptée, paiement en cours. */
  readonly status: 'AWAITING_HOST' | 'CAPTURING';
  readonly vehicleId: string;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
  readonly timezone: string;
  readonly respondBy: string;
  readonly currency: string;
  /** Total du devis engagé (unités mineures, texte : bigint). */
  readonly totalMinor: string;
  /** Jambe HOST du devis engagé : gains estimés (08 E7). */
  readonly hostLegMinor: string | null;
  readonly guest: {
    readonly firstName: string | null;
    readonly ageYears: number | null;
    readonly rating: number | null;
    readonly verified: boolean;
  };
}

/** Capture à envoyer au PSP (acceptation) : clé, montant et jambes stockés par la base. */
export interface RequestCapture {
  readonly outcome: 'CAPTURE_ORDER' | 'RETRY_SAME_KEY';
  readonly operationId: string;
  readonly idemSent: string;
  readonly provider: string;
  readonly method: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly legs: Readonly<Record<Leg, bigint>>;
  /** Référence PSP de l'autorisation capturée. */
  readonly authorizationReference: string;
  /**
   * Reprise (`RETRY_SAME_KEY`) : `true` si le PSP permet de chercher l'ordre par NOTRE clé (lecture
   * d'abord, N-108) ; `false` : reprise sous la même clé garantie par l'en-tête d'idempotence.
   */
  readonly lookup: boolean;
}

/** Refus de l'acceptation ou du refus (issues de 0126), codes de `host-request-errors.ts`. */
export const REQUEST_REFUSALS = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'REQUEST_EXPIRED',
  'INVALID_TRANSITION',
  'TERMS_REACCEPT_REQUIRED',
  'GUEST_NOT_ELIGIBLE',
  'START_PASSED',
  'LEG_SUM_MISMATCH',
  'PARAM_MISSING',
] as const;
export type RequestRefusal = (typeof REQUEST_REFUSALS)[number];

export type AcceptResult =
  | { readonly kind: 'CAPTURE'; readonly capture: RequestCapture }
  /** Capture déjà en cours (`CAPTURING`) ou trip né (`ACCEPTED`) : aucun nouvel envoi. */
  | { readonly kind: 'DONE'; readonly outcome: 'CAPTURING' | 'ACCEPTED' }
  | { readonly kind: 'REFUSED'; readonly code: RequestRefusal };

export type DeclineResult =
  { readonly kind: 'DECLINED' } | { readonly kind: 'REFUSED'; readonly code: RequestRefusal };

export interface HostRequestStore {
  /** Demandes du compte ; `FORBIDDEN` : compte d'un autre ou inconnu. */
  list(
    proof: Buffer,
    orgId: string,
    holdId: string | null,
  ): Promise<readonly HostRequestRow[] | 'FORBIDDEN'>;
  accept(proof: Buffer, orgId: string, holdId: string): Promise<AcceptResult>;
  recordCapture(
    proof: Buffer,
    orgId: string,
    holdId: string,
    operationId: string,
    providerReference: string,
  ): Promise<'RECORDED' | RequestRefusal>;
  decline(proof: Buffer, orgId: string, holdId: string): Promise<DeclineResult>;
}

export class HostRequestStoreError extends Error {
  override readonly name = 'HostRequestStoreError';
}

/** Aucun adaptateur : refus (503). */
export class UnavailableHostRequestStore implements HostRequestStore {
  #fail = (): Promise<never> =>
    Promise.reject(new HostRequestStoreError('magasin des demandes indisponible'));
  list = (): Promise<never> => this.#fail();
  accept = (): Promise<never> => this.#fail();
  recordCapture = (): Promise<never> => this.#fail();
  decline = (): Promise<never> => this.#fail();
}

/** Lecture bornée (17 §2.3 : aucune liste non bornée) ; PROPOSÉ, ADR-146. */
export const HOST_REQUESTS_LIMIT = 100;

const REFUSAL_SET: ReadonlySet<string> = new Set(REQUEST_REFUSALS);
const MINOR = /^(0|[1-9][0-9]{0,17})$/;

const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new HostRequestStoreError('colonne inattendue');
  return value;
};
const textOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : text(value);
const iso = (value: unknown): string => {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new HostRequestStoreError('instant illisible');
  return d.toISOString();
};
const minorText = (value: unknown): string => {
  const s = typeof value === 'number' || typeof value === 'bigint' ? String(value) : text(value);
  if (!MINOR.test(s)) throw new HostRequestStoreError('montant illisible');
  return s;
};
const intOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new HostRequestStoreError('entier illisible');
  return n;
};
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HostRequestStoreError('note illisible');
  return n;
};

function legsOf(value: unknown): Readonly<Record<Leg, bigint>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HostRequestStoreError('jambes illisibles');
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== [...LEGS].sort().join(',')) {
    throw new HostRequestStoreError('jambes illisibles');
  }
  const out = {} as Record<Leg, bigint>;
  for (const leg of LEGS) out[leg] = BigInt(minorText(raw[leg]));
  return out;
}

function jsonOf(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  const r = rows[0]?.['r'];
  if (typeof r !== 'object' || r === null || Array.isArray(r)) {
    throw new HostRequestStoreError('réponse illisible');
  }
  return r as Record<string, unknown>;
}

/** Commandes et lecture de 0126, sous app_api. */
export class PgHostRequestStore implements HostRequestStore {
  constructor(private readonly db: SqlExecutor) {}

  async list(
    proof: Buffer,
    orgId: string,
    holdId: string | null,
  ): Promise<readonly HostRequestRow[] | 'FORBIDDEN'> {
    const { rows } = await this.db.query(
      'SELECT * FROM core.booking_host_requests($1, $2::uuid, $3::uuid, $4)',
      [proof, orgId, holdId, HOST_REQUESTS_LIMIT],
    );
    if (rows.length === 1 && String(rows[0]?.['outcome']) === 'FORBIDDEN') return 'FORBIDDEN';
    return rows.map((r) => {
      if (String(r['outcome']) !== 'DONE') {
        throw new HostRequestStoreError(`issue inattendue : ${String(r['outcome'])}`);
      }
      const status = text(r['status']);
      if (status !== 'AWAITING_HOST' && status !== 'CAPTURING') {
        throw new HostRequestStoreError('état de demande inattendu');
      }
      return {
        holdId: text(r['hold_id']),
        status,
        vehicleId: text(r['vehicle_id']),
        scheduledStart: iso(r['scheduled_start']),
        scheduledEnd: iso(r['scheduled_end']),
        timezone: text(r['timezone']),
        respondBy: iso(r['request_respond_by']),
        currency: text(r['currency']),
        totalMinor: minorText(r['total_minor']),
        hostLegMinor:
          r['host_leg_minor'] === null ? null : minorText(r['host_leg_minor'] as unknown),
        guest: {
          firstName: textOrNull(r['guest_first_name']),
          ageYears: intOrNull(r['guest_age_years']),
          rating: numOrNull(r['guest_rating']),
          verified: r['guest_verified'] === true,
        },
      };
    });
  }

  async accept(proof: Buffer, orgId: string, holdId: string): Promise<AcceptResult> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT core.booking_cmd_accept_booking_request($1, $2::uuid, $3::uuid) AS r',
      [proof, orgId, holdId],
    );
    const r = jsonOf(rows);
    const outcome = String(r['outcome']);
    if (REFUSAL_SET.has(outcome)) return { kind: 'REFUSED', code: outcome as RequestRefusal };
    if (outcome === 'CAPTURING' || outcome === 'ACCEPTED') return { kind: 'DONE', outcome };
    if (outcome !== 'CAPTURE_ORDER' && outcome !== 'RETRY_SAME_KEY') {
      throw new HostRequestStoreError(`issue inattendue de l'acceptation : ${outcome}`);
    }
    return {
      kind: 'CAPTURE',
      capture: {
        outcome,
        operationId: text(r['operationId']),
        idemSent: text(r['idemSent']),
        provider: text(r['provider']),
        method: text(r['method']),
        amountMinor: BigInt(minorText(r['amountMinor'])),
        currency: text(r['currency']),
        legs: legsOf(r['legs']),
        authorizationReference: text(r['authorizationReference']),
        lookup: r['lookup'] === true,
      },
    };
  }

  async recordCapture(
    proof: Buffer,
    orgId: string,
    holdId: string,
    operationId: string,
    providerReference: string,
  ): Promise<'RECORDED' | RequestRefusal> {
    const { rows } = await this.db.query<{ r: unknown }>(
      'SELECT core.booking_cmd_request_record_capture($1, $2::uuid, $3::uuid, $4::uuid, $5) AS r',
      [proof, orgId, holdId, operationId, providerReference],
    );
    const outcome = String(rows[0]?.r ?? '');
    if (outcome === 'RECORDED') return outcome;
    if (REFUSAL_SET.has(outcome)) return outcome as RequestRefusal;
    throw new HostRequestStoreError(`issue inattendue de l'affinage : ${outcome}`);
  }

  async decline(proof: Buffer, orgId: string, holdId: string): Promise<DeclineResult> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT core.booking_cmd_decline_booking_request($1, $2::uuid, $3::uuid) AS r',
      [proof, orgId, holdId],
    );
    const outcome = String(jsonOf(rows)['outcome']);
    if (outcome === 'DECLINED') return { kind: 'DECLINED' };
    if (REFUSAL_SET.has(outcome)) return { kind: 'REFUSED', code: outcome as RequestRefusal };
    throw new HostRequestStoreError(`issue inattendue du refus : ${outcome}`);
  }
}
