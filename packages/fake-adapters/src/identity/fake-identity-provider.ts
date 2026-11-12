/**
 * FAKE du port `IdentityProvider` (module KYC ; 17 §5 « KYC », §10 ; US-020). Simule un parcours
 * **hébergé** : l'application n'envoie ni pièce ni selfie, seulement une référence opaque du sujet
 * et le type de pièce ; la décision revient par un rappel signé (et par `getStatus`).
 *
 * Les pièces acceptées sont une **donnée** fournie à la construction (pays, type de pièce) : aucune
 * constante pays ici. Pièce non configurée ⇒ `UNSUPPORTED_DOCUMENT` (capacité inconnue = « non »).
 *
 * Résultat d'une décision (US-105) : scores de liveness et de face match et champs MINIMAUX de la
 * pièce (type, pays, échéance, classe, caractère définitif, référence chez le fournisseur) ; pour
 * l'hôte (US-123), faits vérifiés : date de naissance et pays de résidence. Jamais
 * d'image ni de numéro : la lecture du rappel ne garde que ces champs, tout autre champ est ignoré
 * (zéro copie, 17 §1.5 point 3).
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

/** Champs minimaux de la pièce lue par le fournisseur (aucune image, aucun numéro). */
export interface IdentityDocumentResult {
  readonly kind: string;
  readonly country: string;
  /** Échéance AAAA-MM-JJ ; `null` : inconnue. */
  readonly expiresOn: string | null;
  readonly licenseClass: string | null;
  /** Permis définitif (VER-006 : provisoire refusé) ; `null` : inconnu. */
  readonly isPermanent: boolean | null;
  readonly providerDocumentRef: string | null;
}

/**
 * Faits VÉRIFIÉS sur la personne (US-123 ; BOARD N-28, N-38) : date de naissance lue sur la pièce
 * et pays de résidence établi par le fournisseur. Aucun nom, aucun numéro, aucune adresse.
 */
export interface IdentitySubjectFacts {
  /** AAAA-MM-JJ ; `null` : inconnue. */
  readonly dateOfBirth: string | null;
  /** Code ISO à deux lettres ; `null` : inconnu. */
  readonly residenceCountry: string | null;
}

/** Contrôles du fournisseur : scores entre 0 et 1, pièce lue et, s'ils sont rendus, faits vérifiés. */
export interface IdentityChecks {
  readonly livenessScore: number | null;
  readonly faceMatchScore: number | null;
  readonly document: IdentityDocumentResult | null;
  readonly subject?: IdentitySubjectFacts | null;
}

export interface IdentityDecisionEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly subjectRef: string;
  readonly decision: IdentityDecision;
  readonly reasons: readonly string[];
  readonly decidedAt: Date;
  readonly checks: IdentityChecks;
}

const NO_CHECKS: IdentityChecks = { livenessScore: null, faceMatchScore: null, document: null };

export interface ErasureRequest {
  readonly idempotencyKey: string;
  readonly sessionId: string;
}

export interface ErasureReceipt {
  readonly attestationRef: string;
  readonly erasedAt: Date;
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

type IdentityOp = 'start' | 'status' | 'webhook' | 'erase';

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
  readonly #erasures = new Sequence('fk_idv_erase');
  /** Sessions effacées (lecture du test). */
  readonly erased = new Set<string>();
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

