/**
 * Publication d'un événement (17 §4.2, « Écriture ») : insertion dans `core.outbox_outbox_event`
 * **dans la transaction du changement d'état**, sur la même connexion. Une transaction annulée
 * n'émet donc rien. Aucun appel externe ici.
 *
 * L'identifiant (UUID v7) et l'heure du fait viennent de la base (`platform.uuid_v7()`,
 * `platform.now()`) : l'horloge qui fait foi est celle de la base (17 §1.3). Le producteur n'a
 * aucun droit de lecture sur l'outbox (0012) : l'identifiant est donc demandé avant l'insertion.
 */
import type { NewDomainEvent } from './envelope.js';
import { validateNewEvent } from './envelope.js';
import type { SqlClient } from './sql.js';

const INSERT_EVENT = `
  INSERT INTO core.outbox_outbox_event
         (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  VALUES ($1::uuid, $2::text, $3::integer, $4::text, $5::uuid, $6::bigint, $7::text,
          $8::uuid, $9::text, $10::uuid, $11::uuid, $12::jsonb, $13::text)`;

/**
 * Écrit l'événement dans la transaction ouverte sur `tx` ; renvoie son `event_id`.
 * Lève `EnvelopeError` avant tout SQL si l'enveloppe est invalide.
 */
export async function publishEvent(tx: SqlClient, event: NewDomainEvent): Promise<string> {
  validateNewEvent(event);
  const { rows } = await tx.query<{ id: string }>('SELECT platform.uuid_v7()::text AS id');
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('platform.uuid_v7() sans résultat');
  await tx.query(INSERT_EVENT, [
    id,
    event.type,
    event.schemaVersion,
    event.aggregateType,
    event.aggregateId,
    event.aggregateVersion.toString(),
    event.countryCode,
    event.actor === 'SYSTEM' ? null : event.actor.userId,
    event.actor === 'SYSTEM' ? 'SYSTEM' : event.actor.role,
    event.correlationId,
    event.causationId ?? null,
    JSON.stringify(event.payload),
    event.partitionKey ?? null,
  ]);
  return id;
}
