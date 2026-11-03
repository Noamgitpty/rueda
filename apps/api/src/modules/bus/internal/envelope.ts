/**
 * Enveloppe d'événement de domaine (17 §4.1). Les formats sont ceux des contraintes CHECK de
 * `core.outbox_outbox_event` (migration 0010) : le contrôle ici évite un aller-retour, la base
 * reste l'arbitre.
 *
 * - `type` : `module.entité.verbe` en minuscules (ex. `booking.trip.booked`, `payment.received`) ;
 * - `aggregateVersion` : `bigint` (ex. `trip.row_version`), transporté en chaîne dans le JSON ;
 * - `payload` : identifiants et valeurs non sensibles, **aucune donnée C3 ni C4** ; les montants
 *   y sont des chaînes d'unités mineures (jamais un `number`, CLAUDE.md point 4).
 */

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

/** Acteur : `{user_id, role}` ou `SYSTEM` (17 §4.1). */
export type EventActor = 'SYSTEM' | { readonly userId: string; readonly role: string };

/** Ce qu'un producteur fournit (l'identifiant et l'heure du fait viennent de la base). */
export interface NewDomainEvent {
  readonly type: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: bigint;
  /** Pays de l'agrégat (format ISO 3166-1 alpha-2) ; la liste fait foi dans CFG. */
  readonly countryCode: string | null;
  readonly actor: EventActor;
  readonly correlationId: string;
  readonly causationId?: string | null;
  readonly payload: JsonObject;
  /** Agrégat monétaire (`trip_id` ou `hold_id`) : un consommateur à la fois par clé (F32). */
  readonly partitionKey?: string | null;
}

/** Événement publié, tel que reçu par un consommateur. */
export interface DomainEvent extends NewDomainEvent {
  readonly eventId: string;
  /** Heure de la base (UTC, ISO 8601). */
  readonly occurredAt: string;
  readonly causationId: string | null;
  readonly partitionKey: string | null;
}

/** Enveloppe JSON (noms de 17 §4.1), forme stockée dans la charge utile des tâches. */
export interface EnvelopeJson {
  readonly event_id: string;
  readonly type: string;
  readonly schema_version: number;
  readonly occurred_at: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly aggregate_version: string;
  readonly country_code: string | null;
  readonly actor: 'SYSTEM' | { readonly user_id: string; readonly role: string };
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly payload: JsonObject;
  readonly partition_key: string | null;
}

export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const AGGREGATE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const ROLE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EnvelopeError extends TypeError {
  override readonly name = 'EnvelopeError';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Contrôle une valeur JSON : pas de `bigint`, de `undefined`, de nombre non fini, ni d'objet exotique. */
function assertJson(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EnvelopeError(`${path} : nombre non fini`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      assertJson(v, `${path}[${i}]`);
    });
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) assertJson(v, `${path}.${k}`);
    return;
  }
  throw new EnvelopeError(`${path} : valeur non JSON (${typeof value})`);
}

/** Valide un événement à publier ; lève `EnvelopeError` au premier défaut. */
export function validateNewEvent(event: NewDomainEvent): void {
  if (!EVENT_TYPE_PATTERN.test(event.type) || event.type.length > 120) {
    throw new EnvelopeError(`type d'événement invalide : ${JSON.stringify(event.type)}`);
  }
  if (!Number.isInteger(event.schemaVersion) || event.schemaVersion < 1) {
    throw new EnvelopeError('schemaVersion : entier ≥ 1 attendu');
  }
  if (!AGGREGATE_TYPE_PATTERN.test(event.aggregateType)) {
    throw new EnvelopeError('aggregateType invalide');
  }
  if (!UUID_PATTERN.test(event.aggregateId)) throw new EnvelopeError('aggregateId : UUID attendu');
  if (typeof event.aggregateVersion !== 'bigint' || event.aggregateVersion < 0n) {
    throw new EnvelopeError('aggregateVersion : bigint ≥ 0 attendu');
  }
  if (event.countryCode !== null && !COUNTRY_CODE_PATTERN.test(event.countryCode)) {
    throw new EnvelopeError('countryCode : code ISO à deux lettres attendu');
  }
  if (event.actor !== 'SYSTEM') {
    if (!UUID_PATTERN.test(event.actor.userId))
      throw new EnvelopeError('actor.userId : UUID attendu');
    if (!ROLE_PATTERN.test(event.actor.role) || event.actor.role === 'SYSTEM') {
      throw new EnvelopeError('actor.role invalide');
    }
  }
  if (!UUID_PATTERN.test(event.correlationId))
    throw new EnvelopeError('correlationId : UUID attendu');
  if (event.causationId != null && !UUID_PATTERN.test(event.causationId)) {
    throw new EnvelopeError('causationId : UUID attendu');
  }
  if (!isPlainObject(event.payload)) throw new EnvelopeError('payload : objet JSON attendu');
  assertJson(event.payload, 'payload');
  if (
    event.partitionKey != null &&
    (event.partitionKey.length < 1 || event.partitionKey.length > 200)
  ) {
    throw new EnvelopeError('partitionKey : 1 à 200 caractères');
  }
}

/** Ligne de `core.outbox_outbox_event` telle que rendue par le pilote. */
export interface OutboxEventRow {
  readonly id: string;
  readonly type: string;
  readonly schema_version: number;
  readonly occurred_at: Date | string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly aggregate_version: string | number | bigint;
  readonly country_code: string | null;
  readonly actor_user_id: string | null;
  readonly actor_role: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly payload: JsonObject;
  readonly partition_key: string | null;
}

/** Ligne de l'outbox → enveloppe JSON de 17 §4.1. */
export function rowToEnvelope(row: OutboxEventRow): EnvelopeJson {
  return {
    event_id: row.id,
    type: row.type,
    schema_version: row.schema_version,
    occurred_at:
      row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    aggregate_version: BigInt(row.aggregate_version).toString(),
    country_code: row.country_code,
    actor:
      row.actor_user_id === null ? 'SYSTEM' : { user_id: row.actor_user_id, role: row.actor_role },
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    payload: row.payload,
    partition_key: row.partition_key,
  };
}

/** Enveloppe JSON → événement reçu par un consommateur. */
export function envelopeToEvent(json: EnvelopeJson): DomainEvent {
  if (
    !isPlainObject(json) ||
    typeof json.event_id !== 'string' ||
    !UUID_PATTERN.test(json.event_id)
  ) {
    throw new EnvelopeError('enveloppe illisible');
  }
  return {
    eventId: json.event_id,
    type: json.type,
    schemaVersion: json.schema_version,
    occurredAt: json.occurred_at,
    aggregateType: json.aggregate_type,
    aggregateId: json.aggregate_id,
    aggregateVersion: BigInt(json.aggregate_version),
    countryCode: json.country_code,
    actor:
      json.actor === 'SYSTEM' ? 'SYSTEM' : { userId: json.actor.user_id, role: json.actor.role },
    correlationId: json.correlation_id,
    causationId: json.causation_id,
    payload: json.payload,
    partitionKey: json.partition_key,
  };
}

/**
 * Code d'erreur court et sans donnée personnelle, seul conservé (`last_error`, alerte) :
 * SQLSTATE si l'erreur en porte un, sinon le nom de la classe. Le message n'est jamais gardé
 * (il peut contenir des valeurs : 17 §6.3, journaux expurgés).
 */
export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return `SQLSTATE_${code}`;
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(name)) return name;
  }
  return 'Error';
}
