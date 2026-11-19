/**
 * FAKE du magasin du compte de versement (US-707) — TESTS SEULEMENT (contrat HTTP sans base).
 * Reprend, en mémoire et en simplifié, les règles de la migration 0159 : titulaire de la session
 * (un co-hôte ou un autre hôte ⇒ FORBIDDEN), permission, KYC, profil fiscal, nom du titulaire
 * (casse et accents ignorés), rail et établissement du pays, compte courant unique, retenue de
 * `holdHours` après un changement d'un hôte qui a déjà eu un compte vérifié. Les règles
 * elles-mêmes sont prouvées sur PostgreSQL (packages/db/test/l0/l0-us707-payout-account.test.ts).
 */
import { PayoutAccountStoreError, railsOf } from '../internal/payout-account-store.js';
import type {
  AccountStatus,
  AccountToRegister,
  ContextResult,
  PayoutAccountStore,
  PayoutRail,
  RecordOutcome,
  RegisterResult,
  StateResult,
  VerificationToRecord,
} from '../internal/payout-account-store.js';

interface Row {
  readonly id: string;
  status: AccountStatus | 'REPLACED';
  readonly kind: AccountToRegister['kind'];
  readonly institution: string;
  readonly envelope: Buffer;
  readonly last4: string;
  readonly holder: string;
  verified: boolean;
  readonly holdUntil: Date | null;
  rejectReason: string | null;
}

interface Host {
  readonly owner: string;
  readonly country: string;
  readonly currency: string;
  readonly rails: readonly PayoutRail[];
  readonly legal: { readonly given: string; readonly surnames: string };
  kycApproved: boolean;
  permission: boolean;
  tax: { readonly kind: string; readonly envelope: Buffer } | null;
  readonly rows: Row[];
}

const words = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .join(' ');

export class FakePayoutAccountStore implements PayoutAccountStore {
  failing = false;
  holdHours = 48;
  readonly #hosts = new Map<string, Host>();
  #seq = 0;

