/**
 * Port et adaptateur PostgreSQL des frais annexes (US-706, migration 0177, ADR-197). L'adaptateur
 * n'appelle QUE `core.claim_incidental_view` et les commandes `core.claim_cmd_*_incidental`
 * (SECURITY DEFINER, propriétaire cmd_money_owner, EXECUTE au seul app_api) : app_api n'a aucun
 * droit sur la table. La personne est désignée par l'empreinte de son jeton de session (`proof`),
 * jamais par un identifiant reçu ; sa partie (hôte titulaire ou voyageur) est jugée par la base.
 * Requêtes paramétrées ; une erreur de la base devient `IncidentalStoreError` (SQLSTATE seulement).
 * Aucune heure n'est envoyée à la base : elle prend `platform.now()`.
 */
import type { SqlExecutor } from '../inspection/ports.js';

export type IncidentalRole = 'HOST' | 'GUEST';
export const INCIDENTAL_FEE_TYPES = ['FUEL', 'CLEANING', 'SMOKING'] as const;
export type IncidentalFeeType = (typeof INCIDENTAL_FEE_TYPES)[number];
export const INCIDENTAL_STATUSES = [
  'AWAITING_GUEST',
  'ACCEPTED',
  'DISPUTED',
  'DECIDED_CHARGE',
  'CHARGED',
  'REJECTED',
  'CANCELLED_BY_HOST',
] as const;
export type IncidentalStatus = (typeof INCIDENTAL_STATUSES)[number];
export type IncidentalChargeStatus = 'PROCESSING' | 'PAID' | 'UNPAID';

export interface IncidentalInvoiceRow {
  readonly id: string;
  readonly feeType: IncidentalFeeType;
  readonly amountMinor: string;
  readonly status: IncidentalStatus;
  readonly notifiedAt: Date;
  readonly responseDueAt: Date;
  readonly windowOpen: boolean;
  readonly description: string;
  readonly evidenceCount: number;
  /** Photos du trip retenues comme pièces (côté, emplacement, auteur, heure serveur). */
  readonly evidence: readonly IncidentalEvidenceRow[];
  readonly disputeReason: string | null;
  readonly decision: 'CHARGE' | 'REJECTED' | null;
  readonly decisionRationale: string | null;
  readonly chargeStatus: IncidentalChargeStatus | null;
}

export interface IncidentalEvidenceRow {
  readonly kind: 'CHECKIN' | 'CHECKOUT';
  readonly slotCode: string;
  readonly slotGroup: string;
  readonly takenBy: IncidentalRole;
  readonly receivedAt: Date;
}

/** Plafonds du pays par type (unités mineures) ; `null` : non fixé (aucune demande). */
export type IncidentalCaps = Readonly<Record<IncidentalFeeType, string | null>>;

export interface IncidentalPhotoRow {
  readonly fileId: string;
  readonly kind: 'CHECKIN' | 'CHECKOUT';
  readonly slotCode: string;
  readonly slotGroup: string;
  readonly takenBy: IncidentalRole;
}

export interface IncidentalViewRow {
  readonly viewerRole: IncidentalRole;
  readonly currency: string;
  /** Décimales de la devise (`core.config_currency`, lue par app_api) : 2 en USD, 0 en PYG. */
  readonly currencyExponent: number;
  readonly timezone: string;
  readonly endedAt: Date | null;
  readonly hostDeadlineAt: Date | null;
  readonly canSubmit: boolean;
  /** Hôte seulement ; `null` pour le voyageur. */
  readonly caps: IncidentalCaps | null;
  readonly feeTypes: readonly IncidentalFeeType[];
  readonly invoices: readonly IncidentalInvoiceRow[];
  readonly photos: readonly IncidentalPhotoRow[];
}

export interface IncidentalSubmitInput {
  readonly requestId: string;
  readonly feeType: string;
  readonly amountMinor: string;
  readonly description: string;
  readonly evidenceFileIds: readonly string[];
}

