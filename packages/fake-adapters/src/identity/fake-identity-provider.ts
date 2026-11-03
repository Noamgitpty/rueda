/**
 * FAKE du port `IdentityProvider` (module KYC ; 17 §5 « KYC », §10 ; US-020). Simule un parcours
 * **hébergé** : l'application n'envoie ni pièce ni selfie, seulement une référence opaque du sujet
 * et le type de pièce ; la décision revient par un rappel signé (et par `getStatus`).
 *
 * Les pièces acceptées sont une **donnée** fournie à la construction (pays, type de pièce) : aucune
 * constante pays ici. Pièce non configurée ⇒ `UNSUPPORTED_DOCUMENT` (capacité inconnue = « non »).
 *
 * Cas difficiles : scénario `start` / `status` (panne, délai, issue inconnue, refus) et scénario
 * `webhook` appliqué à chaque décision : `UNAVAILABLE` ou `TIMEOUT_*` ⇒ rappel perdu (la décision
 * reste lisible par `getStatus`), `DUPLICATE` ⇒ rappel livré deux fois, `DELAY` ⇒ rappel livré
 * en retard ; l'ordre des livraisons peut être inversé par le test (`takeDeliveries`).
 */
import { assertFakeAllowed } from '../guard.ts';
import type { EnvironmentVariables } from '../guard.ts';
import type { FakeClock } from '../core/clock.ts';
import type { Outcome, WebhookVerdict } from '../core/outcome.ts';
import { FakeRuntime, Sequence } from '../core/runtime.ts';
import { checkFakeWebhook, signFakeWebhook } from '../core/webhook.ts';

export interface IdentityDocumentRef {
  /** Code pays tiré de la configuration pays (CFG), jamais d'une constante. */
  readonly country: string;
  /** Type de pièce tiré de la configuration (ex. pièce nationale, pièce d'étranger, passeport). */
  readonly kind: string;
}

export interface StartVerificationRequest {
  readonly idempotencyKey: string;
  /** Référence opaque du sujet (jamais un nom, une pièce ni un email). */
  readonly subjectRef: string;
  readonly document: IdentityDocumentRef;
  readonly locale: string;
  readonly returnUrl: string;
}

export interface VerificationSession {
  readonly sessionId: string;
  readonly hostedUrl: string;
  readonly expiresAt: Date;
}

export type IdentityDecision = 'APPROVED' | 'DECLINED' | 'REVIEW';

export interface VerificationStatus {
  readonly sessionId: string;
  readonly state: 'PENDING' | 'EXPIRED' | IdentityDecision;
  readonly reasons: readonly string[];
}

export interface IdentityDecisionEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly subjectRef: string;
  readonly decision: IdentityDecision;
  readonly reasons: readonly string[];
  readonly decidedAt: Date;
}

export interface WebhookDelivery {
  readonly body: string;
  readonly signature: string;
}

export interface FakeIdentityProviderOptions {
  readonly clock: FakeClock;
  /** Pièces acceptées (données CFG du test) ; toute autre pièce est refusée. */
  readonly documents: readonly IdentityDocumentRef[];
  /** Secret des rappels, fourni par le test (16 caractères au moins). */
  readonly webhookSecret: string;
  /** Durée de vie d'une session hébergée. */
  readonly sessionTtlMs: number;
  /** Fenêtre de fraîcheur des rappels (secondes). */
  readonly webhookToleranceSeconds: number;
  readonly env?: EnvironmentVariables;
}

type IdentityOp = 'start' | 'status' | 'webhook';

interface Session {
  readonly sessionId: string;
  readonly subjectRef: string;
  readonly expiresAt: Date;
  state: VerificationStatus['state'];
  reasons: readonly string[];
}

export class FakeIdentityProvider {
  readonly runtime: FakeRuntime<IdentityOp, 'UNSUPPORTED_DOCUMENT' | 'UNKNOWN_SESSION'>;
  readonly #options: FakeIdentityProviderOptions;
  readonly #sessions = new Map<string, Session>();
  readonly #sessionIds = new Sequence('fk_idv');
  readonly #eventIds = new Sequence('fk_idv_evt');
  readonly #deliveries: { readonly dueAtMs: number; readonly delivery: WebhookDelivery }[] = [];

  constructor(options: FakeIdentityProviderOptions) {
    assertFakeAllowed('FakeIdentityProvider', options.env);
    if (!Number.isInteger(options.sessionTtlMs) || options.sessionTtlMs <= 0) {
      throw new RangeError('sessionTtlMs doit être un entier positif');
    }
    this.#options = options;
    this.runtime = new FakeRuntime(options.clock);
  }

