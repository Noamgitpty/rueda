/**
 * Vérification d'identité par parcours hébergé (US-105, ADR-101 ; 16 VER-001, VER-002 / VER-003,
 * VER-004 ; 17 §1.5 point 3, §3.2.2).
 *
 * - **État** : statut SM-3, pays du dossier, échéance du permis (la sienne), texte du
 *   consentement biométrique en vigueur dans la langue de la personne, pays proposés (CFG).
 * - **Consentement** : acceptation de la version AFFICHÉE (sinon 409) ou retrait.
 * - **Ouverture** : la base juge AVANT tout appel au fournisseur (consentement à la version en
 *   vigueur, téléphone vérifié, état) ; sans consentement, aucune session n'est demandée
 *   (`KYC_BIOMETRIC_CONSENT_MISSING`). Puis la pièce doit être prise en charge par le fournisseur
 *   (capacité inconnue = « non »), la session est demandée avec la clé d'idempotence
 *   (vérification, tentative) et posée en base (`DOCS_SUBMITTED`). Aucune pièce ni selfie ne
 *   transite par l'application : la personne est envoyée sur l'adresse hébergée.
 * - **Rappel** : signature et fraîcheur vérifiées par l'adaptateur sur le corps BRUT ; rejet ⇒
 *   journal (empreinte du corps) et 401 ; accepté ⇒ décision en base, idempotente par événement.
 * - **Éligibilité au paiement** (US-209) : `assertDriverEligible` lève `KYC_LICENSE_EXPIRED` si
 *   le permis expire avant la fin du trip, `KYC_NOT_APPROVED` sans vérification approuvée.
 *
 * Fail-closed : aucun fournisseur configuré (production tant qu'OQ-MK-09 est ouverte) ⇒
 * `KYC_PROVIDER_UNAVAILABLE` ; base illisible ⇒ 503 ; issue inconnue du fournisseur ⇒ 503 (la
 * même clé sera rejouée).
 */
import { createHash } from 'node:crypto';
import type { IdentityProvider } from './identity-provider.port.js';
import { IdentityStoreError } from './identity-store.js';
import type { IdentityState, IdentityStore, KycStatus } from './identity-store.js';
import { KycHttpError } from './errors.js';
import type { KycCode } from './errors.js';

/** Type de pièce demandé au fournisseur : le permis de conduire (16 VER-001). */
export const LICENSE_DOCUMENT_KIND = 'DRIVER_LICENSE';

export interface KycCountry {
  readonly code: string;
  readonly names: Readonly<Record<string, string>>;
}

export interface KycLogger {
  warn(message: string, fields: Readonly<Record<string, string | number>>): void;
}

export interface IdentityProviders {
  /** Fournisseur des nouvelles sessions (`null` : KYC indisponible, fail-closed). */
  readonly active: { readonly code: string; readonly provider: IdentityProvider } | null;
  /** Fournisseurs dont les rappels sont acceptés, par code (route `/kyc/webhooks/{code}`). */
  readonly byCode: ReadonlyMap<string, IdentityProvider>;
}

export interface IdentityServiceDeps {
  readonly store: IdentityStore;
  readonly providers: IdentityProviders;
  /** Adresse de retour après le parcours hébergé (`null` : aucun fournisseur). */
  readonly returnUrl: string | null;
  readonly countries: readonly KycCountry[];
  readonly log: KycLogger;
  readonly now?: () => Date;
}

export interface IdentityStateView {
  readonly code: 'KYC_STATE';
  readonly status: KycStatus;
  readonly country: string | null;
  readonly reasonCode: string | null;
  readonly licenseExpiresOn: string | null;
  readonly sessionLive: boolean;
  readonly phoneVerified: boolean;
  readonly available: boolean;
  readonly consent: {
    readonly version: number;
    readonly accepted: boolean;
    readonly locale: string;
    readonly title: string;
    readonly bodyMd: string;
  } | null;
  readonly countries: readonly KycCountry[];
}

export interface StartedSession {
  readonly code: 'KYC_SESSION_STARTED' | 'KYC_SESSION_IN_PROGRESS';
  readonly hostedUrl: string;
  readonly expiresAt: string;
}

const COUNTRY = /^[A-Z]{2}$/;
const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;

function storeFailure(error: unknown): never {
  if (error instanceof IdentityStoreError) throw new KycHttpError('KYC_PROVIDER_UNAVAILABLE');
  throw error;
}

function body(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new KycHttpError('REQUEST_INVALID');
  }
  return raw as Record<string, unknown>;
}

const OPEN_REFUSALS: Readonly<Record<string, KycCode>> = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  COUNTRY_UNKNOWN: 'COUNTRY_UNKNOWN',
  NOT_ELIGIBLE: 'KYC_NOT_ELIGIBLE',
  PHONE_NOT_VERIFIED: 'PHONE_NOT_VERIFIED',
  CONSENT_MISSING: 'KYC_BIOMETRIC_CONSENT_MISSING',
  IN_REVIEW: 'KYC_IN_REVIEW',
  ALREADY_APPROVED: 'KYC_ALREADY_APPROVED',
  PROVIDER_INVALID: 'KYC_PROVIDER_UNAVAILABLE',
};

