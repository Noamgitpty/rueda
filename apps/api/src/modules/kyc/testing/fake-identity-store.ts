/**
 * FAKE du port `IdentityStore` (US-105) — TESTS SEULEMENT, jamais compilé en production
 * (`testing/` exclu par tsconfig.build.json). Mémoire seulement ; reproduit les issues des
 * commandes `core.kyc_*` de 0072 utiles aux contrats d'API (consentement à la version en vigueur,
 * téléphone, ouverture, session, décision idempotente par événement, rejets). Les règles
 * elles-mêmes sont prouvées sur PostgreSQL (packages/db/test/l0/l0-us105-*).
 */
import type { IdentityDecisionEvent } from '../internal/identity-provider.port.js';
import type {
  ConsentOutcome,
  DecisionResult,
  EligibilityOutcome,
  ErasureOutcome,
  IdentityState,
  IdentityStore,
  KycStatus,
  OpenResult,
  PendingErasure,
  RecordOutcome,
  SessionToRecord,
  WebhookRejectionReason,
} from '../internal/identity-store.js';
import { IdentityStoreError } from '../internal/identity-store.js';

interface Person {
  phoneVerified: boolean;
  consentVersion: number | null;
  verification: {
    id: string;
    country: string;
    status: KycStatus;
    attempt: number;
    provider: string;
    sessionRef: string | null;
    hostedUrl: string | null;
    sessionExpiresAt: Date | null;
    reasonCode: string | null;
  } | null;
}

export class FakeIdentityStore implements IdentityStore {
  /** Version en vigueur du consentement biométrique. */
  currentVersion = 1;
  /** Panne simulée de la base (toutes les opérations). */
  failing = false;
  /** Refus imposé du consentement (compte non éligible, texte indisponible). */
  consentRefusal: Exclude<ConsentOutcome, 'RECORDED' | 'VERSION_CHANGED'> | null = null;
  /** Issue imposée du contrôle d'éligibilité. */
  eligibilityOutcome: EligibilityOutcome = 'KYC_NOT_APPROVED';
  readonly decisions: { readonly eventId: string; readonly outcome: string }[] = [];
  /** Demandes d'effacement inscrites au retrait (lecture du test). */
  readonly erasures: {
    readonly requestId: string;
    readonly owner: string;
    readonly provider: string;
    readonly sessionRef: string;
    status: 'PENDING' | 'DONE' | 'FAILED';
    attestationRef: string | null;
  }[] = [];
  readonly rejections: {
    readonly provider: string;
    readonly reason: WebhookRejectionReason;
    readonly sha256: string;
    readonly length: number;
  }[] = [];
  readonly #people = new Map<string, Person>();
  readonly #events = new Set<string>();
  #ids = 0;

  /** Décision posée sur le dossier de la personne (comme la décision de l'ops, US-106). */
  setDecision(hashHex: string, status: KycStatus, reasonCode: string | null): void {
    const p = this.#people.get(hashHex);
    if (p === undefined) throw new Error('personne inconnue du FAKE');
    p.verification = {
      id: `ver_${String(++this.#ids)}`,
      country: 'ZZ',
      attempt: 1,
      provider: 'FAKE',
      sessionRef: null,
      hostedUrl: null,
      sessionExpiresAt: null,
      ...p.verification,
      status,
      reasonCode,
    };
  }