export interface IncidentalSubmitResult {
  readonly outcome: string;
  readonly invoiceId: string | null;
  readonly responseDueAt: Date | null;
}

export interface IncidentalStore {
  /** `null` : trip inconnu ou d'une autre personne (NOT_FOUND). */
  view(proof: Buffer, tripId: string): Promise<IncidentalViewRow | null>;
  submit(
    proof: Buffer,
    tripId: string,
    input: IncidentalSubmitInput,
  ): Promise<IncidentalSubmitResult>;
  cancel(proof: Buffer, invoiceId: string): Promise<string>;
  accept(proof: Buffer, invoiceId: string): Promise<string>;
  dispute(
    proof: Buffer,
    invoiceId: string,
    reason: string,
    evidenceFileIds: readonly string[],
  ): Promise<string>;
}

export class IncidentalStoreError extends Error {
  override readonly name = 'IncidentalStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`TRP : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

/** Magasin indisponible (aucun adaptateur fourni) : toute route répond 503 (fail-closed). */
export class UnavailableIncidentalStore implements IncidentalStore {
  #fail(): Promise<never> {
    return Promise.reject(
      new IncidentalStoreError('frais annexes : magasin indisponible', undefined),
    );
  }
  view = (): Promise<IncidentalViewRow | null> => this.#fail();
  submit = (): Promise<IncidentalSubmitResult> => this.#fail();
  cancel = (): Promise<string> => this.#fail();
  accept = (): Promise<string> => this.#fail();
  dispute = (): Promise<string> => this.#fail();
}

const sqlstateOf = (error: unknown): string | undefined =>
  typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
const dateOf = (v: unknown): Date | null => {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  return d !== null && Number.isFinite(d.getTime()) ? d : null;
};
const isObj = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^[1-9][0-9]{0,17}$/;
const SLOT = /^(EXT_[0-9]{2}|INT_[0-9]{2}|FUEL|ODOMETER|KEY|DAMAGE_[0-9]{2})$/;
const ROLES: readonly unknown[] = ['HOST', 'GUEST'];
const FEES: readonly unknown[] = INCIDENTAL_FEE_TYPES;
const STATUSES: readonly unknown[] = INCIDENTAL_STATUSES;
const CHARGE_STATUSES: readonly unknown[] = ['PROCESSING', 'PAID', 'UNPAID'];

const CAP = /^(0|[1-9][0-9]{0,17})$/;

/** Plafonds rendus à l'hôte ; absent pour le voyageur ; forme inattendue ⇒ erreur. */
function capsOf(v: unknown): IncidentalCaps | null {
  // aide du montant seulement (la commande applique le plafond) : un plafond illisible n'est pas
  // affiché, jamais toute la vue en échec (revue delta, mineur)
  if (!isObj(v)) return null;
  const out: Record<string, string | null> = {};
  for (const fee of INCIDENTAL_FEE_TYPES) {
    const c = v[fee];
    out[fee] = typeof c === 'string' && CAP.test(c) ? c : null;
  }
  return out as IncidentalCaps;
}