  supportsDocument(document: IdentityDocumentRef): boolean {
    return this.#options.documents.some(
      (d) => d.country === document.country && d.kind === document.kind,
    );
  }

  async startVerification(
    request: StartVerificationRequest,
  ): Promise<Outcome<VerificationSession, 'UNSUPPORTED_DOCUMENT'>> {
    return this.runtime.execute(
      'start',
      { idempotencyKey: request.idempotencyKey, content: request },
      () => {
        if (!this.supportsDocument(request.document)) {
          return { ok: false, reason: 'UNSUPPORTED_DOCUMENT' as const };
        }
        const sessionId = this.#sessionIds.next();
        const expiresAt = new Date(this.runtime.clock.nowMs() + this.#options.sessionTtlMs);
        this.#sessions.set(sessionId, {
          sessionId,
          subjectRef: request.subjectRef,
          expiresAt,
          state: 'PENDING',
          reasons: [],
        });
        // Domaine réservé `.invalid` (RFC 2606) : jamais résolu, aucune donnée du sujet dans l'URL.
        const hostedUrl = `https://identity.fake.invalid/session/${sessionId}`;
        return { ok: true, value: { sessionId, hostedUrl, expiresAt } };
      },
    );
  }

  async getStatus(sessionId: string): Promise<Outcome<VerificationStatus, 'UNKNOWN_SESSION'>> {
    return this.runtime.execute('status', { content: sessionId }, () => {
      const session = this.#sessions.get(sessionId);
      if (session === undefined) return { ok: false, reason: 'UNKNOWN_SESSION' as const };
      const state =
        session.state === 'PENDING' && this.runtime.clock.nowMs() >= session.expiresAt.getTime()
          ? 'EXPIRED'
          : session.state;
      return { ok: true, value: { sessionId, state, reasons: [...session.reasons] } };
    });
  }

  /** Vérifie et lit un rappel de décision (signature, fraîcheur, forme). */
  parseWebhook(
    body: string,
    signature: string | undefined,
    receivedAt: Date,
  ): WebhookVerdict<IdentityDecisionEvent> {
    const check = checkFakeWebhook(
      this.#options.webhookSecret,
      body,
      signature,
      Math.floor(receivedAt.getTime() / 1000),
      this.#options.webhookToleranceSeconds,
    );
    if (check !== 'VALID') return { status: 'REJECTED', reason: check };
    const event = parseDecision(body);
    return event === null
      ? { status: 'REJECTED', reason: 'MALFORMED' }
      : { status: 'ACCEPTED', event };
  }

  // --- Pilotage par le test -------------------------------------------------------------------

  /** Le fournisseur rend sa décision ; le rappel suit le scénario `webhook`. */
  decide(
    sessionId: string,
    decision: IdentityDecision,
    reasons: readonly string[] = [],
  ): IdentityDecisionEvent {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) throw new Error('FakeIdentityProvider : session inconnue');
    session.state = decision;
    session.reasons = [...reasons];
    const event: IdentityDecisionEvent = {
      eventId: this.#eventIds.next(),
      sessionId,
      subjectRef: session.subjectRef,
      decision,
      reasons: [...reasons],
      decidedAt: this.runtime.clock.now(),
    };
    this.#emit(event);
    return event;
  }

  /** Rappels arrivés à échéance (heure virtuelle), dans l'ordre d'émission ; retirés de la file. */
  takeDeliveries(): WebhookDelivery[] {
    const now = this.runtime.clock.nowMs();
    const due = this.#deliveries.filter((d) => d.dueAtMs <= now);
    for (const d of due) this.#deliveries.splice(this.#deliveries.indexOf(d), 1);
    return due.map((d) => d.delivery);
  }

  #emit(event: IdentityDecisionEvent): void {
    const step = this.runtime.script.next('webhook');
    if (
      step.kind === 'UNAVAILABLE' ||
      step.kind === 'TIMEOUT_BEFORE' ||
      step.kind === 'TIMEOUT_AFTER' ||
      step.kind === 'REFUSE'
    ) {
      return; // rappel perdu : la décision reste lisible par getStatus
    }
    const body = JSON.stringify({ ...event, decidedAt: event.decidedAt.toISOString() });
    const dueAtMs = this.runtime.clock.nowMs() + (step.kind === 'DELAY' ? step.ms : 0);
    const times = step.kind === 'DUPLICATE' ? 2 : 1;
    for (let i = 0; i < times; i++) {
      const signature = signFakeWebhook(
        this.#options.webhookSecret,
        body,
        Math.floor(dueAtMs / 1000),
      );
      this.#deliveries.push({ dueAtMs, delivery: { body, signature } });
    }
  }
}

const DECISIONS: readonly string[] = ['APPROVED', 'DECLINED', 'REVIEW'];

function parseDecision(body: string): IdentityDecisionEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const decidedAt = typeof r['decidedAt'] === 'string' ? new Date(r['decidedAt']) : null;
  if (
    typeof r['eventId'] !== 'string' ||
    typeof r['sessionId'] !== 'string' ||
    typeof r['subjectRef'] !== 'string' ||
    typeof r['decision'] !== 'string' ||
    !DECISIONS.includes(r['decision']) ||
    !Array.isArray(r['reasons']) ||
    !r['reasons'].every((x) => typeof x === 'string') ||
    decidedAt === null ||
    Number.isNaN(decidedAt.getTime())
  ) {
    return null;
  }
  return {
    eventId: r['eventId'],
    sessionId: r['sessionId'],
    subjectRef: r['subjectRef'],
    decision: r['decision'] as IdentityDecision,
    reasons: r['reasons'] as string[],
    decidedAt,
  };
}
