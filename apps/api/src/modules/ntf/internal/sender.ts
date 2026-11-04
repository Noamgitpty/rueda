/**
 * Travailleur `ntf_sender` (US-021 ; 17 §2.13 « repli automatique après échec de livraison ;
 * idempotence (event_id, destinataire, canal) ; 3 réessais ; journal d'envoi » ; ADR-058, ADR-061).
 *
 * Une tâche = une tentative d'un envoi `QUEUED` (minuterie du module BUS) :
 *   1. relit l'envoi sous verrou ; s'il n'est plus `QUEUED`, ne fait rien (tâche rejouée) ;
 *   2. relit les coordonnées par le port `RecipientDirectory` ; compte absent ⇒ `SUPPRESSED` ;
 *   3. choisit la langue du destinataire, rend le gabarit (textes de `@rueda/i18n`) ;
 *   4. appelle le port `MessagingChannel` avec la clé d'idempotence `ntf:<dispatch_id>`, la même à
 *      chaque tentative (un `TIMEOUT` rejoué ne double pas le message, ADR-058) ;
 *   5. issue :
 *      - `OK` ⇒ `SENT` (identifiant du fournisseur, empreinte du texte, langue) ;
 *      - `UNAVAILABLE` / `TIMEOUT` ⇒ nouvelle tentative différée, au plus 3 (17 §2.13) ;
 *      - refus, coordonnée absente, gabarit irrendable, 3 tentatives épuisées ⇒ échec définitif :
 *        repli sur le canal de repli du gabarit (nouvel envoi, même unicité) et événement
 *        `notification.fallback.triggered` (critère 3), sinon `FAILED` et
 *        `notification.dispatch.failed` (17 §4.5).
 *
 * L'appel externe a lieu dans la transaction de la tâche : il est idempotent par sa clé ; si le
 * COMMIT échoue après un envoi réussi, la tâche rejouée renvoie la même clé et le fournisseur
 * rend le premier résultat (`replayed`).
 *
 * Journaux : identifiants, canal, gabarit, issue et code court seulement. Jamais le texte,
 * l'adresse, le numéro ni le prénom (17 §6.3, C2).
 */
import type { JsonObject, SqlClient } from '../../bus/index.js';
import { publishEvent } from '../../bus/index.js';
import type { LocaleConfig } from '@rueda/i18n';
import type { TemplateKey } from './catalog.js';
import { TEMPLATE_KEYS, TEMPLATES } from './catalog.js';
import type { NewDispatch } from './dispatcher.js';
import { createDispatch, NotificationContractError, scheduleSend } from './dispatcher.js';
import type { CountryLocales } from './locale.js';
import { chooseLocale } from './locale.js';
import type { MessageChannelKind, MessagingChannel } from './messaging-channel.port.js';
import type { RecipientDirectory } from './recipient-directory.port.js';
import type { SmsBudget } from './sms-budget.port.js';
import type { StoredVariable } from './render.js';
import { renderedHash, renderTemplate, TemplateRenderError } from './render.js';

/**
 * 3 **tentatives** au plus par envoi (1 envoi + 2 réessais ; contrainte `attempts BETWEEN 0 AND 3`
 * de 0030). 17 §2.13 écrit « 3 réessais » : lu comme 3 tentatives, défaut fail-closed PROPOSÉ
 * (ADR-061), écart à reporter dans 17 §2.13.
 */
export const MAX_SEND_ATTEMPTS = 3;
/** Base de l'attente entre deux tentatives, en secondes (× 2^(n−1)). PROPOSÉ : 60 (ADR-061). */
export const RETRY_BASE_SECONDS = 60;

export interface CountryNotificationProfile extends CountryLocales {
  readonly timeZone: string;
}

export interface NtfLogEntry {
  readonly event: 'ntf.dispatch';
  readonly dispatch_id: string;
  readonly channel: MessageChannelKind;
  readonly template: string;
  readonly outcome: 'SENT' | 'RETRY' | 'FALLBACK_TRIGGERED' | 'FAILED' | 'SUPPRESSED';
  readonly attempts: number;
  readonly code: string | null;
}

export interface NotificationSenderDeps {
  /** Adaptateurs par canal ; canal absent = capacité inconnue = « non » (échec, puis repli). */
  readonly channels: Partial<Record<MessageChannelKind, MessagingChannel>>;
  readonly directory: RecipientDirectory;
  /** Plafond journalier SMS du pays (US-052) ; obligatoire : sans lui, aucun SMS (fail-closed). */
  readonly smsBudget: SmsBudget;
  readonly countryOf: (code: string) => CountryNotificationProfile | undefined;
  readonly exponentOf: (currency: string) => number | undefined;
  readonly localeConfig: LocaleConfig;
  /** Nom de marque (DEC-MARQUE, donnée de thème lue par la racine de composition ; US-034). */
  readonly brand: string;
  readonly log?: (entry: NtfLogEntry) => void;
  readonly retryBaseSeconds?: number;
}

