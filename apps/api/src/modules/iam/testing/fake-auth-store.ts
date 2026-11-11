/**
 * FAKE du port de persistance de l'authentification — TESTS SEULEMENT.
 *
 * Jamais actif en production : ce répertoire est exclu de `tsconfig.build.json` (il n'existe pas
 * dans `dist/`), et aucun code de production ne l'importe (test `production-isolation.test.ts`).
 *
 * Reproduit la sémantique des commandes core.iam_* (migration 0011) ; le contrat commun est
 * vérifié contre PostgreSQL par `pg-auth-store.int.test.ts` (même suite `authStoreContract`).
 */
import type {
  AccountStatus,
  ApiRevocationReason,
  AuthStore,
  Credentials,
  HolderKind,
  HostAccount,
  HostAccountOutcome,
  MfaLevel,
  OpenSessionInput,
  RegisterAccountInput,
  SessionRecord,
} from '../internal/auth-store.js';
import { randomUUID } from 'node:crypto';
import { SignupDocumentsError } from '../internal/auth-store.js';
import { CountryConfigService } from '../../cfg/index.js';

const KNOWN_COUNTRIES = new Set(new CountryConfigService().config.countries.keys());

/** Consentement enregistré par le FAKE (même sémantique que core.contract_consent, 0059). */
export interface FakeConsent {
  readonly userId: string;
  readonly kind: 'TOS_GUEST' | 'PRIVACY' | 'MARKETING';
  readonly version: number;
  readonly accepted: boolean;
}

interface FakeAccount {
  id: string;
  email: string;
  passwordHash: string;
  status: AccountStatus;
  emailVerifiedAt: Date | null;
  legalFirstName: string;
}

/** Compte d'hôte du FAKE (même sémantique que core.iam_organization + membership, 0061). */
export interface FakeHostAccount {
  readonly orgId: string;
  readonly holderUserId: string;
  readonly country: string;
  readonly status: string;
  readonly displayName: string;
}

interface FakeSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  mfaLevel: MfaLevel;
  revokedAt: Date | null;
  revokedReason: string | null;
  userAgent: string | null;
}

const ARGON2ID_PHC =
  /^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

export class FakeAuthStore implements AuthStore {
  readonly accounts = new Map<string, FakeAccount>();
  readonly sessions: FakeSession[] = [];
  readonly consents: FakeConsent[] = [];
  readonly hostOrgs: FakeHostAccount[] = [];
  /** Versions en vigueur des documents (US-102) ; `null` = aucun document (fail-closed). */
  documentVersions: Readonly<Record<'TOS_GUEST' | 'PRIVACY' | 'MARKETING', number>> | null = {
    TOS_GUEST: 1,
    PRIVACY: 1,
    MARKETING: 1,
  };
  readonly #verifications = new Map<
    string,
    { userId: string; email: string; expiresAt: Date; consumed: boolean }
  >();
  readonly #now: () => number;

  /** `now` : horloge de la « base » (millisecondes). */
  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  setStatus(userId: string, status: AccountStatus): void {
    for (const a of this.accounts.values()) if (a.id === userId) a.status = status;
  }

