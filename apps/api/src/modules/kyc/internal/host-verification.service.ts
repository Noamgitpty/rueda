/**
 * Inscription et vérification individuelle de l'hôte (US-123, ADR-105 ; 16 HST-049 / FIN-008 /
 * VER-028 ; 17 §2.4) — liste de tâches A07 du parcours « devenir hôte ».
 *
 * - **État** : statut du compte d'hôte et du dossier, pièces manquantes, contrôles (sans date de
 *   naissance ni numéro fiscal), types de numéro admis dans le pays (configuration), blocages de
 *   l'activation (pays pas encore ouvert compris). Une correspondance de sanctions n'est jamais
 *   révélée à l'hôte : le dossier suit le calcul d'un dossier propre (statut, pièces manquantes,
 *   profil fiscal) et n'est simplement jamais approuvable.
 * - **Profil fiscal** (FIN-008) : personne physique seulement (une donnée d'entreprise dans le
 *   corps ⇒ `HOST_ENTITY_NOT_ALLOWED`, BR-ACC-06) ; numéro normalisé, forme générale contrôlée ici,
 *   type admis jugé en base ; numéro CHIFFRÉ par la clé du compte d'hôte (port `TaxIdSealer`)
 *   avant l'écriture : la base ne le voit jamais en clair. Sans coffre : 503, rien n'est écrit.
 * - **Soumission** : la base juge (KYC approuvé, âge, résidence) ; puis, si aucun filtrage n'est
 *   consigné et qu'un prestataire est configuré, filtrage des sanctions par le port
 *   `SanctionsScreener` (clé d'idempotence rendue par la base) et résultat consigné. Prestataire
 *   absent ou en panne : le dossier reste incomplet (`HOST_SCREENING_MISSING`), jamais approuvé.
 *
 * Fail-closed : base illisible ⇒ 503 ; issue inconnue ⇒ 503.
 */
import { kycBody, KycHttpError } from './errors.js';
import type { KycBody, KycCode } from './errors.js';
import { HostVerificationStoreError } from './host-verification-store.js';
import type {
  HostVerificationState,
  HostVerificationStore,
  SubmitOutcome,
  TaxOutcome,
} from './host-verification-store.js';
import type { SanctionsScreener } from './sanctions-screener.port.js';
import type { TaxIdSealer } from './tax-id-sealer.port.js';

export interface HostVerificationLogger {
  warn(message: string, fields: Readonly<Record<string, string | number>>): void;
}

export interface HostVerificationDeps {
  readonly store: HostVerificationStore;
  /** Prestataire de filtrage des sanctions (`null` : aucun, le dossier reste incomplet). */
  readonly screener: { readonly code: string; readonly screener: SanctionsScreener } | null;
  /** Chiffrement du numéro fiscal par la clé du sujet (`null` : aucun coffre, 503). */
  readonly sealer: TaxIdSealer | null;
  readonly log: HostVerificationLogger;
}

export type HostVerificationView = KycBody &
  HostVerificationState & {
    readonly code:
      'HOST_VERIFICATION_STATE' | 'HOST_VERIFICATION_SUBMITTED' | 'HOST_TAX_PROFILE_SAVED';
  };

/** Champs d'entreprise refusés dans un profil fiscal (personne physique seulement, BR-ACC-06). */
const ENTITY_FIELDS = [
  'legalName',
  'tradeName',
  'companyName',
  'businessName',
  'companyTaxId',
  'legalEntity',
] as const;
const TAX_BODY_FIELDS = new Set(['kind', 'taxId', 'regime', 'taxpayerKind']);
/** Forme générale d'un numéro fiscal normalisé (chiffres, lettres, tirets) ; le type est jugé en base. */
const TAX_ID = /^[0-9A-Z][0-9A-Z-]{3,19}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,31}$/;

function storeFailure(error: unknown): never {
  if (error instanceof HostVerificationStoreError) {
    throw new KycHttpError('HOST_VERIFICATION_UNAVAILABLE');
  }
  throw error;
}

const TAX_REFUSALS: Readonly<Record<Exclude<TaxOutcome, 'SAVED'>, KycCode>> = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'HOST_ACCOUNT_NOT_FOUND',
  HOST_ENTITY_NOT_ALLOWED: 'HOST_ENTITY_NOT_ALLOWED',
  HOST_TAX_ID_KIND_INVALID: 'HOST_TAX_ID_KIND_INVALID',
  REQUEST_INVALID: 'REQUEST_INVALID',
  HOST_VERIFICATION_LOCKED: 'HOST_VERIFICATION_LOCKED',
};

const SUBMIT_REFUSALS: Readonly<Record<Exclude<SubmitOutcome, 'SUBMITTED' | 'DECIDED'>, KycCode>> =
  {
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    FORBIDDEN: 'HOST_ACCOUNT_NOT_FOUND',
    HOST_ACCOUNT_NOT_ELIGIBLE: 'HOST_ACCOUNT_NOT_ELIGIBLE',
    HOST_KYC_REQUIRED: 'HOST_KYC_REQUIRED',
    PARAM_MISSING: 'HOST_VERIFICATION_UNAVAILABLE',
    HOST_AGE_UNVERIFIED: 'HOST_AGE_UNVERIFIED',
    HOST_UNDER_AGE: 'HOST_UNDER_AGE',
    HOST_RESIDENCE_MISMATCH: 'HOST_RESIDENCE_MISMATCH',
  };