interface DispatchRow {
  readonly id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly country_code: string | null;
  readonly correlation_id: string;
  readonly recipient_user_id: string;
  readonly recipient_role: string;
  readonly channel: MessageChannelKind;
  readonly template_key: string;
  readonly variables: Record<string, StoredVariable>;
  readonly attempts: number;
  readonly fallback_of: string | null;
}

const SELECT_FOR_UPDATE = `
  SELECT id::text, event_id::text, event_type, country_code, correlation_id::text,
         recipient_user_id::text, recipient_role, channel, template_key, variables, attempts,
         fallback_of::text
    FROM core.ntf_notification_dispatch
   WHERE id = $1::uuid AND status = 'QUEUED'
     FOR UPDATE`;

const UPDATE_DISPATCH = `
  UPDATE core.ntf_notification_dispatch
     SET status = $2::text, attempts = $3::smallint, locale = $4::text,
         provider_message_id = $5::text, rendered_hash = $6::bytea, last_error = $7::text
   WHERE id = $1::uuid`;

const SELECT_EXISTING = `
  SELECT id::text AS id FROM core.ntf_notification_dispatch
   WHERE event_id = $1::uuid AND recipient_user_id = $2::uuid AND channel = $3::text`;

async function existingDispatchId(tx: SqlClient, d: NewDispatch): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(SELECT_EXISTING, [
    d.eventId,
    d.recipientUserId,
    d.channel,
  ]);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('ntf_sender : envoi de repli introuvable');
  return id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isTemplateKey(key: string): key is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(key);
}

/** Code court d'une issue (colonne `last_error`, `^[A-Z][A-Z0-9_]{0,63}$`). */
function code(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 64);
}

export class NotificationSender {
  readonly #deps: NotificationSenderDeps;

  constructor(deps: NotificationSenderDeps) {
    this.#deps = deps;
  }

  /** Gestionnaire de la minuterie `ntf_sender` (une tentative d'un envoi). */
  async handle(payload: JsonObject, tx: SqlClient): Promise<void> {
    const id = payload['dispatch_id'];
    if (typeof id !== 'string' || !UUID.test(id)) {
      throw new NotificationContractError('ntf_sender : dispatch_id absent ou invalide');
    }
    const { rows } = await tx.query<DispatchRow>(SELECT_FOR_UPDATE, [id]);
    const row = rows[0];
    if (row === undefined) return; // déjà traité (tâche rejouée) ou inconnu

    const contact = await this.#deps.directory.contactOf(tx, row.recipient_user_id);
    if (contact === null) {
      await this.#update(tx, row, 'SUPPRESSED', row.attempts, null, null, 'RECIPIENT_UNAVAILABLE');
      this.#log(row, 'SUPPRESSED', row.attempts, 'RECIPIENT_UNAVAILABLE');
      return;
    }
    const to = row.channel === 'EMAIL' ? contact.email : contact.phoneE164;
    if (to === null) {
      await this.#fail(tx, row, row.attempts, null, 'NO_CONTACT');
      return;
    }
    if (!isTemplateKey(row.template_key)) {
      await this.#fail(tx, row, row.attempts, null, 'TEMPLATE_UNKNOWN');
      return;
    }
    const template = TEMPLATES[row.template_key];
    const country = row.country_code === null ? undefined : this.#deps.countryOf(row.country_code);
    const profile = chooseLocale(contact.preferredLocale, country ?? null, this.#deps.localeConfig);

    let rendered;
    try {
      rendered = renderTemplate(template, row.channel, {
        profile,
        timeZone: country?.timeZone ?? null,
        exponentOf: this.#deps.exponentOf,
        brand: this.#deps.brand,
        firstName: contact.firstName,
        variables: row.variables,
      });
    } catch (error) {
      if (!(error instanceof TemplateRenderError)) throw error;
      await this.#fail(tx, row, row.attempts, profile.tag, error.code);
      return;
    }

    const adapter = this.#deps.channels[row.channel];
    if (adapter === undefined) {
      await this.#fail(tx, row, row.attempts, profile.tag, 'CHANNEL_UNAVAILABLE');
      return;
    }
    // Plafond journalier SMS du pays (US-052) : réservé à la première tentative seulement.
    if (row.channel === 'SMS' && row.attempts === 0) {
      const refused = await this.#smsCapRefused(tx, row, template.critical);
      if (refused) {
        await this.#fail(tx, row, row.attempts, profile.tag, 'SMS_DAILY_CAP');
        return;
      }
    }
    const attempts = row.attempts + 1;
    const outcome = await adapter.send({
      idempotencyKey: `ntf:${row.id}`,
      channel: row.channel,
      to,
      locale: profile.tag,
      templateKey: row.template_key,
      subject: rendered.subject,
      body: rendered.body,
    });
    switch (outcome.status) {
      case 'OK':
        await this.#update(
          tx,
          row,
          'SENT',
          attempts,
          profile.tag,
          outcome.value.messageId,
          null,
          renderedHash(rendered),
        );
        this.#log(row, 'SENT', attempts, null);
        return;
      case 'UNAVAILABLE':
      case 'TIMEOUT':
        if (attempts < MAX_SEND_ATTEMPTS) {
          await this.#update(tx, row, 'QUEUED', attempts, profile.tag, null, outcome.status);
          const base = this.#deps.retryBaseSeconds ?? RETRY_BASE_SECONDS;
          await scheduleSend(tx, row.id, attempts + 1, base * 2 ** (attempts - 1));
          this.#log(row, 'RETRY', attempts, outcome.status);
          return;
        }
        await this.#fail(tx, row, attempts, profile.tag, `${outcome.status}_EXHAUSTED`);
        return;
      case 'REFUSED':
        await this.#fail(tx, row, attempts, profile.tag, `REFUSED_${code(outcome.reason)}`);
        return;
    }
  }

