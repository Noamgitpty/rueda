/**
 * FAKE du port de persistance de l'OTP du téléphone — TESTS SEULEMENT (US-104).
 *
 * Jamais actif en production : ce répertoire est exclu de `tsconfig.build.json` et aucun code de
 * production ne l'importe (test `production-isolation.test.ts`). Reproduit la sémantique des
 * commandes de 0066, prouvée contre PostgreSQL par `packages/db/test/l0/l0-us104-phone-otp.test.ts`
 * (les attendus des deux viennent de 19 US-104 et de 16 VER-013, jamais l'un de l'autre). Les
 * paramètres sont ceux du pays, lus dans la configuration (CFG) comme la base les lit.
 *
 * `issueLatest` joue le travailleur `iam_otp_sender` : il dépose l'empreinte d'un code choisi par
 * le test sur le défi le plus récent de la personne.
 */
import { CountryConfigService, resolveParam } from '../../cfg/index.js';
import type {
  OtpRequestResult,
  OtpVerifyResult,
  PhoneOtpStore,
  PhoneState,
} from '../internal/phone/phone-otp-store.js';

interface FakeChallenge {
  readonly id: number;
  readonly userId: string;
  readonly phone: string;
  readonly country: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  codeHash: Buffer | null;
  attempts: number;
  lockedUntil: number | null;
  consumedAt: number | null;
}

export interface FakePhoneSession {
  readonly userId: string;
  readonly emailVerified: boolean;
}

const CONFIG = new CountryConfigService().config;

