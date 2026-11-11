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
  MfaLevel,
  OpenSessionInput,
  RegisterAccountInput,
  SessionRecord,
} from '../internal/auth-store.js';
import { SignupDocumentsError } from '../internal/auth-store.js';

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
