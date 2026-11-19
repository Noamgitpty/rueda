/**
 * Compte de versement de l'hôte (US-707, ADR-180 ; 16 PYO-001 ; 08 BR-PAYOUT-01 ; 17 §3.2.9).
 *
 * - **État** (titulaire seulement) : rails du pays (configuration), type du numéro fiscal
 *   enregistré, compte courant MASQUÉ (établissement, 4 derniers caractères, statut, retenue
 *   après un changement, motif d'un refus). Aucun numéro, jamais.
 * - **Enregistrement** : corps contrôlé ; la base juge le titulaire (co-hôte ⇒ 404 comme un compte
 *   inconnu, permission `payout.manage_account`), le KYC, le profil fiscal et le NOM du titulaire
 *   (nom légal vérifié) ; le format du numéro et l'établissement sont jugés contre les rails du
 *   pays ; la cédula / le RUC déclaré est comparé au numéro fiscal chiffré de l'hôte par le coffre
 *   (port `PayoutAccountVault`) ; le numéro de compte est CHIFFRÉ par la clé du compte d'hôte avant
 *   l'écriture ; puis le PSP vérifie le compte (port `PayoutAccountVerifier`, FAKE seulement) :
 *   refus ⇒ compte REJECTED et 422 ; panne ⇒ compte en vérification (PENDING). Un changement de
 *   compte retient les versements 48 h (la base pose la retenue).
 * - Aucun numéro (compte, 4 derniers caractères, pièce) dans un journal, une erreur ou un
 *   événement : seuls des codes et des statuts sont journalisés.
 *
 * Fail-closed : base illisible ⇒ 503 ; sans coffre ⇒ 503, rien n'est écrit.
 */
import { pyoBody, PyoHttpError } from './errors.js';
import type { PyoBody, PyoCode } from './errors.js';
import { normalizeTaxId } from './payout-account-vault.port.js';
import type { PayoutAccountVault } from './payout-account-vault.port.js';
import type { PayoutAccountVerifier } from './payout-account-verifier.port.js';
import { PayoutAccountStoreError, RAIL_KINDS } from './payout-account-store.js';
import type {
  ContextRefusal,
  PayoutAccountSnapshot,
  PayoutAccountStore,
  RailKind,
  RegisterRefusal,
} from './payout-account-store.js';

export interface PayoutAccountLogger {
  warn(message: string, fields: Readonly<Record<string, string | number>>): void;
}

export interface PayoutAccountDeps {
  readonly store: PayoutAccountStore;
  /** Coffre de clés (`null` : aucun KMS, 503 à l'enregistrement). */
  readonly vault: PayoutAccountVault | null;
  /** Vérification par le PSP (`null` : aucun prestataire, le compte reste en vérification). */
  readonly verifier: PayoutAccountVerifier | null;
  readonly log: PayoutAccountLogger;
}

export interface PayoutAccountView extends PyoBody {
  readonly code: 'PAYOUT_ACCOUNT_STATE' | 'PAYOUT_ACCOUNT_SAVED';
  readonly country: string;
  readonly currency: string;
  readonly rails: readonly { readonly kind: RailKind; readonly institutions: string[] | null }[];
  readonly taxKind: string | null;
  readonly account: {
    readonly status: string;
    readonly kind: RailKind;
    readonly institution: string;
    readonly last4: string;
    readonly holdUntil: string | null;
    readonly rejectReason: string | null;
  } | null;
}

const BODY_FIELDS = new Set([
  'kind',
  'institution',
  'accountNumber',
  'holderGivenNames',
  'holderSurnames',
  'holderTaxId',
]);
const INSTITUTION = /^[A-Z0-9][A-Z0-9_]{1,31}$/;
/** Forme générale d'un numéro de compte ou de portefeuille normalisé ; le format du pays suit. */
const ACCOUNT = /^[0-9A-Z]{4,34}$/;
const TAX_ID = /^[0-9A-Z][0-9A-Z-]{3,19}$/;