/** Vue jsonb de `core.claim_incidental_view` ; forme inattendue ⇒ erreur (jamais une vue partielle). */
export function parseIncidentalView(v: unknown, exponent?: unknown): IncidentalViewRow | null {
  const bad = (): never => {
    throw new IncidentalStoreError('lecture des frais annexes : vue illisible', undefined);
  };
  if (!isObj(v)) return bad();
  if (v['outcome'] === 'NOT_FOUND') return null;
  if (v['outcome'] !== 'OK' || !ROLES.includes(v['viewerRole'])) return bad();
  const currency = v['currency'];
  const timezone = v['timezone'];
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return bad();
  if (typeof timezone !== 'string' || timezone.length === 0) return bad();
  if (typeof v['canSubmit'] !== 'boolean') return bad();
  if (typeof exponent !== 'number' || !Number.isInteger(exponent) || exponent < 0 || exponent > 4) {
    return bad();
  }
  const time = (x: unknown): Date | null => {
    if (x === null || x === undefined) return null;
    return dateOf(x) ?? bad();
  };
  const textOrNull = (x: unknown): string | null => {
    if (x === null || x === undefined) return null;
    return typeof x === 'string' ? x : bad();
  };
  const feeTypes = v['feeTypes'];
  if (!Array.isArray(feeTypes) || !feeTypes.every((f) => FEES.includes(f))) return bad();
  const rawInvoices = v['invoices'];
  const rawPhotos = v['photos'];
  if (!Array.isArray(rawInvoices) || !Array.isArray(rawPhotos)) return bad();
  const invoices = rawInvoices.map((i): IncidentalInvoiceRow => {
    if (!isObj(i)) return bad();
    const id = i['id'];
    const amount = i['amountMinor'];
    const description = i['description'];
    const count = i['evidenceCount'];
    const rawEvidence = i['evidence'];
    if (!Array.isArray(rawEvidence)) return bad();
    const evidence = rawEvidence.map((e): IncidentalEvidenceRow => {
      if (
        !isObj(e) ||
        (e['kind'] !== 'CHECKIN' && e['kind'] !== 'CHECKOUT') ||
        typeof e['slotCode'] !== 'string' ||
        !SLOT.test(e['slotCode']) ||
        typeof e['slotGroup'] !== 'string' ||
        !/^[A-Z]{2,16}$/.test(e['slotGroup']) ||
        !ROLES.includes(e['takenBy'])
      ) {
        return bad();
      }
      const at = time(e['receivedAt']);
      if (at === null) return bad();
      return {
        kind: e['kind'],
        slotCode: e['slotCode'],
        slotGroup: e['slotGroup'],
        takenBy: e['takenBy'] as IncidentalRole,
        receivedAt: at,
      };
    });
    const decision = i['decision'];
    const charge = i['chargeStatus'];
    if (
      typeof id !== 'string' ||
      !ID.test(id) ||
      !FEES.includes(i['feeType']) ||
      typeof amount !== 'string' ||
      !MINOR.test(amount) ||
      !STATUSES.includes(i['status']) ||
      typeof i['windowOpen'] !== 'boolean' ||
      typeof description !== 'string' ||
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      (decision !== null &&
        decision !== undefined &&
        decision !== 'CHARGE' &&
        decision !== 'REJECTED') ||
      (charge !== null && charge !== undefined && !CHARGE_STATUSES.includes(charge))
    ) {
      return bad();
    }
    const notifiedAt = time(i['notifiedAt']);
    const responseDueAt = time(i['responseDueAt']);
    if (notifiedAt === null || responseDueAt === null) return bad();
    return {
      id,
      feeType: i['feeType'] as IncidentalFeeType,
      amountMinor: amount,
      status: i['status'] as IncidentalStatus,
      notifiedAt,
      responseDueAt,
      windowOpen: i['windowOpen'] as boolean,
      description,
      evidenceCount: count,
      evidence,
      disputeReason: textOrNull(i['disputeReason']),
      decision: (decision ?? null) as IncidentalInvoiceRow['decision'],
      decisionRationale: textOrNull(i['decisionRationale']),
      chargeStatus: (charge ?? null) as IncidentalChargeStatus | null,
    };
  });
  const photos = rawPhotos.map((p): IncidentalPhotoRow => {
    if (!isObj(p)) return bad();
    const fileId = p['fileId'];
    const slotCode = p['slotCode'];
    const slotGroup = p['slotGroup'];
    if (
      typeof fileId !== 'string' ||
      !ID.test(fileId) ||
      (p['kind'] !== 'CHECKIN' && p['kind'] !== 'CHECKOUT') ||
      typeof slotCode !== 'string' ||
      !SLOT.test(slotCode) ||
      typeof slotGroup !== 'string' ||
      !/^[A-Z]{2,16}$/.test(slotGroup) ||
      !ROLES.includes(p['takenBy'])
    ) {
      return bad();
    }
    return {
      fileId,
      kind: p['kind'],
      slotCode,
      slotGroup,
      takenBy: p['takenBy'] as IncidentalRole,
    };
  });
  return {
    viewerRole: v['viewerRole'] as IncidentalRole,
    currency,
    currencyExponent: exponent,
    timezone,
    endedAt: time(v['endedAt']),
    hostDeadlineAt: time(v['hostDeadlineAt']),
    canSubmit: v['canSubmit'],
    caps: capsOf(v['caps']),
    feeTypes: feeTypes as IncidentalFeeType[],
    invoices,
    photos,
  };
}

