/**
 * Vérification d'identité par parcours hébergé (US-105, ADR-102 ; 16 VER-001, VER-002 / VER-003,
 * VER-004 ; 17 §1.5 point 3, §3.2.2).
 *
 * - **État** : statut SM-3, pays du dossier, échéance du permis (la sienne), texte du
 *   consentement biométrique en vigueur dans la langue de la personne, pays proposés (CFG).
 * - **Consentement** : acceptation de la version AFFICHÉE (sinon 409) ou RETRAIT (VER-004 ;
 *   RISKS L1-PM-39) : la base révoque, efface scores et références, repasse le dossier en
 *   `RECHECK` et inscrit une demande d'effacement datée par session ; le service l'exécute
 *   aussitôt par le port (`requestErasure`) et en consigne l'attestation. Fournisseur absent ou en
 *   panne : la demande reste en attente (reprise par l'ops), le retrait reste acquis.
 * - **Ouverture** : la base juge AVANT tout appel au fournisseur (consentement à la version en
 *   vigueur, téléphone vérifié, état) ; sans consentement, aucune session n'est demandée
 *   (`KYC_BIOMETRIC_CONSENT_MISSING`). Puis la pièce doit être prise en charge par le fournisseur
 *   (capacité inconnue = « non »), la session est demandée avec la clé d'idempotence
 *   (vérification, tentative) et posée en base (`DOCS_SUBMITTED`). Aucune pièce ni selfie ne
 *   transite par l'application : la personne est envoyée sur l'adresse hébergée.
 * - **Rappel** : signature et fraîcheur vérifiées par l'adaptateur sur le corps BRUT ; rejet ⇒
 *   journal (empreinte du corps) et 401 ; accepté ⇒ décision en base, idempotente par événement.
 * - **Nom légal** (US-103, ADR-117) : changement par la personne ; refusé pendant une décision en
 *   cours ; un dossier approuvé repasse `RECHECK`. Le rapprochement avec le nom lu sur le permis
 *   est fait en base, à la décision du fournisseur.
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

/**
 * Motifs montrés au voyageur (US-106 ; 08 BR-VERIF-03 : jamais au-delà d'une catégorie générique) :
 * seulement le conseil de reprise d'une nouvelle pièce demandée (selfie, pièce d'identité, permis).
 * Tout autre motif (refus, doublon, revue, retrait…) est masqué : `null`.
 */
export const GUEST_REASON_CODES = [
  'LIVENESS_FAILED',
  'ID_DOCUMENT_REFUSED',
  'LICENSE_NOT_ACCEPTED',
] as const;
export type GuestReasonCode = (typeof GUEST_REASON_CODES)[number];

export function guestReasonCode(status: string, reason: string | null): GuestReasonCode | null {
  return status === 'MORE_INFO_REQUIRED' &&
    (GUEST_REASON_CODES as readonly (string | null)[]).includes(reason)
    ? (reason as GuestReasonCode)
    : null;
}

export interface IdentityStateView {
  readonly code: 'KYC_STATE';
  readonly status: KycStatus;
  readonly country: string | null;
  /** Catégorie de reprise seulement (`guestReasonCode`), jamais le motif brut du dossier. */
  readonly reasonCode: GuestReasonCode | null;
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

export interface LegalNameChanged {
  readonly code: 'LEGAL_NAME_UPDATED' | 'LEGAL_NAME_UNCHANGED';
  /** Statut SM-3 après le changement (`RECHECK` : nouvelle vérification exigée). */
  readonly status: KycStatus;
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
  // garde de production en base (OQ-MK-09, L1-PM-05)
  PRODUCTION_BLOCKED: 'KYC_PROVIDER_UNAVAILABLE',
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
      reasonCode: guestReasonCode(s.status, s.reasonCode),
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
        if (!accepted) await this.#erase(proof);
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

  /**
   * Exécute les demandes d'effacement en attente de la personne (après un retrait). Jamais
   * d'échec visible : le retrait est acquis en base ; une demande non exécutée reste en attente.
   */
  async #erase(proof: Buffer): Promise<void> {
    let pending: Awaited<ReturnType<IdentityStore['pendingErasures']>>;
    try {
      pending = await this.#deps.store.pendingErasures(proof);
    } catch {
      this.#deps.log.warn('kyc.erasure.unavailable', { stage: 'pending' });
      return;
    }
    for (const r of pending) {
      const provider = this.#deps.providers.byCode.get(r.provider);
      if (provider === undefined) {
        this.#deps.log.warn('kyc.erasure.pending', { provider: r.provider });
        continue;
      }
      const out = await provider.requestErasure({
        idempotencyKey: `erase:${r.requestId}`,
        sessionId: r.sessionRef,
      });
      if (out.status === 'UNAVAILABLE' || out.status === 'TIMEOUT') {
        this.#deps.log.warn('kyc.erasure.pending', { provider: r.provider });
        continue;
      }
      try {
        await this.#deps.store.recordErasure(
          proof,
          r.requestId,
          out.status === 'OK' ? 'DONE' : 'FAILED',
          out.status === 'OK' ? out.value.attestationRef : null,
        );
      } catch {
        this.#deps.log.warn('kyc.erasure.unavailable', { stage: 'record' });
      }
    }
  }

  /**
   * Changement du nom légal (US-103 ; 16 ACC-006, BR-ACC-07) : prénoms et noms tels que sur le
   * permis. La base juge (verrou de la personne) : décision en cours ⇒ 409
   * `PROFILE_NAME_LOCKED_PENDING_REVIEW` ; dossier approuvé ⇒ `RECHECK`, nouvelle vérification
   * exigée (paiement et remise refusés d'ici là). Le nom n'est jamais journalisé.
   */
  async changeLegalName(proof: Buffer | null, raw: unknown): Promise<LegalNameChanged> {
    if (proof === null) throw new KycHttpError('AUTH_REQUIRED');
    const b = body(raw);
    const first = b['legalFirstName'];
    const last = b['legalLastName'];
    if (typeof first !== 'string' || typeof last !== 'string') {
      throw new KycHttpError('REQUEST_INVALID');
    }
    // borne de la requête (la base borne le nom à 100 caractères)
    if (first.length > 400 || last.length > 400) throw new KycHttpError('PROFILE_NAME_REQUIRED');
    let r: Awaited<ReturnType<IdentityStore['changeLegalName']>>;
    try {
      r = await this.#deps.store.changeLegalName(proof, first, last);
    } catch (error) {
      storeFailure(error);
    }
    switch (r.outcome) {
      case 'CHANGED':
        return { code: 'LEGAL_NAME_UPDATED', status: r.status ?? 'NOT_STARTED' };
      case 'UNCHANGED':
        return { code: 'LEGAL_NAME_UNCHANGED', status: r.status ?? 'NOT_STARTED' };
      case 'AUTH_REQUIRED':
        throw new KycHttpError('AUTH_REQUIRED');
      case 'NOT_ELIGIBLE':
        throw new KycHttpError('KYC_NOT_ELIGIBLE');
      case 'NAME_REQUIRED':
        throw new KycHttpError('PROFILE_NAME_REQUIRED');
      case 'LOCKED_PENDING_REVIEW':
        throw new KycHttpError('PROFILE_NAME_LOCKED_PENDING_REVIEW');
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