  /** Personne connue (empreinte hexadécimale de son jeton). */
  addPerson(hashHex: string, options: { phoneVerified?: boolean } = {}): void {
    this.#people.set(hashHex, {
      phoneVerified: options.phoneVerified ?? true,
      consentVersion: null,
      verification: null,
    });
  }

  #person(tokenHash: Buffer): Person | undefined {
    if (this.failing) throw new IdentityStoreError('fake', '08006');
    return this.#people.get(tokenHash.toString('hex'));
  }

  state(tokenHash: Buffer): Promise<IdentityState | null> {
    try {
      const p = this.#person(tokenHash);
      if (p === undefined) return Promise.resolve(null);
      const v = p.verification;
      return Promise.resolve({
        status: v?.status ?? 'NOT_STARTED',
        country: v?.country ?? null,
        reasonCode: v?.reasonCode ?? null,
        licenseExpiresOn: null,
        sessionLive: v?.status === 'DOCS_SUBMITTED',
        phoneVerified: p.phoneVerified,
        consent: {
          version: this.currentVersion,
          acceptedVersion: p.consentVersion === this.currentVersion ? p.consentVersion : null,
          locale: 'es',
          title: 'Consentimiento (prueba)',
          bodyMd: 'Texto de prueba.',
        },
      });
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  consent(
    tokenHash: Buffer,
    _country: string | null,
    version: number | null,
    accepted: boolean,
  ): Promise<{ readonly outcome: ConsentOutcome; readonly version: number | null }> {
    try {
      const p = this.#person(tokenHash);
      if (p === undefined) return Promise.resolve({ outcome: 'AUTH_REQUIRED', version: null });
      if (this.consentRefusal !== null) {
        return Promise.resolve({ outcome: this.consentRefusal, version: null });
      }
      if (accepted && version !== this.currentVersion) {
        return Promise.resolve({ outcome: 'VERSION_CHANGED', version: this.currentVersion });
      }
      p.consentVersion = accepted ? this.currentVersion : null;
      const v = p.verification;
      if (!accepted && v !== null) {
        // retrait : demande d'effacement datée, session effacée, dossier en RECHECK
        if (v.sessionRef !== null) {
          this.erasures.push({
            requestId: `00000000-0000-4000-9000-${String(this.erasures.length + 1).padStart(12, '0')}`,
            owner: tokenHash.toString('hex'),
            provider: v.provider,
            sessionRef: v.sessionRef,
            status: 'PENDING',
            attestationRef: null,
          });
        }
        v.status = 'RECHECK';
        v.attempt += 1;
        v.sessionRef = null;
        v.hostedUrl = null;
        v.sessionExpiresAt = null;
      }
      return Promise.resolve({ outcome: 'RECORDED', version: this.currentVersion });
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  open(tokenHash: Buffer, country: string, provider: string): Promise<OpenResult> {
    const none = (outcome: OpenResult['outcome']): Promise<OpenResult> =>
      Promise.resolve({
        outcome,
        verificationId: null,
        attempt: null,
        hostedUrl: null,
        sessionExpiresAt: null,
      });
    try {
      const p = this.#person(tokenHash);
      if (p === undefined) return none('AUTH_REQUIRED');
      if (!p.phoneVerified) return none('PHONE_NOT_VERIFIED');
      if (p.consentVersion !== this.currentVersion) return none('CONSENT_MISSING');
      const v = p.verification;
      if (v === null) {
        this.#ids += 1;
        p.verification = {
          id: `00000000-0000-4000-8000-${String(this.#ids).padStart(12, '0')}`,
          country,
          status: 'PHONE_VERIFIED',
          attempt: 1,
          provider,
          sessionRef: null,
          hostedUrl: null,
          sessionExpiresAt: null,
          reasonCode: null,
        };
        return Promise.resolve({
          outcome: 'READY',
          verificationId: p.verification.id,
          attempt: 1,
          hostedUrl: null,
          sessionExpiresAt: null,
        });
      }
      if (v.status === 'APPROVED') return none('ALREADY_APPROVED');
      if (v.status === 'AUTO_CHECKS' || v.status === 'MANUAL_REVIEW') return none('IN_REVIEW');
      if (v.status === 'DOCS_SUBMITTED' && v.sessionExpiresAt !== null && v.hostedUrl !== null) {
        return Promise.resolve({
          outcome: 'IN_PROGRESS',
          verificationId: v.id,
          attempt: v.attempt,
          hostedUrl: v.hostedUrl,
          sessionExpiresAt: v.sessionExpiresAt,
        });
      }
      if (
        !['PHONE_VERIFIED', 'DOCS_SUBMITTED', 'MORE_INFO_REQUIRED', 'RECHECK'].includes(v.status)
      ) {
        return none('NOT_ELIGIBLE');
      }
      return Promise.resolve({
        outcome: 'READY',
        verificationId: v.id,
        attempt: v.attempt,
        hostedUrl: null,
        sessionExpiresAt: null,
      });
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  recordSession(tokenHash: Buffer, s: SessionToRecord): Promise<RecordOutcome> {
    try {
      const p = this.#person(tokenHash);
      if (p === undefined) return Promise.resolve('AUTH_REQUIRED');
      const v = p.verification;
      if (v?.id !== s.verificationId) return Promise.resolve('NOT_FOUND');
      if (v.attempt !== s.attempt) return Promise.resolve('SUPERSEDED');
      v.sessionRef = s.sessionRef;
      v.hostedUrl = s.hostedUrl;
      v.sessionExpiresAt = s.expiresAt;
      v.status = 'DOCS_SUBMITTED';
      return Promise.resolve('RECORDED');
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  /** Statut courant de la personne (lecture du test). */
  statusOf(hashHex: string): KycStatus | null {
    return this.#people.get(hashHex)?.verification?.status ?? null;
  }

  applyDecision(provider: string, event: IdentityDecisionEvent): Promise<DecisionResult> {
    if (this.failing) return Promise.reject(new IdentityStoreError('fake', '08006'));
    const key = `${provider}:${event.eventId}`;
    let result: DecisionResult;
    const person = [...this.#people.values()].find(
      (x) =>
        x.verification?.sessionRef === event.sessionId && x.verification.id === event.subjectRef,
    );
    const v = person?.verification ?? null;
    if (person === undefined || v === null) {
      // session inconnue : l'identifiant d'événement n'est pas consommé
      result = { outcome: 'UNKNOWN_SESSION', status: null };
    } else if (this.#events.has(key)) {
      result = { outcome: 'DUPLICATE', status: null };
    } else {
      this.#events.add(key);
      if (person.consentVersion !== this.currentVersion) {
        result = { outcome: 'CONSENT_WITHDRAWN', status: v.status };
      } else if (v.status !== 'DOCS_SUBMITTED') {
        result = { outcome: 'STALE', status: v.status };
      } else {
        v.status = event.decision === 'APPROVED' ? 'APPROVED' : 'MANUAL_REVIEW';
        result = { outcome: 'APPLIED', status: v.status };
      }
    }
    this.decisions.push({ eventId: event.eventId, outcome: result.outcome });
    return Promise.resolve(result);
  }

  recordRejection(
    provider: string,
    reason: WebhookRejectionReason,
    bodySha256: Buffer,
    bodyLength: number,
  ): Promise<void> {
    if (this.failing) return Promise.reject(new IdentityStoreError('fake', '08006'));
    this.rejections.push({
      provider,
      reason,
      sha256: bodySha256.toString('hex'),
      length: bodyLength,
    });
    return Promise.resolve();
  }

  eligibility(tokenHash: Buffer): Promise<EligibilityOutcome> {
    try {
      return Promise.resolve(
        this.#person(tokenHash) === undefined ? 'AUTH_REQUIRED' : this.eligibilityOutcome,
      );
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  pendingErasures(tokenHash: Buffer): Promise<readonly PendingErasure[]> {
    if (this.failing) return Promise.reject(new IdentityStoreError('fake', '08006'));
    const owner = tokenHash.toString('hex');
    return Promise.resolve(
      this.erasures
        .filter((e) => e.owner === owner && e.status === 'PENDING')
        .map((e) => ({ requestId: e.requestId, provider: e.provider, sessionRef: e.sessionRef })),
    );
  }

  recordErasure(
    tokenHash: Buffer,
    requestId: string,
    outcome: 'DONE' | 'FAILED',
    attestationRef: string | null,
  ): Promise<ErasureOutcome> {
    if (this.failing) return Promise.reject(new IdentityStoreError('fake', '08006'));
    const e = this.erasures.find(
      (x) =>
        x.requestId === requestId &&
        x.owner === tokenHash.toString('hex') &&
        x.status === 'PENDING',
    );
    if (e === undefined) return Promise.resolve('NOT_FOUND');
    e.status = outcome;
    e.attestationRef = attestationRef;
    return Promise.resolve('RECORDED');
  }
}