const REFUSALS: Readonly<Record<ContextRefusal | RegisterRefusal, PyoCode>> = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'HOST_ACCOUNT_NOT_FOUND',
  PERMISSION_DENIED: 'PAYOUT_MANAGE_FORBIDDEN',
  HOST_PAYOUT_RAIL_UNAVAILABLE: 'HOST_PAYOUT_RAIL_UNAVAILABLE',
  HOST_KYC_REQUIRED: 'HOST_KYC_REQUIRED',
  HOST_TAX_ID_REQUIRED: 'HOST_TAX_ID_REQUIRED',
  PAYOUT_HOLDER_MISMATCH: 'PAYOUT_HOLDER_MISMATCH',
  REQUEST_INVALID: 'REQUEST_INVALID',
  PAYOUT_RAIL_UNSUPPORTED: 'PAYOUT_RAIL_UNSUPPORTED',
  PAYOUT_ACCOUNT_INVALID: 'PAYOUT_ACCOUNT_INVALID',
};

function storeFailure(error: unknown): never {
  if (error instanceof PayoutAccountStoreError) {
    throw new PyoHttpError('PAYOUT_ACCOUNT_UNAVAILABLE');
  }
  throw error;
}

/** Motif du pays (donnée de configuration) ; illisible ⇒ refus (fail-closed). */
function matches(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function text(body: Record<string, unknown>, field: string, max: number): string {
  const v = body[field];
  if (typeof v !== 'string' || v.length > max) throw new PyoHttpError('REQUEST_INVALID');
  const t = v.trim();
  if (t.length === 0) throw new PyoHttpError('REQUEST_INVALID');
  return t;
}

export class PayoutAccountService {
  readonly #deps: PayoutAccountDeps;

  constructor(deps: PayoutAccountDeps) {
    this.#deps = deps;
  }

  async state(tokenHash: Buffer, orgId: string): Promise<PayoutAccountView> {
    return this.#view(await this.#snapshot(tokenHash, orgId), 'PAYOUT_ACCOUNT_STATE');
  }

  async #snapshot(tokenHash: Buffer, orgId: string): Promise<PayoutAccountSnapshot> {
    const r = await this.#deps.store.state(tokenHash, orgId).catch(storeFailure);
    if (r.outcome !== 'OK') throw new PyoHttpError(REFUSALS[r.outcome]);
    return r.state;
  }

  #view(s: PayoutAccountSnapshot, code: PayoutAccountView['code']): PayoutAccountView {
    return {
      ...pyoBody(code),
      code,
      country: s.country,
      currency: s.currency,
      rails: s.rails.map((r) => ({
        kind: r.kind,
        institutions: r.institutions === null ? null : [...r.institutions],
      })),
      taxKind: s.taxKind,
      account:
        s.account === null
          ? null
          : {
              status: s.account.status,
              kind: s.account.kind,
              institution: s.account.institution,
              last4: s.account.last4,
              holdUntil: s.account.holdUntil === null ? null : s.account.holdUntil.toISOString(),
              rejectReason: s.account.rejectReason,
            },
    };
  }

  async save(tokenHash: Buffer, orgId: string, raw: unknown): Promise<PayoutAccountView> {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new PyoHttpError('REQUEST_INVALID');
    }
    const body = raw as Record<string, unknown>;
    if (Object.keys(body).some((k) => !BODY_FIELDS.has(k))) {
      throw new PyoHttpError('REQUEST_INVALID');
    }
    const kind = body['kind'];
    if (typeof kind !== 'string' || !(RAIL_KINDS as readonly string[]).includes(kind)) {
      throw new PyoHttpError('REQUEST_INVALID');
    }
    const railKind = kind as RailKind;
    const institution = text(body, 'institution', 32).toUpperCase();
    const number = text(body, 'accountNumber', 64).replace(/[\s-]/g, '').toUpperCase();
    const given = text(body, 'holderGivenNames', 100);
    const surnames = text(body, 'holderSurnames', 100);
    const taxId = normalizeTaxId(text(body, 'holderTaxId', 64));
    if (!INSTITUTION.test(institution) || !ACCOUNT.test(number)) {
      throw new PyoHttpError('PAYOUT_ACCOUNT_INVALID');
    }
    // une pièce mal formée ne peut pas être celle de l'hôte
    if (!TAX_ID.test(taxId)) throw new PyoHttpError('PAYOUT_HOLDER_MISMATCH');

    // la base juge le titulaire, le KYC, le profil fiscal et le nom AVANT tout appel au coffre
    const ctx = await this.#deps.store
      .context(tokenHash, orgId, given, surnames)
      .catch(storeFailure);
    if (ctx.outcome !== 'OK') throw new PyoHttpError(REFUSALS[ctx.outcome]);
    const rail = ctx.rails.find((r) => r.kind === railKind);
    if (rail === undefined) throw new PyoHttpError('PAYOUT_RAIL_UNSUPPORTED');
    if (rail.institutions !== null && !rail.institutions.includes(institution)) {
      throw new PyoHttpError('PAYOUT_RAIL_UNSUPPORTED');
    }
    if (
      (rail.institutionPattern !== null && !matches(rail.institutionPattern, institution)) ||
      !matches(rail.accountPattern, number)
    ) {
      throw new PyoHttpError('PAYOUT_ACCOUNT_INVALID');
    }
    const vault = this.#deps.vault;
    if (vault === null) throw new PyoHttpError('PAYOUT_VAULT_UNAVAILABLE');
    const same = await vault.matchesTaxId(orgId, ctx.taxIdEnvelope, taxId);
    if (same === 'UNAVAILABLE') throw new PyoHttpError('PAYOUT_VAULT_UNAVAILABLE');
    if (same !== 'MATCH') throw new PyoHttpError('PAYOUT_HOLDER_MISMATCH');
    const sealed = await vault.sealAccountNumber(orgId, number);
    if (sealed.status !== 'OK') throw new PyoHttpError('PAYOUT_VAULT_UNAVAILABLE');

    const reg = await this.#deps.store
      .register(tokenHash, orgId, {
        kind: railKind,
        institution,
        envelope: sealed.envelope,
        last4: number.slice(-4),
        holderGivenNames: given,
        holderSurnames: surnames,
      })
      .catch(storeFailure);
    if (reg.outcome !== 'REGISTERED') throw new PyoHttpError(REFUSALS[reg.outcome]);

    const verifier = this.#deps.verifier;
    if (verifier !== null) {
      const v = await verifier
        .verify({
          idempotencyKey: `payout-account:${reg.accountId}`,
          hostReference: orgId,
          country: ctx.country,
          currency: ctx.currency,
          kind: railKind,
          institution,
          accountNumber: number,
          holderGivenNames: given,
          holderSurnames: surnames,
          holderTaxIdKind: ctx.taxKind,
          holderTaxId: taxId,
        })
        .catch(() => ({ status: 'UNAVAILABLE' }) as const);
      if (v.status === 'UNAVAILABLE') {
        // le compte reste en vérification ; aucun versement ne part (garde de la base)
        this.#deps.log.warn('vérification du compte de versement indisponible', {
          status: v.status,
        });
      } else {
        const recorded = await this.#deps.store
          .recordVerification(
            tokenHash,
            orgId,
            reg.accountId,
            v.status === 'VERIFIED'
              ? { status: 'VERIFIED', providerReference: v.providerReference }
              : { status: 'REJECTED', reason: v.reason },
          )
          .catch(storeFailure);
        if (recorded !== 'APPLIED' && recorded !== 'DUPLICATE') {
          this.#deps.log.warn('vérification du compte de versement non consignée', {
            outcome: recorded,
          });
        }
        if (v.status === 'REJECTED') {
          throw new PyoHttpError(
            v.reason === 'ACCOUNT_INVALID' ? 'PAYOUT_ACCOUNT_INVALID' : 'PAYOUT_HOLDER_MISMATCH',
          );
        }
      }
    }
    return this.#view(await this.#snapshot(tokenHash, orgId), 'PAYOUT_ACCOUNT_SAVED');
  }
}