function param(key: string, country: string, at: number): number | null {
  try {
    const v = resolveParam(CONFIG, key, { country, at: new Date(at) }).value;
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export class FakePhoneOtpStore implements PhoneOtpStore {
  readonly #session: (tokenHash: Buffer) => Promise<FakePhoneSession | null>;
  readonly #now: () => number;
  readonly #challenges: FakeChallenge[] = [];
  readonly #verified = new Map<string, string>();
  #seq = 0;
  /** Paramètre forcé absent (fail-closed), pour les tests de PARAM_MISSING. */
  missingParam: string | null = null;
  /** Requêtes reçues (numéro et pays), pour vérifier qu'aucune n'est partie après un refus. */
  readonly requests: { phone: string; country: string }[] = [];

  constructor(
    session: (tokenHash: Buffer) => Promise<FakePhoneSession | null>,
    now: () => number = () => Date.now(),
  ) {
    this.#session = session;
    this.#now = now;
  }

  #param(key: string, country: string): number | null {
    return this.missingParam === key ? null : param(key, country, this.#now());
  }

  #latest(userId: string): FakeChallenge | undefined {
    return this.#challenges.filter((c) => c.userId === userId).at(-1);
  }

  /** Numéro vérifié d'une personne (lecture de test). */
  verifiedPhoneOf(userId: string): string | null {
    return this.#verified.get(userId) ?? null;
  }

  /** Défis d'une personne (lecture de test). */
  challengesOf(userId: string): readonly Readonly<FakeChallenge>[] {
    return this.#challenges.filter((c) => c.userId === userId);
  }

  /** Le travailleur dépose l'empreinte du code sur le défi le plus récent (vivant, sans code). */
  issueLatest(userId: string, codeHash: Buffer): boolean {
    const c = this.#latest(userId);
    if (c === undefined || c.codeHash !== null || c.consumedAt !== null) return false;
    if (c.expiresAt <= this.#now()) return false;
    c.codeHash = Buffer.from(codeHash);
    return true;
  }

  /** Pose un numéro vérifié pour une personne (autre compte du test d'unicité). */
  markVerified(userId: string, phone: string): void {
    this.#verified.set(userId, phone);
  }

  async state(tokenHash: Buffer): Promise<PhoneState | null> {
    const s = await this.#session(tokenHash);
    if (s === null) return null;
    const now = this.#now();
    const verifiedPhone = this.#verified.get(s.userId) ?? null;
    const c = this.#latest(s.userId);
    const none = {
      verifiedPhone,
      pendingPhone: null,
      resendAfterS: null,
      expiresInS: null,
      lockedForS: null,
      attemptsLeft: null,
    };
    if (c?.lockedUntil !== null && c?.lockedUntil !== undefined && c.lockedUntil > now) {
      return { ...none, lockedForS: Math.ceil((c.lockedUntil - now) / 1000), attemptsLeft: 0 };
    }
    if (c === undefined || c.consumedAt !== null || c.expiresAt <= now) return none;
    const wait = this.#param('otp_sms_fallback_s', c.country);
    const max = this.#param('otp_max_attempts', c.country);
    return {
      verifiedPhone,
      pendingPhone: c.phone,
      resendAfterS:
        wait === null ? null : Math.max(0, Math.ceil((c.createdAt + wait * 1000 - now) / 1000)),
      expiresInS: Math.ceil((c.expiresAt - now) / 1000),
      lockedForS: null,
      attemptsLeft: max === null ? null : Math.max(0, max - c.attempts),
    };
  }

  async request(tokenHash: Buffer, phone: string, country: string): Promise<OtpRequestResult> {
    const result = (
      outcome: OtpRequestResult['outcome'],
      rest: Partial<OtpRequestResult> = {},
    ): OtpRequestResult => ({
      outcome,
      resendAfterS: null,
      expiresInS: null,
      lockedForS: null,
      ...rest,
    });
    const s = await this.#session(tokenHash);
    if (s === null) return result('AUTH_REQUIRED');
    if (!/^\+[1-9][0-9]{6,14}$/.test(phone)) return result('REQUEST_INVALID');
    if (!CONFIG.countries.has(country)) return result('COUNTRY_UNKNOWN');
    if (!s.emailVerified) return result('NOT_ELIGIBLE');
    if (this.#verified.get(s.userId) === phone) return result('ALREADY_VERIFIED');
    const ttl = this.#param('otp_ttl_min', country);
    const max = this.#param('otp_max_attempts', country);
    const lock = this.#param('otp_lock_min', country);
    const wait = this.#param('otp_sms_fallback_s', country);
    if (ttl === null || max === null || lock === null || wait === null) {
      return result('PARAM_MISSING');
    }
    const now = this.#now();
    const last = this.#latest(s.userId);
    if (last?.lockedUntil !== null && last?.lockedUntil !== undefined && last.lockedUntil > now) {
      return result('LOCKED', { lockedForS: Math.ceil((last.lockedUntil - now) / 1000) });
    }
    if (
      last !== undefined &&
      last.consumedAt === null &&
      last.expiresAt > now &&
      last.phone === phone &&
      last.createdAt + wait * 1000 > now
    ) {
      return result('RESEND_WAIT', {
        resendAfterS: Math.ceil((last.createdAt + wait * 1000 - now) / 1000),
        expiresInS: Math.ceil((last.expiresAt - now) / 1000),
      });
    }
    const carried =
      last !== undefined &&
      last.consumedAt === null &&
      last.lockedUntil === null &&
      last.createdAt > now - lock * 60_000
        ? Math.min(last.attempts, Math.max(max - 1, 0))
        : 0;
    this.#challenges.push({
      id: ++this.#seq,
      userId: s.userId,
      phone,
      country,
      createdAt: now,
      expiresAt: now + ttl * 60_000,
      codeHash: null,
      attempts: carried,
      lockedUntil: null,
      consumedAt: null,
    });
    this.requests.push({ phone, country });
    return result('SENT', { resendAfterS: wait, expiresInS: ttl * 60 });
  }

  async verify(tokenHash: Buffer, codeHashes: readonly Buffer[]): Promise<OtpVerifyResult> {
    const result = (
      outcome: OtpVerifyResult['outcome'],
      rest: Partial<OtpVerifyResult> = {},
    ): OtpVerifyResult => ({ outcome, attemptsLeft: null, lockedForS: null, ...rest });
    const s = await this.#session(tokenHash);
    if (s === null) return result('AUTH_REQUIRED');
    const now = this.#now();
    const c = this.#latest(s.userId);
    if (c === undefined || (c.consumedAt !== null && c.lockedUntil === null)) {
      return result('OTP_EXPIRED');
    }
    if (c.lockedUntil !== null && c.lockedUntil > now) {
      return result('OTP_LOCKED', {
        attemptsLeft: 0,
        lockedForS: Math.ceil((c.lockedUntil - now) / 1000),
      });
    }
    if (c.consumedAt !== null || c.lockedUntil !== null || c.expiresAt <= now) {
      return result('OTP_EXPIRED');
    }
    const max = this.#param('otp_max_attempts', c.country);
    const lock = this.#param('otp_lock_min', c.country);
    if (max === null || lock === null) return result('PARAM_MISSING');
    const match = c.codeHash !== null && codeHashes.some((h) => h.equals(c.codeHash as Buffer));
    if (!match) {
      c.attempts += 1;
      if (c.attempts >= max) {
        c.lockedUntil = now + lock * 60_000;
        return result('OTP_LOCKED', { attemptsLeft: 0, lockedForS: lock * 60 });
      }
      return result('OTP_INVALID', { attemptsLeft: max - c.attempts });
    }
    c.consumedAt = now;
    for (const [user, phone] of this.#verified) {
      if (user !== s.userId && phone === c.phone) return result('ACCOUNT_DUPLICATE_PHONE');
    }
    this.#verified.set(s.userId, c.phone);
    return result('PHONE_VERIFIED');
  }
}
