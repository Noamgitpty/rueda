/**
 * Réception synchrone des webhooks PSP (17 §4.4 points 1 à 4 ; C19) :
 * `POST /webhooks/{provider}/{public_webhook_id}`.
 *
 * 1. Corps brut > 256 ko ⇒ 413, sans écriture.
 * 2. Fournisseur absent du registre de CE processus ⇒ 404 sans écriture. En production, le registre
 *    ne contient aucun FAKE (`production.ts`) : un webhook FAKE posté sur l'URL de production
 *    n'atteint jamais la base (C19). Compte inconnu, ou compte FAKE quand la base est en
 *    production ⇒ 404 sans écriture (`core.payment_resolve_webhook_account`).
 * 3. Signature vérifiée par l'adaptateur du PSP (temps constant), avec le secret du compte résolu
 *    depuis sa référence de coffre ; secret introuvable ⇒ 503 sans écriture.
 * 4. Persistance dans `webhook_inbox` par `core.payment_cmd_receive_webhook` : dédoublonnage
 *    (`dedup_key`), horodatage signé contrôlé à l'heure de la BASE, PAN masqués avant stockage et
 *    refusés par contrainte en base. Doublon ⇒ 200 sans traitement ; signature invalide ⇒
 *    `REJECTED_SIGNATURE`, 401, journalisé.
 *
 * Clé de dédoublonnage : `sha256("evt" ‖ provider_event_id)` pour un webhook à signature VALIDE qui
 * porte un identifiant, sinon `sha256(provider ‖ compte ‖ corps)` ; un webhook à signature
 * invalide a toujours une clé tirée de son corps et préfixée `rejected` : un faux ne peut donc
 * jamais « occuper » l'identifiant d'un événement légitime à venir.
 */
import { createHash } from 'node:crypto';
import { maskPan, maskPanDeep } from './pan.js';
import type { WebhookHeaders, WebhookVerifier } from './port.js';
import type { WebhookInboxStore } from './stores.js';

/** 17 §4.4 point 1. */
export const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

/** En-têtes jamais conservés (secrets de transport, cookies). */
const DROPPED_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization']);

export interface WebhookVerifierRegistry {
  /** Vérificateur du fournisseur (nom en capitales, ex. `TILOPAY`), ou `undefined`. */
  get(provider: string): WebhookVerifier | undefined;
}

export interface WebhookSecretResolver {
  /** Secret de signature à partir de sa référence de coffre ; `null` si introuvable. */
  resolve(ref: string): Promise<Uint8Array | null>;
}

export interface PaymentLogger {
  warn(message: string, fields: Readonly<Record<string, string | number | boolean | null>>): void;
}

export interface WebhookRequest {
  readonly provider: string;
  readonly publicWebhookId: string;
  readonly headers: WebhookHeaders;
  readonly rawBody: Uint8Array;
}

export type WebhookHttpStatus = 200 | 401 | 404 | 413 | 503;

export interface WebhookResponse {
  readonly status: WebhookHttpStatus;
  readonly outcome:
    | 'TOO_LARGE'
    | 'UNKNOWN_PROVIDER'
    | 'NOT_FOUND'
    | 'SECRET_UNAVAILABLE'
    | 'RECEIVED'
    | 'QUARANTINED'
    | 'DUPLICATE'
    | 'REJECTED_SIGNATURE';
}

const sha256 = (...parts: (string | Uint8Array)[]): Uint8Array => {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(typeof p === 'string' ? Buffer.from(p, 'utf8') : p);
    h.update(Buffer.from([0]));
  }
  return new Uint8Array(h.digest());
};

export class WebhookIngestService {
  readonly #registry: WebhookVerifierRegistry;
  readonly #store: WebhookInboxStore;
  readonly #secrets: WebhookSecretResolver;
  readonly #log: PaymentLogger;

  constructor(
    registry: WebhookVerifierRegistry,
    store: WebhookInboxStore,
    secrets: WebhookSecretResolver,
    log: PaymentLogger,
  ) {
    this.#registry = registry;
    this.#store = store;
    this.#secrets = secrets;
    this.#log = log;
  }

  async receive(request: WebhookRequest): Promise<WebhookResponse> {
    if (request.rawBody.byteLength > WEBHOOK_MAX_BODY_BYTES) {
      return { status: 413, outcome: 'TOO_LARGE' };
    }
    const provider = request.provider.toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(provider))
      return { status: 404, outcome: 'UNKNOWN_PROVIDER' };
    const verifier = this.#registry.get(provider);
    if (verifier === undefined) return { status: 404, outcome: 'UNKNOWN_PROVIDER' };
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(request.publicWebhookId)) {
      return { status: 404, outcome: 'NOT_FOUND' };
    }

    const account = await this.#store.resolveAccount(provider, request.publicWebhookId);
    if (account === null) return { status: 404, outcome: 'NOT_FOUND' };
    const secret =
      account.webhookSecretRef === null
        ? null
        : await this.#secrets.resolve(account.webhookSecretRef);
    if (secret === null) {
      this.#log.warn('webhook : secret du compte introuvable', {
        provider,
        accountId: account.accountId,
      });
      return { status: 503, outcome: 'SECRET_UNAVAILABLE' };
    }

    let verification;
    try {
      verification = verifier.verifyAndParseWebhook(request.rawBody, request.headers, secret);
    } catch {
      verification = { signatureValid: false, signedAt: null, providerEventId: null, events: [] };
    }
    const valid = verification.signatureValid;
    const rawEventId =
      valid && verification.providerEventId !== null && verification.providerEventId !== ''
        ? verification.providerEventId
        : null;
    // clé tirée de l'identifiant BRUT (deux identifiants qui se masquent pareil restent distincts) ;
    // l'identifiant stocké est masqué (un identifiant de 16 chiffres peut passer le contrôle de Luhn)
    const dedupKey = !valid
      ? sha256('rejected', provider, account.accountId, request.rawBody)
      : rawEventId !== null
        ? sha256('evt', rawEventId)
        : sha256('body', provider, account.accountId, request.rawBody);
    const providerEventId = rawEventId === null ? null : maskPan(rawEventId).text;

    const headers = maskPanDeep(this.#keptHeaders(request.headers));
    const events = valid ? maskPanDeep(verification.events) : { value: [], masked: 0 };
    if (headers.masked + events.masked > 0) {
      // F26 : PAN accidentel masqué avant stockage ; alerte (jamais le PAN lui-même)
      this.#log.warn('webhook : PAN détecté et masqué', {
        provider,
        accountId: account.accountId,
        masked: headers.masked + events.masked,
      });
    }

    const { outcome } = await this.#store.receive({
      accountId: account.accountId,
      providerEventId,
      dedupKey,
      signatureValid: valid,
      signedAt: valid ? verification.signedAt : null,
      headers: headers.value,
      events: events.value,
    });
    switch (outcome) {
      case 'NOT_FOUND':
        return { status: 404, outcome };
      case 'REJECTED_SIGNATURE':
        this.#log.warn('webhook : signature invalide (REJECTED_SIGNATURE)', {
          provider,
          accountId: account.accountId,
        });
        return { status: 401, outcome };
      case 'RECEIVED':
      case 'QUARANTINED':
      case 'DUPLICATE':
        return { status: 200, outcome };
    }
  }

  #keptHeaders(headers: WebhookHeaders): Record<string, string> {
    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      const key = name.toLowerCase();
      if (value === undefined || DROPPED_HEADERS.has(key)) continue;
      kept[key] = value.slice(0, 1024);
    }
    return kept;
  }
}