export class IdentityVerificationService {
  readonly #deps: IdentityServiceDeps;
  readonly #known: ReadonlySet<string>;

  constructor(deps: IdentityServiceDeps) {
    this.#deps = deps;
    this.#known = new Set(deps.countries.map((c) => c.code));
  }

  #now(): Date {
    return this.#deps.now?.() ?? new Date();
  }

  /** Pays facultatif d'une requête : absent ⇒ `null` ; mal formé ou inconnu ⇒ 400. */
  #country(value: unknown, required: boolean): string | null {
    if (value === undefined || value === null || value === '') {
      if (required) throw new KycHttpError('REQUEST_INVALID');
      return null;
    }
    if (typeof value !== 'string' || !COUNTRY.test(value))
      throw new KycHttpError('REQUEST_INVALID');
    if (!this.#known.has(value)) throw new KycHttpError('COUNTRY_UNKNOWN');
    return value;
  }

  async state(proof: Buffer | null, country: unknown): Promise<IdentityStateView> {
    if (proof === null) throw new KycHttpError('AUTH_REQUIRED');
    const c = this.#country(country, false);
    let s: IdentityState | null;
    try {
      s = await this.#deps.store.state(proof, c);
    } catch (error) {
      storeFailure(error);
    }
    if (s === null) throw new KycHttpError('AUTH_REQUIRED');
    return {
      code: 'KYC_STATE',
      status: s.status,
      country: s.country,
      reasonCode: s.reasonCode,
      licenseExpiresOn: s.licenseExpiresOn,
      sessionLive: s.sessionLive,
      phoneVerified: s.phoneVerified,
      available: this.#deps.providers.active !== null && s.consent !== null,
      consent:
        s.consent === null
          ? null
          : {
              version: s.consent.version,
              accepted: s.consent.acceptedVersion === s.consent.version,
              locale: s.consent.locale,
              title: s.consent.title,
              bodyMd: s.consent.bodyMd,
            },
      countries: this.#deps.countries,
    };
  }

  async consent(proof: Buffer | null, raw: unknown): Promise<{ readonly version: number | null }> {
    if (proof === null) throw new KycHttpError('AUTH_REQUIRED');
    const b = body(raw);
    const accepted = b['accepted'];
    const version = b['version'];
    if (typeof accepted !== 'boolean') throw new KycHttpError('REQUEST_INVALID');
    if (
      accepted &&
      (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1)
    ) {
      throw new KycHttpError('REQUEST_INVALID');
    }
    const country = this.#country(b['country'], false);
    let r: Awaited<ReturnType<IdentityStore['consent']>>;
    try {
      r = await this.#deps.store.consent(
        proof,
        country,
        typeof version === 'number' ? version : null,
        accepted,
      );
    } catch (error) {
      storeFailure(error);
    }
    switch (r.outcome) {
      case 'RECORDED':
        return { version: r.version };
      case 'AUTH_REQUIRED':
        throw new KycHttpError('AUTH_REQUIRED');
      case 'NOT_ELIGIBLE':
        throw new KycHttpError('KYC_NOT_ELIGIBLE');
      case 'COUNTRY_UNKNOWN':
        throw new KycHttpError('COUNTRY_UNKNOWN');
      case 'CONSENT_UNAVAILABLE':
        throw new KycHttpError('KYC_CONSENT_UNAVAILABLE');
      case 'VERSION_CHANGED':
        throw new KycHttpError('KYC_CONSENT_VERSION_CHANGED');
    }
  }

  async start(proof: Buffer | null, raw: unknown, locale: string): Promise<StartedSession> {
    if (proof === null) throw new KycHttpError('AUTH_REQUIRED');
    const b = body(raw);
    const country = this.#country(b['country'], true) as string;
    // langue du parcours hébergé : celle de la vue (corps), sinon l'en-tête de la requête
    const view = b['locale'];
    if (view !== undefined && (typeof view !== 'string' || !LOCALE.test(view))) {
      throw new KycHttpError('REQUEST_INVALID');
    }
    const active = this.#deps.providers.active;
    const returnUrl = this.#deps.returnUrl;
    // KYC de production désactivé tant que le registre n'est pas validé (OQ-MK-09) : aucun
    // fournisseur, aucune écriture
    if (active === null || returnUrl === null) throw new KycHttpError('KYC_PROVIDER_UNAVAILABLE');

    let opened: Awaited<ReturnType<IdentityStore['open']>>;
    try {
      opened = await this.#deps.store.open(proof, country, active.code);
    } catch (error) {
      storeFailure(error);
    }
    if (opened.outcome === 'IN_PROGRESS') {
      if (opened.hostedUrl === null || opened.sessionExpiresAt === null) {
        throw new KycHttpError('KYC_PROVIDER_UNAVAILABLE');
      }
      return {
        code: 'KYC_SESSION_IN_PROGRESS',
        hostedUrl: opened.hostedUrl,
        expiresAt: opened.sessionExpiresAt.toISOString(),
      };
    }
    if (opened.outcome !== 'READY') {
      throw new KycHttpError(OPEN_REFUSALS[opened.outcome] ?? 'KYC_PROVIDER_UNAVAILABLE');
    }
    const verificationId = opened.verificationId;
    const attempt = opened.attempt;
    if (verificationId === null || attempt === null) {
      throw new KycHttpError('KYC_PROVIDER_UNAVAILABLE');
    }
    const document = { country, kind: LICENSE_DOCUMENT_KIND };
    // capacité inconnue = « non » : aucune session pour une pièce non prise en charge
    if (!active.provider.supportsDocument(document)) {
      throw new KycHttpError('KYC_DOCUMENT_UNSUPPORTED');
    }
    const out = await active.provider.startVerification({
      idempotencyKey: `${verificationId}:${String(attempt)}`,
      // référence opaque du sujet : l'identifiant du dossier, jamais un nom ni un contact
      subjectRef: verificationId,
      document,
      locale: typeof view === 'string' ? view : LOCALE.test(locale) ? locale : 'es',
      returnUrl,
    });
    if (out.status === 'UNAVAILABLE' || out.status === 'TIMEOUT') {
      throw new KycHttpError('KYC_PROVIDER_UNAVAILABLE');
    }
    if (out.status === 'REFUSED') {
      throw new KycHttpError(
        out.reason === 'UNSUPPORTED_DOCUMENT' || out.reason === 'UNSUPPORTED'
          ? 'KYC_DOCUMENT_UNSUPPORTED'
          : 'KYC_SESSION_FAILED',
      );
    }
    const session = out.value;
    if (
      !/^https:\/\//.test(session.hostedUrl) ||
      session.hostedUrl.length > 500 ||
      session.expiresAt.getTime() <= this.#now().getTime()
    ) {
      throw new KycHttpError('KYC_SESSION_FAILED');
    }
    let recorded: Awaited<ReturnType<IdentityStore['recordSession']>>;
    try {
      recorded = await this.#deps.store.recordSession(proof, {
        verificationId,
        attempt,
        provider: active.code,
        sessionRef: session.sessionId,
        hostedUrl: session.hostedUrl,
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      storeFailure(error);
    }
    if (recorded === 'AUTH_REQUIRED') throw new KycHttpError('AUTH_REQUIRED');
    if (recorded !== 'RECORDED') throw new KycHttpError('KYC_SESSION_FAILED');
    return {
      code: 'KYC_SESSION_STARTED',
      hostedUrl: session.hostedUrl,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /**
   * Rappel du fournisseur `providerCode` (corps BRUT, en-tête de signature). Statut HTTP seul :
   * 200 (décision appliquée, rejouée, périmée ou session inconnue : rien à rejouer), 401 (rejet
   * journalisé), 404 (fournisseur inconnu, rien n'est écrit), 503 (base indisponible : le
   * fournisseur rejouera).
   */
  async webhook(
    providerCode: string,
    rawBody: Uint8Array,
    signature: string | undefined,
  ): Promise<200 | 401 | 404 | 503> {
    const provider = this.#deps.providers.byCode.get(providerCode);
    if (provider === undefined) return 404;
    const text = Buffer.from(rawBody).toString('utf8');
    const verdict = provider.parseWebhook(text, signature, this.#now());
    try {
      if (verdict.status === 'REJECTED') {
        await this.#deps.store.recordRejection(
          providerCode,
          verdict.reason,
          createHash('sha256').update(rawBody).digest(),
          rawBody.length,
        );
        this.#deps.log.warn('kyc.webhook.rejected', {
          provider: providerCode,
          reason: verdict.reason,
        });
        return 401;
      }
      const r = await this.#deps.store.applyDecision(providerCode, verdict.event);
      if (r.outcome !== 'APPLIED') {
        this.#deps.log.warn('kyc.webhook.ignored', { provider: providerCode, outcome: r.outcome });
      }
      return 200;
    } catch (error) {
      if (error instanceof IdentityStoreError) return 503;
      throw error;
    }
  }

  /**
   * Contrôle bloquant du paiement (16 VER-001 ; à poser par US-209) : vérification approuvée et
   * permis valable jusqu'à la fin du trip, dans le fuseau du pays du trip (jugé en base).
   */
  async assertDriverEligible(
    proof: Buffer | null,
    tripEnd: Date,
    tripCountry: string,
  ): Promise<void> {
    if (proof === null) throw new KycHttpError('AUTH_REQUIRED');
    if (Number.isNaN(tripEnd.getTime()) || !COUNTRY.test(tripCountry)) {
      throw new KycHttpError('REQUEST_INVALID');
    }
    let r: Awaited<ReturnType<IdentityStore['eligibility']>>;
    try {
      r = await this.#deps.store.eligibility(proof, tripEnd, tripCountry);
    } catch (error) {
      storeFailure(error);
    }
    if (r === 'ELIGIBLE') return;
    throw new KycHttpError(r);
  }
}