  addHost(
    /** Empreinte hexadécimale du jeton de session du titulaire (`app.hash(acteur)`). */
    ownerHash: string,
    orgId: string,
    options: {
      country: string;
      currency: string;
      rails: unknown;
      legal?: { given: string; surnames: string };
      kycApproved?: boolean;
      tax?: { kind: string; envelope: Buffer } | null;
    },
  ): void {
    this.#hosts.set(orgId, {
      owner: ownerHash,
      country: options.country,
      currency: options.currency,
      rails: railsOf(options.rails),
      legal: options.legal ?? { given: 'Ana María', surnames: 'Pérez Gómez' },
      kycApproved: options.kycApproved ?? true,
      permission: true,
      tax: options.tax ?? null,
      rows: [],
    });
  }

  host(orgId: string): Host | undefined {
    return this.#hosts.get(orgId);
  }

  #fail(): void {
    if (this.failing) throw new PayoutAccountStoreError('indisponible (FAKE)', undefined);
  }

  #titular(
    tokenHash: Buffer,
    orgId: string,
  ): Host | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'PERMISSION_DENIED' {
    if (tokenHash.length === 0) return 'AUTH_REQUIRED';
    const h = this.#hosts.get(orgId);
    if (h === undefined || h.owner !== tokenHash.toString('hex')) return 'FORBIDDEN';
    if (!h.permission) return 'PERMISSION_DENIED';
    return h;
  }

  #current(h: Host): Row | undefined {
    return h.rows.find((r) => r.status === 'PENDING' || r.status === 'VERIFIED');
  }

  state(tokenHash: Buffer, orgId: string): Promise<StateResult> {
    return Promise.resolve().then(() => {
      this.#fail();
      const h = this.#titular(tokenHash, orgId);
      if (typeof h === 'string') return { outcome: h };
      const shown = this.#current(h) ?? [...h.rows].reverse().find((r) => r.status === 'REJECTED');
      return {
        outcome: 'OK',
        state: {
          country: h.country,
          currency: h.currency,
          rails: h.rails,
          taxKind: h.tax?.kind ?? null,
          account:
            shown === undefined
              ? null
              : {
                  id: shown.id,
                  status: shown.status as AccountStatus,
                  kind: shown.kind,
                  institution: shown.institution,
                  last4: shown.last4,
                  holdUntil: shown.holdUntil,
                  rejectReason: shown.rejectReason,
                },
        },
      };
    });
  }

  context(
    tokenHash: Buffer,
    orgId: string,
    holderGivenNames: string,
    holderSurnames: string,
  ): Promise<ContextResult> {
    return Promise.resolve().then(() => {
      this.#fail();
      const h = this.#titular(tokenHash, orgId);
      if (typeof h === 'string') return { outcome: h };
      if (h.rails.length === 0) return { outcome: 'HOST_PAYOUT_RAIL_UNAVAILABLE' };
      if (!h.kycApproved) return { outcome: 'HOST_KYC_REQUIRED' };
      if (h.tax === null) return { outcome: 'HOST_TAX_ID_REQUIRED' };
      if (
        words(`${holderGivenNames} ${holderSurnames}`) !==
        words(`${h.legal.given} ${h.legal.surnames}`)
      ) {
        return { outcome: 'PAYOUT_HOLDER_MISMATCH' };
      }
      return {
        outcome: 'OK',
        country: h.country,
        currency: h.currency,
        rails: h.rails,
        taxKind: h.tax.kind,
        taxIdEnvelope: h.tax.envelope,
      };
    });
  }

  async register(
    tokenHash: Buffer,
    orgId: string,
    account: AccountToRegister,
  ): Promise<RegisterResult> {
    const ctx = await this.context(
      tokenHash,
      orgId,
      account.holderGivenNames,
      account.holderSurnames,
    );
    if (ctx.outcome !== 'OK') return { outcome: ctx.outcome };
    const h = this.#hosts.get(orgId) as Host;
    const rail = h.rails.find((r) => r.kind === account.kind);
    if (rail === undefined) return { outcome: 'PAYOUT_RAIL_UNSUPPORTED' };
    if (rail.institutions !== null && !rail.institutions.includes(account.institution)) {
      return { outcome: 'PAYOUT_RAIL_UNSUPPORTED' };
    }
    const changed = h.rows.some((r) => r.verified);
    const holdUntil = changed ? new Date(Date.now() + this.holdHours * 3_600_000) : null;
    const prev = this.#current(h);
    if (prev !== undefined) prev.status = 'REPLACED';
    this.#seq += 1;
    const id = `0190a1b2-c3d4-7e5f-8a9b-${String(this.#seq).padStart(12, '0')}`;
    h.rows.push({
      id,
      status: 'PENDING',
      kind: account.kind,
      institution: account.institution,
      envelope: account.envelope,
      last4: account.last4,
      holder: `${account.holderGivenNames} ${account.holderSurnames}`,
      verified: false,
      holdUntil,
      rejectReason: null,
    });
    return { outcome: 'REGISTERED', accountId: id, holdUntil };
  }

  recordVerification(
    tokenHash: Buffer,
    orgId: string,
    accountId: string,
    verification: VerificationToRecord,
  ): Promise<RecordOutcome> {
    return Promise.resolve().then(() => {
      this.#fail();
      const h = this.#titular(tokenHash, orgId);
      if (typeof h === 'string') return h;
      const row = h.rows.find((r) => r.id === accountId);
      if (row === undefined) return 'FORBIDDEN';
      if (row.status !== 'PENDING')
        return row.status === verification.status ? 'DUPLICATE' : 'CONFLICT';
      if (verification.status === 'VERIFIED') {
        row.status = 'VERIFIED';
        row.verified = true;
      } else {
        row.status = 'REJECTED';
        row.rejectReason = verification.reason;
      }
      return 'APPLIED';
    });
  }

  /** Relecture du test : lignes du compte d'hôte (enveloppe comprise). */
  rowsOf(orgId: string): readonly Row[] {
    return this.#hosts.get(orgId)?.rows ?? [];
  }
}