  /**
   * Efface les données d'une session (images, selfie, biométrie) et rend une attestation ; une
   * session déjà effacée rend la même issue (idempotent) ; inconnue : `UNKNOWN_SESSION`.
   */
  async requestErasure(
    request: ErasureRequest,
  ): Promise<Outcome<ErasureReceipt, 'UNKNOWN_SESSION'>> {
    return this.runtime.execute(
      'erase',
      { idempotencyKey: request.idempotencyKey, content: request },
      () => {
        if (!this.#sessions.has(request.sessionId) && !this.erased.has(request.sessionId)) {
          return { ok: false, reason: 'UNKNOWN_SESSION' as const };
        }
        this.#sessions.delete(request.sessionId);
        this.erased.add(request.sessionId);
        return {
          ok: true,
          value: { attestationRef: this.#erasures.next(), erasedAt: this.runtime.clock.now() },
        };
      },
    );
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

  /**
   * Le fournisseur rend sa décision ; le rappel suit le scénario `webhook`. `extra` : champs
   * ajoutés au corps du rappel (un fournisseur réel peut y mettre des liens d'images) ; la lecture
   * du rappel les ignore.
   */
  decide(
    sessionId: string,
    decision: IdentityDecision,
    reasons: readonly string[] = [],
    checks: IdentityChecks = NO_CHECKS,
    extra: Readonly<Record<string, unknown>> = {},
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
      checks,
    };
    this.#emit(event, extra);
    return event;
  }

  /** Rappels arrivés à échéance (heure virtuelle), dans l'ordre d'émission ; retirés de la file. */
  takeDeliveries(): WebhookDelivery[] {
    const now = this.runtime.clock.nowMs();
    const due = this.#deliveries.filter((d) => d.dueAtMs <= now);
    for (const d of due) this.#deliveries.splice(this.#deliveries.indexOf(d), 1);
    return due.map((d) => d.delivery);
  }

  #emit(event: IdentityDecisionEvent, extra: Readonly<Record<string, unknown>>): void {
    const step = this.runtime.script.next('webhook');
    if (
      step.kind === 'UNAVAILABLE' ||
      step.kind === 'TIMEOUT_BEFORE' ||
      step.kind === 'TIMEOUT_AFTER' ||
      step.kind === 'REFUSE'
    ) {
      return; // rappel perdu : la décision reste lisible par getStatus
    }
    const body = JSON.stringify({
      ...extra,
      ...event,
      decidedAt: event.decidedAt.toISOString(),
    });
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
  const id = (v: unknown): boolean => typeof v === 'string' && v.length >= 1 && v.length <= 200;
  if (
    !id(r['eventId']) ||
    !id(r['sessionId']) ||
    !id(r['subjectRef']) ||
    typeof r['decision'] !== 'string' ||
    !DECISIONS.includes(r['decision']) ||
    !Array.isArray(r['reasons']) ||
    !r['reasons'].every((x) => typeof x === 'string') ||
    decidedAt === null ||
    Number.isNaN(decidedAt.getTime())
  ) {
    return null;
  }
  const checks = parseChecks(r['checks']);
  if (checks === null) return null;
  return {
    eventId: r['eventId'] as string,
    sessionId: r['sessionId'] as string,
    subjectRef: r['subjectRef'] as string,
    decision: r['decision'] as IdentityDecision,
    reasons: r['reasons'] as string[],
    decidedAt,
    checks,
  };
}

const score = (v: unknown): number | null | undefined =>
  v === undefined || v === null
    ? null
    : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
      ? v
      : undefined;

const shortText = (v: unknown, max: number): string | null | undefined =>
  v === undefined || v === null
    ? null
    : typeof v === 'string' && v.length >= 1 && v.length <= max
      ? v
      : undefined;

/**
 * Contrôles du rappel : forme stricte ; seuls les champs connus sont recopiés (une image, un lien
 * ou un numéro ajouté par le fournisseur est ignoré). Absents : aucun contrôle. Mal formés : `null`
 * (rappel MALFORMED).
 */
function parseChecks(raw: unknown): IdentityChecks | null {
  if (raw === undefined || raw === null) return NO_CHECKS;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const livenessScore = score(c['livenessScore']);
  const faceMatchScore = score(c['faceMatchScore']);
  if (livenessScore === undefined || faceMatchScore === undefined) return null;
  const subject = parseSubject(c['subject']);
  if (subject === undefined) return null;
  const withSubject = subject === null ? {} : { subject };
  const d = c['document'];
  if (d === undefined || d === null)
    return { livenessScore, faceMatchScore, document: null, ...withSubject };
  if (typeof d !== 'object' || Array.isArray(d)) return null;
  const doc = d as Record<string, unknown>;
  const expiresOn = shortText(doc['expiresOn'], 10);
  const licenseClass = shortText(doc['licenseClass'], 20);
  const providerDocumentRef = shortText(doc['providerDocumentRef'], 200);
  const isPermanent =
    doc['isPermanent'] === undefined || doc['isPermanent'] === null
      ? null
      : typeof doc['isPermanent'] === 'boolean'
        ? doc['isPermanent']
        : undefined;
  if (
    typeof doc['kind'] !== 'string' ||
    !/^[A-Z][A-Z_]{1,31}$/.test(doc['kind']) ||
    typeof doc['country'] !== 'string' ||
    !/^[A-Z]{2}$/.test(doc['country']) ||
    expiresOn === undefined ||
    (expiresOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) ||
    licenseClass === undefined ||
    providerDocumentRef === undefined ||
    isPermanent === undefined
  ) {
    return null;
  }
  return {
    livenessScore,
    faceMatchScore,
    document: {
      kind: doc['kind'],
      country: doc['country'],
      expiresOn,
      licenseClass,
      isPermanent,
      providerDocumentRef,
    },
    ...withSubject,
  };
}

/**
 * Faits vérifiés du rappel (US-123) : forme stricte, champs connus seulement (un nom ou une adresse
 * ajoutés par le fournisseur sont ignorés). Absents : `null` ; mal formés : `undefined` (MALFORMED).
 */
function parseSubject(raw: unknown): IdentitySubjectFacts | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  const dateOfBirth = shortText(s['dateOfBirth'], 10);
  const residenceCountry = shortText(s['residenceCountry'], 2);
  if (
    dateOfBirth === undefined ||
    (dateOfBirth !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) ||
    residenceCountry === undefined ||
    (residenceCountry !== null && !/^[A-Z]{2}$/.test(residenceCountry))
  ) {
    return undefined;
  }
  return { dateOfBirth, residenceCountry };
}