export class PgIncidentalStore implements IncidentalStore {
  constructor(private readonly db: SqlExecutor) {}

  async #one<R extends Record<string, unknown>>(
    operation: string,
    sql: string,
    values: readonly unknown[],
  ): Promise<R | undefined> {
    try {
      return (await this.db.query<R>(sql, values)).rows[0];
    } catch (error) {
      throw new IncidentalStoreError(operation, sqlstateOf(error));
    }
  }

  async view(proof: Buffer, tripId: string): Promise<IncidentalViewRow | null> {
    // décimales de la devise : référentiel lu par app_api (politique app_read de config_currency)
    const r = await this.#one<{ v: unknown; e: unknown }>(
      'lecture des frais annexes',
      `SELECT x.v, (SELECT c.exponent::integer FROM core.config_currency AS c
                     WHERE c.code = x.v ->> 'currency') AS e
         FROM (SELECT core.claim_incidental_view($1, $2::uuid) AS v) AS x`,
      [proof, tripId],
    );
    if (r === undefined) return parseIncidentalView(undefined);
    return parseIncidentalView(r.v, r.e ?? undefined);
  }

  async submit(
    proof: Buffer,
    tripId: string,
    input: IncidentalSubmitInput,
  ): Promise<IncidentalSubmitResult> {
    const r = await this.#one<{ outcome: string; invoice_id: string | null; due: unknown }>(
      'demande de frais annexe',
      `SELECT outcome, invoice_id::text AS invoice_id, response_due_at AS due
         FROM core.claim_cmd_submit_incidental($1, $2::uuid, $3::uuid, $4, $5::bigint, $6,
                                               $7::uuid[])`,
      [
        proof,
        tripId,
        input.requestId,
        input.feeType,
        input.amountMinor,
        input.description,
        input.evidenceFileIds,
      ],
    );
    return {
      outcome: r?.outcome ?? 'UNAVAILABLE',
      invoiceId: r?.invoice_id ?? null,
      responseDueAt: dateOf(r?.due),
    };
  }

  async #command(operation: string, sql: string, values: readonly unknown[]): Promise<string> {
    const r = await this.#one<{ r: string | null }>(operation, sql, values);
    return r?.r ?? 'UNAVAILABLE';
  }

  cancel(proof: Buffer, invoiceId: string): Promise<string> {
    return this.#command(
      'annulation du frais annexe',
      'SELECT core.claim_cmd_cancel_incidental($1, $2::uuid) AS r',
      [proof, invoiceId],
    );
  }

  accept(proof: Buffer, invoiceId: string): Promise<string> {
    return this.#command(
      'paiement du frais annexe',
      'SELECT core.claim_cmd_accept_incidental($1, $2::uuid) AS r',
      [proof, invoiceId],
    );
  }

  dispute(
    proof: Buffer,
    invoiceId: string,
    reason: string,
    evidenceFileIds: readonly string[],
  ): Promise<string> {
    return this.#command(
      'contestation du frais annexe',
      'SELECT core.claim_cmd_dispute_incidental($1, $2::uuid, $3, $4::uuid[]) AS r',
      [proof, invoiceId, reason, evidenceFileIds],
    );
  }
}