  async registerAccount(input: RegisterAccountInput): Promise<boolean> {
    if (!ARGON2ID_PHC.test(input.passwordHash))
      throw new Error('23514 user_account_password_hash_argon2id');
    if (input.verificationTtlS < 300 || input.verificationTtlS > 604_800) throw new Error('22023');
    // consentements contrôlés AVANT l'email (anti-énumération), comme la commande 0059
    const versions = this.documentVersions;
    if (versions === null) throw new SignupDocumentsError('UNAVAILABLE');
    // pays inconnu de la configuration : refus avant l'email (même issue libre ou pris), comme 0059
    if (input.country != null && !KNOWN_COUNTRIES.has(input.country)) {
      throw new SignupDocumentsError('COUNTRY_UNKNOWN');
    }
    // versions affichées OBLIGATOIRES (US-102, revue) : absentes ⇒ refus
    if (input.documents == null) throw new SignupDocumentsError('VERSION_CHANGED');
    for (const kind of ['TOS_GUEST', 'PRIVACY'] as const) {
      const shown = input.documents.filter((d) => d.kind === kind).map((d) => d.version);
      if (shown.length === 0 || Math.max(...shown) !== versions[kind]) {
        throw new SignupDocumentsError('VERSION_CHANGED');
      }
    }
    if (this.accounts.has(input.email)) return false;
    for (const kind of ['TOS_GUEST', 'PRIVACY'] as const) {
      this.consents.push({ userId: input.userId, kind, version: versions[kind], accepted: true });
    }
    if (input.marketingOptIn === true) {
      this.consents.push({
        userId: input.userId,
        kind: 'MARKETING',
        version: versions.MARKETING,
        accepted: true,
      });
    }
    this.accounts.set(input.email, {
      id: input.userId,
      email: input.email,
      passwordHash: input.passwordHash,
      status: 'PENDING_EMAIL',
      emailVerifiedAt: null,
      legalFirstName: input.legalFirstName,
    });
    this.#verifications.set(input.verificationTokenHash.toString('hex'), {
      userId: input.userId,
      email: input.email,
      expiresAt: new Date(this.#now() + input.verificationTtlS * 1000),
      consumed: false,
    });
    return true;
  }

  async verifyEmail(tokenHash: Buffer): Promise<boolean> {
    const v = this.#verifications.get(tokenHash.toString('hex'));
    if (!v || v.consumed || v.expiresAt.getTime() <= this.#now()) return false;
    v.consumed = true;
    const account = this.accounts.get(v.email);
    if (!account || account.id !== v.userId) return false;
    account.emailVerifiedAt = new Date(this.#now());
    if (account.status === 'PENDING_EMAIL') account.status = 'ACTIVE';
    for (const s of this.sessions) {
      if (s.userId === account.id && s.revokedAt === null) {
        s.revokedAt = new Date(this.#now());
        s.revokedReason = 'EMAIL_VERIFIED';
      }
    }
    return true;
  }

  async findCredentials(email: string): Promise<Credentials | null> {
    const a = this.accounts.get(email);
    return a ? { userId: a.id, passwordHash: a.passwordHash, status: a.status } : null;
  }

  #account(userId: string): FakeAccount | undefined {
    for (const a of this.accounts.values()) if (a.id === userId) return a;
    return undefined;
  }

  async openSession(input: OpenSessionInput): Promise<Date | null> {
    if (input.ttlS < 300 || input.ttlS > 2_592_000) throw new Error('22023');
    const a = this.#account(input.userId);
    if (!a || a.status === 'CLOSED' || a.status === 'BANNED') return null;
    const key = input.tokenHash.toString('hex');
    if (this.sessions.some((s) => s.tokenHash === key))
      throw new Error('23505 session_token_unique');
    const expiresAt = new Date(this.#now() + input.ttlS * 1000);
    this.sessions.push({
      id: input.sessionId,
      userId: input.userId,
      tokenHash: key,
      expiresAt,
      mfaLevel: input.mfaLevel,
      revokedAt: null,
      revokedReason: null,
      userAgent: input.userAgent,
    });
    return expiresAt;
  }

  #live(tokenHash: Buffer): FakeSession | undefined {
    const key = tokenHash.toString('hex');
    return this.sessions.find(
      (s) => s.tokenHash === key && s.revokedAt === null && s.expiresAt.getTime() > this.#now(),
    );
  }

  async resolveSession(tokenHash: Buffer): Promise<SessionRecord | null> {
    const s = this.#live(tokenHash);
    if (!s) return null;
    const a = this.#account(s.userId);
    if (!a || a.status === 'CLOSED' || a.status === 'BANNED') return null;
    return {
      sessionId: s.id,
      userId: s.userId,
      mfaLevel: s.mfaLevel,
      expiresAt: s.expiresAt,
      emailVerified: a.emailVerifiedAt !== null,
    };
  }

  async revokeSession(tokenHash: Buffer, reason: ApiRevocationReason): Promise<boolean> {
    const key = tokenHash.toString('hex');
    const s = this.sessions.find((x) => x.tokenHash === key && x.revokedAt === null);
    if (!s) return false;
    s.revokedAt = new Date(this.#now());
    s.revokedReason = reason;
    return true;
  }

  /**
   * Ouverture du compte d'hôte, mêmes règles que core.iam_cmd_open_host_account (0061) : personne
   * physique, pays configuré, compte ACTIVE, un compte par personne et par pays ; nom affiché = le
   * prénom légal. L'âge n'est pas modélisé (aucune date de naissance avant le KYC).
   */
  async openHostAccount(
    tokenHash: Buffer,
    country: string,
    holderKind: HolderKind,
  ): Promise<{ outcome: HostAccountOutcome; orgId: string | null }> {
    const s = this.#live(tokenHash);
    const a = s ? this.#account(s.userId) : undefined;
    if (!s || !a || a.status === 'CLOSED' || a.status === 'BANNED') {
      return { outcome: 'AUTH_REQUIRED', orgId: null };
    }
    if (holderKind !== 'INDIVIDUAL') return { outcome: 'HOST_ENTITY_NOT_ALLOWED', orgId: null };
    if (!KNOWN_COUNTRIES.has(country)) return { outcome: 'COUNTRY_UNKNOWN', orgId: null };
    if (a.status !== 'ACTIVE') return { outcome: 'HOST_ACCOUNT_NOT_ELIGIBLE', orgId: null };
    if (this.hostOrgs.some((o) => o.holderUserId === a.id && o.country === country)) {
      return { outcome: 'HOST_ACCOUNT_EXISTS', orgId: null };
    }
    const orgId = randomUUID();
    this.hostOrgs.push({
      orgId,
      holderUserId: a.id,
      country,
      status: 'ONBOARDING',
      displayName: a.legalFirstName.trim(),
    });
    return { outcome: 'DONE', orgId };
  }

  async hostAccounts(tokenHash: Buffer): Promise<HostAccount[]> {
    const s = this.#live(tokenHash);
    const a = s ? this.#account(s.userId) : undefined;
    if (!s || !a || a.status === 'CLOSED' || a.status === 'BANNED') return [];
    return this.hostOrgs
      .filter((o) => o.holderUserId === a.id)
      .sort((x, y) => (x.country === y.country ? 0 : x.country < y.country ? -1 : 1))
      .map((o) => ({
        orgId: o.orgId,
        country: o.country,
        role: 'P2P_HOST' as const,
        status: o.status,
        displayName: o.displayName,
      }));
  }

  async revokeAllSessions(tokenHash: Buffer): Promise<number> {
    const s = this.#live(tokenHash);
    if (!s) return 0;
    let n = 0;
    for (const x of this.sessions) {
      if (x.userId === s.userId && x.revokedAt === null) {
        x.revokedAt = new Date(this.#now());
        x.revokedReason = 'LOGOUT_ALL';
        n++;
      }
    }
    return n;
  }
}
