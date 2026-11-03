/**
 * Travailleur `ntf_dispatcher` (US-021 ; 16 NTF-001 « événement → résolution des destinataires →
 * rendu → envoi → journal ») : consommateur des événements du catalogue (module BUS, ADR-050).
 *
 * Dans la transaction du reçu `inbox_receipt` (aucun appel externe ici, 17 §2.5 VERIF_17-A5) :
 *   1. `planDispatches` : règles applicables → destinataires (charge utile) → canaux du gabarit ;
 *   2. une ligne `notification_dispatch` par (événement, destinataire, canal), `ON CONFLICT DO
 *      NOTHING` sur l'unicité de 17 §3.2.12 : un événement rejoué, même hors du reçu, ne crée
 *      aucun doublon (critère 2) ;
 *   3. une tâche `ntf_sender` par envoi créé (l'envoi externe se fait après le COMMIT).
 */
import type { DomainEvent, JsonObject, SqlClient } from '../../bus/index.js';
import { scheduleJob } from '../../bus/index.js';
import { CATALOG_VERSION } from '@rueda/i18n';
import type { RecipientRole, RuleSpec, TemplateKey, TemplateSpec } from './catalog.js';
import { RULES, TEMPLATES } from './catalog.js';
import type { MessageChannelKind } from './messaging-channel.port.js';
import type { StoredVariable } from './render.js';
import { shortRef } from './render.js';

export const NTF_DISPATCHER_WORKER = 'ntf_dispatcher';
export const NTF_SENDER_WORKER = 'ntf_sender';

/** Erreur de contrat de charge utile : la tâche échoue, puis lettre morte avec alerte (17 §4.2). */
export class NotificationContractError extends Error {
  override readonly name = 'NotificationContractError';
}

export interface PlannedDispatch {
  readonly recipientUserId: string;
  readonly recipientRole: RecipientRole;
  readonly channel: MessageChannelKind;
  readonly template: TemplateKey;
  readonly variables: Readonly<Record<string, StoredVariable>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const MINOR = /^-?[0-9]{1,30}$/;
const CURRENCY = /^[A-Z]{3}$/;

function contract(event: DomainEvent, field: string): never {
  // ni valeur ni charge utile dans le message : le type et le champ suffisent
  throw new NotificationContractError(`${event.type} : champ « ${field} » absent ou invalide`);
}

/** Variables NON sensibles de la charge utile, copiées dans le journal d'envoi. */
export function payloadVariables(
  template: TemplateSpec,
  event: DomainEvent,
): Record<string, StoredVariable> {
  const out: Record<string, StoredVariable> = {};
  const payload = event.payload as Readonly<Record<string, unknown>>;
  for (const [name, source] of Object.entries(template.variables)) {
    if (source.from !== 'payload') continue;
    const value = payload[source.field];
    if (source.type === 'ref') {
      if (typeof value !== 'string' || !UUID.test(value)) contract(event, source.field);
      out[name] = shortRef(value);
    } else if (source.type === 'instant') {
      if (typeof value !== 'string' || !ISO_INSTANT.test(value)) contract(event, source.field);
      out[name] = value;
    } else {
      const currency = payload[source.currencyField];
      if (typeof value !== 'string' || !MINOR.test(value)) contract(event, source.field);
      if (typeof currency !== 'string' || !CURRENCY.test(currency)) {
        contract(event, source.currencyField);
      }
      out[name] = { amount_minor: value, currency };
    }
  }
  return out;
}

/** Envois à créer pour un événement (fonction pure, testée sans base). */
export function planDispatches(
  event: DomainEvent,
  rules: readonly RuleSpec[] = RULES,
): PlannedDispatch[] {
  const payload = event.payload as Readonly<Record<string, unknown>>;
  const out: PlannedDispatch[] = [];
  for (const rule of rules) {
    if (rule.eventType !== event.type) continue;
    if (rule.condition !== undefined) {
      const value = payload[rule.condition.field];
      // champ de statut absent : contrat violé, lettre morte et alerte (jamais d'oubli silencieux)
      if (typeof value !== 'string' || value === '') contract(event, rule.condition.field);
      if (!rule.condition.matches(value)) continue;
    }
    const template = TEMPLATES[rule.template];
    const variables = payloadVariables(template, event);
    for (const recipient of rule.recipients) {
      const userId = payload[recipient.field];
      if (typeof userId !== 'string' || !UUID.test(userId)) contract(event, recipient.field);
      for (const spec of template.channels) {
        out.push({
          recipientUserId: userId.toLowerCase(),
          recipientRole: recipient.role,
          channel: spec.channel,
          template: template.key,
          variables,
        });
      }
    }
  }
  return out;
}

const INSERT_DISPATCH = `
  INSERT INTO core.ntf_notification_dispatch
         (event_id, event_type, country_code, correlation_id, recipient_user_id, recipient_role,
          channel, template_key, template_version, variables, fallback_of)
  VALUES ($1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, $6::text, $7::text, $8::text,
          $9::integer, $10::jsonb, $11::uuid)
  ON CONFLICT ON CONSTRAINT notification_dispatch_unique DO NOTHING
  RETURNING id::text AS id`;

export interface NewDispatch {
  readonly eventId: string;
  readonly eventType: string;
  readonly countryCode: string | null;
  readonly correlationId: string;
  readonly recipientUserId: string;
  readonly recipientRole: string;
  readonly channel: MessageChannelKind;
  readonly template: TemplateKey;
  readonly variables: Readonly<Record<string, StoredVariable>>;
  readonly fallbackOf: string | null;
}

/** Tâche d'envoi (une par tentative : clé `dispatch:tentative`). */
export async function scheduleSend(
  tx: SqlClient,
  dispatchId: string,
  attempt: number,
  delaySeconds = 0,
): Promise<void> {
  const payload: JsonObject = { dispatch_id: dispatchId };
  await scheduleJob(tx, {
    name: NTF_SENDER_WORKER,
    payload,
    singletonKey: `${dispatchId}:${String(attempt)}`,
    delaySeconds,
  });
}

/** Crée l'envoi et sa tâche ; `null` si (événement, destinataire, canal) existe déjà. */
export async function createDispatch(tx: SqlClient, d: NewDispatch): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(INSERT_DISPATCH, [
    d.eventId,
    d.eventType,
    d.countryCode,
    d.correlationId,
    d.recipientUserId,
    d.recipientRole,
    d.channel,
    d.template,
    CATALOG_VERSION,
    JSON.stringify(d.variables),
    d.fallbackOf,
  ]);
  const id = rows[0]?.id;
  if (id === undefined) return null;
  await scheduleSend(tx, id, 1);
  return id;
}

/** Gestionnaire du consommateur `ntf_dispatcher` ; rend les identifiants des envois créés. */
export async function dispatchEvent(
  event: DomainEvent,
  tx: SqlClient,
  rules: readonly RuleSpec[] = RULES,
): Promise<string[]> {
  const created: string[] = [];
  for (const p of planDispatches(event, rules)) {
    const id = await createDispatch(tx, {
      eventId: event.eventId,
      eventType: event.type,
      countryCode: event.countryCode,
      correlationId: event.correlationId,
      recipientUserId: p.recipientUserId,
      recipientRole: p.recipientRole,
      channel: p.channel,
      template: p.template,
      variables: p.variables,
      fallbackOf: null,
    });
    if (id !== null) created.push(id);
  }
  return created;
}