  /**
   * Réserve un SMS sur le plafond du pays ; rend `true` si l'envoi non critique est refusé (et
   * publie l'alerte au premier refus du jour). Sans pays connu, un SMS non critique est refusé
   * (plafond non vérifiable, fail-closed) ; un critique part sans être compté.
   */
  async #smsCapRefused(tx: SqlClient, row: DispatchRow, critical: boolean): Promise<boolean> {
    if (row.country_code === null) return !critical;
    const r = await this.#deps.smsBudget.reserve(tx, { country: row.country_code, critical });
    if (r.allowed) return false;
    if (r.alert) {
      await publishEvent(tx, {
        type: 'notification.sms_cap.reached',
        schemaVersion: 1,
        aggregateType: 'notification_dispatch',
        aggregateId: row.id,
        aggregateVersion: BigInt(row.attempts),
        countryCode: row.country_code,
        actor: 'SYSTEM',
        correlationId: row.correlation_id,
        causationId: row.event_id,
        payload: {
          dispatch_id: row.id,
          country_code: row.country_code,
          template: row.template_key,
        },
      });
    }
    return true;
  }

  /** Échec définitif : repli s'il existe (critère 3), sinon `FAILED`. */
  async #fail(
    tx: SqlClient,
    row: DispatchRow,
    attempts: number,
    locale: string | null,
    reason: string,
  ): Promise<void> {
    const template = isTemplateKey(row.template_key) ? TEMPLATES[row.template_key] : undefined;
    // un envoi de repli ne se replie pas à son tour
    const fallback =
      row.fallback_of === null
        ? (template?.channels.find((c) => c.channel === row.channel)?.fallback ?? null)
        : null;
    const status = fallback === null ? 'FAILED' : 'FALLBACK_TRIGGERED';
    await this.#update(tx, row, status, attempts, locale, null, code(reason));

    let fallbackId: string | null = null;
    if (fallback !== null && template !== undefined) {
      const next: NewDispatch = {
        eventId: row.event_id,
        eventType: row.event_type,
        countryCode: row.country_code,
        correlationId: row.correlation_id,
        recipientUserId: row.recipient_user_id,
        recipientRole: row.recipient_role,
        channel: fallback,
        template: template.key,
        variables: row.variables,
        fallbackOf: row.id,
      };
      // déjà présent (canal doublé) : aucun second envoi, unicité (événement, destinataire, canal) ;
      // l'événement nomme alors l'envoi existant (jamais `null` quand FALLBACK_TRIGGERED)
      fallbackId = (await createDispatch(tx, next)) ?? (await existingDispatchId(tx, next));
    }
    await publishEvent(tx, {
      type: fallback === null ? 'notification.dispatch.failed' : 'notification.fallback.triggered',
      schemaVersion: 1,
      aggregateType: 'notification_dispatch',
      aggregateId: row.id,
      aggregateVersion: BigInt(attempts),
      countryCode: row.country_code,
      actor: 'SYSTEM',
      correlationId: row.correlation_id,
      causationId: row.event_id,
      payload: {
        dispatch_id: row.id,
        channel: row.channel,
        fallback_channel: fallback,
        fallback_dispatch_id: fallbackId,
        reason: code(reason),
      },
    });
    this.#log(row, status, attempts, code(reason));
  }

  async #update(
    tx: SqlClient,
    row: DispatchRow,
    status: string,
    attempts: number,
    locale: string | null,
    providerMessageId: string | null,
    lastError: string | null,
    hash: Buffer | null = null,
  ): Promise<void> {
    await tx.query(UPDATE_DISPATCH, [
      row.id,
      status,
      attempts,
      locale,
      providerMessageId,
      hash,
      lastError,
    ]);
  }

  #log(row: DispatchRow, outcome: NtfLogEntry['outcome'], attempts: number, c: string | null) {
    const entry: NtfLogEntry = {
      event: 'ntf.dispatch',
      dispatch_id: row.id,
      channel: row.channel,
      template: row.template_key,
      outcome,
      attempts,
      code: c,
    };
    (this.#deps.log ?? defaultLog)(entry);
  }
}

/** Journal par défaut : une ligne JSON, identifiants et codes seulement (17 §6.3). */
function defaultLog(entry: NtfLogEntry): void {
  console.info(JSON.stringify(entry));
}