export class HostVerificationService {
  readonly #deps: HostVerificationDeps;

  constructor(deps: HostVerificationDeps) {
    this.#deps = deps;
  }

  async state(tokenHash: Buffer, orgId: string): Promise<HostVerificationView> {
    return {
      ...(await this.#state(tokenHash, orgId)),
      ...kycBody('HOST_VERIFICATION_STATE'),
      code: 'HOST_VERIFICATION_STATE',
    };
  }

  async #state(tokenHash: Buffer, orgId: string): Promise<HostVerificationState> {
    const r = await this.#deps.store.state(tokenHash, orgId).catch(storeFailure);
    if (r.outcome !== 'OK') {
      throw new KycHttpError(
        r.outcome === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'HOST_ACCOUNT_NOT_FOUND',
      );
    }
    return r.state;
  }

  async saveTaxProfile(
    tokenHash: Buffer,
    orgId: string,
    raw: unknown,
  ): Promise<HostVerificationView> {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new KycHttpError('REQUEST_INVALID');
    }
    const body = raw as Record<string, unknown>;
    // personne physique seulement : toute donnée d'entreprise est refusée, avant toute écriture
    if (ENTITY_FIELDS.some((f) => body[f] !== undefined && body[f] !== null)) {
      throw new KycHttpError('HOST_ENTITY_NOT_ALLOWED');
    }
    if (Object.keys(body).some((k) => !TAX_BODY_FIELDS.has(k))) {
      throw new KycHttpError('REQUEST_INVALID');
    }
    const taxpayerKind = body['taxpayerKind'] ?? 'INDIVIDUAL';
    if (typeof taxpayerKind !== 'string' || !CODE.test(taxpayerKind)) {
      throw new KycHttpError('REQUEST_INVALID');
    }
    if (taxpayerKind !== 'INDIVIDUAL') throw new KycHttpError('HOST_ENTITY_NOT_ALLOWED');
    const kind = body['kind'];
    const regime = body['regime'] ?? null;
    if (
      typeof kind !== 'string' ||
      !CODE.test(kind) ||
      (regime !== null && (typeof regime !== 'string' || !CODE.test(regime)))
    ) {
      throw new KycHttpError('REQUEST_INVALID');
    }
    const taxIdRaw = body['taxId'];
    if (typeof taxIdRaw !== 'string' || taxIdRaw.length > 64) {
      throw new KycHttpError('REQUEST_INVALID');
    }
    const taxId = taxIdRaw.replace(/[\s.]/g, '').toUpperCase();
    if (!TAX_ID.test(taxId)) throw new KycHttpError('HOST_TAX_ID_INVALID');
    // le compte d'hôte doit être le sien AVANT tout appel au coffre
    await this.#state(tokenHash, orgId);
    if (this.#deps.sealer === null) throw new KycHttpError('HOST_TAX_VAULT_UNAVAILABLE');
    const sealed = await this.#deps.sealer.seal(orgId, taxId);
    if (sealed.status !== 'OK') throw new KycHttpError('HOST_TAX_VAULT_UNAVAILABLE');
    const outcome = await this.#deps.store
      .saveTaxProfile(tokenHash, orgId, { kind, envelope: sealed.envelope, regime, taxpayerKind })
      .catch(storeFailure);
    if (outcome !== 'SAVED') throw new KycHttpError(TAX_REFUSALS[outcome]);
    return {
      ...(await this.#state(tokenHash, orgId)),
      ...kycBody('HOST_TAX_PROFILE_SAVED'),
      code: 'HOST_TAX_PROFILE_SAVED',
    };
  }

  async submit(tokenHash: Buffer, orgId: string): Promise<HostVerificationView> {
    const r = await this.#deps.store.submit(tokenHash, orgId).catch(storeFailure);
    if (r.outcome !== 'SUBMITTED' && r.outcome !== 'DECIDED') {
      throw new KycHttpError(SUBMIT_REFUSALS[r.outcome]);
    }
    const screener = this.#deps.screener;
    if (r.outcome === 'SUBMITTED' && r.screening !== null && screener !== null) {
      const state = await this.#state(tokenHash, orgId);
      const out = await screener.screener.screen({
        idempotencyKey: r.screening.key,
        identityProvider: r.screening.identityProvider,
        identitySessionRef: r.screening.identitySessionRef,
        country: state.country,
      });
      if (out.status === 'OK') {
        const recorded = await this.#deps.store
          .recordScreening(tokenHash, orgId, {
            provider: screener.code,
            key: r.screening.key,
            result: out.value.result,
            listsVersion: out.value.listsVersion,
            matchRef: out.value.matchRef,
          })
          .catch(storeFailure);
        if (recorded !== 'RECORDED' && recorded !== 'DUPLICATE') {
          this.#deps.log.warn('filtrage des sanctions non consigné', { outcome: recorded });
        }
      } else {
        // panne ou issue inconnue : le dossier reste incomplet ; la même clé sera rejouée
        this.#deps.log.warn('filtrage des sanctions indisponible', { status: out.status });
      }
    }
    return {
      ...(await this.#state(tokenHash, orgId)),
      ...kycBody('HOST_VERIFICATION_SUBMITTED'),
      code: 'HOST_VERIFICATION_SUBMITTED',
    };
  }
}
