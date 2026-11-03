/**
 * Authentification forte du staff et commandes IAM de la console (US-012 ; 16 ADM-001 ; ADR-062).
 *
 * - La base décide de tout ce qu'elle peut juger (session, rôles en cours, portée pays, matrice,
 *   verrou, anti-rejeu, fenêtre de pas à son horloge) et journalise chaque refus ;
 * - l'API fait ce que la base ne peut pas faire : lire le secret TOTP dans le coffre, vérifier le
 *   code, et signer la preuve HMAC qui seule permet l'élévation de la session ;
 * - aucun secret, code, jeton, empreinte ni preuve dans un journal ou une erreur.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { isWellFormedToken, tokenHash } from '../session-token.js';
import { AuthHttpError } from '../errors.js';
import { systemClock } from '../tokens.js';
import type { Clock } from '../tokens.js';
import { uuidV7 } from '../uuid-v7.js';
import { mfaProof } from './mfa-proof.js';
import type { TotpSecretVault } from './secret-vault.js';
import type { AuditEntry, StaffAccess, StaffRole, StaffStore } from './staff-store.js';
import {
  base32Encode,
  matchTotp,
  normalizeTotpCode,
  otpauthUri,
  TOTP_SECRET_BYTES,
} from './totp.js';
import { STAFF_OPTIONS } from './staff-tokens.js';

export interface StaffOptions {
  readonly store: StaffStore;
  readonly vault: TotpSecretVault;
  /** Clé de preuve (secret géré) ; `null` : aucune élévation possible (fail-closed). */
  readonly proofKey: Buffer | null;
  /** Émetteur affiché par l'application d'authentification (marque : donnée de thème). */
  readonly issuer: string;
  /** Durée de validité d'un code d'enrôlement (s) : 24 h PROPOSÉ (ADR-062), bornes 300 s à 7 j. */
  readonly enrollmentTtlS?: number;
  /** Horloge de l'API (ms) : fenêtre TOTP et identifiants seulement ; la base rejuge le pas. */
  readonly clock?: Clock;
}

/** Principal d'une requête de console : session ÉLEVÉE d'un membre du staff. */
export interface StaffPrincipal {
  readonly userId: string;
  readonly roles: readonly StaffRole[];
  /** Preuve de possession transmise aux commandes de la console ; jamais journalisée. */
  readonly tokenHash: Buffer;
}

export const DEFAULT_ENROLLMENT_TTL_S = 86_400;
const REASON_MIN = 10;
const REASON_MAX = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENROLLMENT_CODE_FORMAT = /^[A-Z2-7]{16}$/;

/** Motif saisi (10 à 1000 caractères après espaces retirés), sinon 400 REQUEST_INVALID. */
export function requireReason(value: unknown): string {
  if (typeof value !== 'string') throw new AuthHttpError('REQUEST_INVALID');
  const reason = value.normalize('NFC').trim();
  if ([...reason].length < REASON_MIN || [...reason].length > REASON_MAX) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return reason;
}

export function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value.toLowerCase())) {
    throw new AuthHttpError('REQUEST_INVALID');
  }
  return value.toLowerCase();
}

/** Code d'enrôlement : 16 caractères base32 (80 bits), remis hors bande, saisi sans espaces. */
export function normalizeEnrollmentCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  return ENROLLMENT_CODE_FORMAT.test(code) ? code : null;
}

const sha256 = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();

@Injectable()
export class StaffAuthService {
  readonly clock: Clock;

  constructor(@Inject(STAFF_OPTIONS) private readonly options: StaffOptions) {
    this.clock = options.clock ?? systemClock;
  }

  get #store(): StaffStore {
    return this.options.store;
  }

  /** État d'accès de la session à la console (`null` si le cookie n'a pas la forme d'un jeton). */
  async access(token: string | null): Promise<{ access: StaffAccess; hash: Buffer } | null> {
    if (!isWellFormedToken(token)) return null;
    const hash = tokenHash(token);
    return { access: await this.#store.begin(hash), hash };
  }

  /** Principal de console, ou l'erreur HTTP qui convient (401, 403 FORBIDDEN, 403 2FA_REQUIRED). */
  async principal(token: string | null): Promise<StaffPrincipal> {
    const r = await this.access(token);
    if (r === null || r.access.outcome === 'AUTH_REQUIRED' || r.access.userId === null) {
      throw new AuthHttpError('AUTH_REQUIRED');
    }
    switch (r.access.outcome) {
      case 'ELEVATED':
        return { userId: r.access.userId, roles: r.access.roles, tokenHash: r.hash };
      case 'NOT_STAFF':
        throw new AuthHttpError('FORBIDDEN');
      default:
        throw new AuthHttpError('2FA_REQUIRED', { step: r.access.outcome });
    }
  }

  async #secret(ref: string | null): Promise<Buffer> {
    if (ref === null) throw new AuthHttpError('STAFF_MFA_UNAVAILABLE');
    try {
      const secret = await this.options.vault.resolve(ref);
      if (secret === null) throw new AuthHttpError('STAFF_MFA_UNAVAILABLE');
      return secret;
    } catch (error) {
      if (error instanceof AuthHttpError) throw error;
      throw new AuthHttpError('STAFF_MFA_UNAVAILABLE');
    }
  }

  /**
   * Enrôlement, étape 1 : le code remis hors bande ouvre le secret du facteur en attente. Rend
   * le secret en base32 et l'URI `otpauth://` (affichés une fois, jamais journalisés).
   */
  async enroll(
    token: string | null,
    enrollmentCode: unknown,
  ): Promise<{ secret: string; otpauthUri: string }> {
    if (!isWellFormedToken(token)) throw new AuthHttpError('AUTH_REQUIRED');
    const code = normalizeEnrollmentCode(enrollmentCode);
    if (code === null) throw new AuthHttpError('REQUEST_INVALID');
    const hash = tokenHash(token);
    const r = await this.#store.enrollReveal(hash, sha256(code));
    if (r.outcome === 'AUTH_REQUIRED') throw new AuthHttpError('AUTH_REQUIRED');
    if (r.outcome === 'LOCKED') throw new AuthHttpError('AUTH_TOTP_LOCKED');
    if (r.outcome !== 'OK') throw new AuthHttpError('AUTH_TOTP_INVALID');
    const secret = await this.#secret(r.secretRef);
    return {
      secret: base32Encode(secret),
      otpauthUri: otpauthUri({ issuer: this.options.issuer, account: 'staff', secret }),
    };
  }

  /**
   * Vérification d'un code TOTP : fin d'enrôlement (avec le code d'enrôlement) ou élévation d'une
   * session. Code faux : échec compté par la base (verrou à 5), 400 AUTH_TOTP_INVALID.
   */
  async verify(
    token: string | null,
    input: { readonly code: unknown; readonly enrollmentCode?: unknown },
  ): Promise<'ELEVATED' | 'ENROLLED'> {
    if (!isWellFormedToken(token)) throw new AuthHttpError('AUTH_REQUIRED');
    const code = normalizeTotpCode(input.code);
    if (code === null) throw new AuthHttpError('REQUEST_INVALID');
    if (this.options.proofKey === null) throw new AuthHttpError('STAFF_MFA_UNAVAILABLE');
    const hash = tokenHash(token);
    const access = await this.#store.begin(hash);
    let factorId: string | null = access.factorId;
    let ref: string | null = access.secretRef;
    let lastUsedStep = access.lastUsedStep;
    switch (access.outcome) {
      case 'ELEVATED':
        return 'ELEVATED';
      case 'MFA_REQUIRED':
        break;
      case 'ENROLLMENT_REQUIRED': {
        const enrollment = normalizeEnrollmentCode(input.enrollmentCode);
        if (enrollment === null) throw new AuthHttpError('REQUEST_INVALID');
        const r = await this.#store.enrollReveal(hash, sha256(enrollment));
        if (r.outcome === 'LOCKED') throw new AuthHttpError('AUTH_TOTP_LOCKED');
        if (r.outcome !== 'OK') throw new AuthHttpError('AUTH_TOTP_INVALID');
        factorId = r.factorId;
        ref = r.secretRef;
        lastUsedStep = null;
        break;
      }
      case 'AUTH_REQUIRED':
        throw new AuthHttpError('AUTH_REQUIRED');
      case 'LOCKED':
        throw new AuthHttpError('AUTH_TOTP_LOCKED');
      case 'NOT_STAFF':
        throw new AuthHttpError('FORBIDDEN');
      default:
        throw new AuthHttpError('2FA_REQUIRED', { step: access.outcome });
    }
    if (factorId === null) throw new AuthHttpError('2FA_REQUIRED', { step: access.outcome });
    const secret = await this.#secret(ref);
    const step = matchTotp(secret, code, this.clock(), lastUsedStep);
    if (step === null) {
      const failed = await this.#store.mfaFailed(hash);
      throw new AuthHttpError(failed === 'LOCKED' ? 'AUTH_TOTP_LOCKED' : 'AUTH_TOTP_INVALID');
    }
    const outcome = await this.#store.elevate(
      hash,
      factorId,
      step,
      mfaProof(this.options.proofKey, hash, factorId, step),
    );
    switch (outcome) {
      case 'ELEVATED':
      case 'ENROLLED':
        return outcome;
      case 'AUTH_REQUIRED':
        throw new AuthHttpError('AUTH_REQUIRED');
      case 'NOT_STAFF':
        throw new AuthHttpError('FORBIDDEN');
      case 'LOCKED':
        throw new AuthHttpError('AUTH_TOTP_LOCKED');
      case 'UNAVAILABLE':
        throw new AuthHttpError('STAFF_MFA_UNAVAILABLE');
      default:
        throw new AuthHttpError('AUTH_TOTP_INVALID');
    }
  }

  /** Suspension d'un membre du staff (il perd tout). */
  async suspend(principal: StaffPrincipal, target: unknown, reason: unknown): Promise<void> {
    const outcome = await this.#store.suspend(
      principal.tokenHash,
      uuidV7(this.clock()),
      requireUuid(target),
      requireReason(reason),
    );
    this.#commandOutcome(outcome);
  }

  /**
   * Réinitialisation du TOTP d'un AUTRE membre du staff : nouveau secret au coffre, nouveau code
   * d'enrôlement rendu UNE fois à l'auteur, qui le remet hors bande (jamais stocké en clair).
   */
  async resetTotp(
    principal: StaffPrincipal,
    target: unknown,
    reason: unknown,
  ): Promise<{ enrollmentCode: string }> {
    const targetId = requireUuid(target);
    const why = requireReason(reason);
    let secretRef: string;
    try {
      secretRef = await this.options.vault.store(randomBytes(TOTP_SECRET_BYTES));
    } catch {
      throw new AuthHttpError('STAFF_MFA_UNAVAILABLE');
    }
    const enrollmentCode = base32Encode(randomBytes(10)); // 80 bits, 16 caractères
    const outcome = await this.#store.resetTotp(principal.tokenHash, {
      requestId: uuidV7(this.clock()),
      target: targetId,
      reason: why,
      factorId: uuidV7(this.clock()),
      secretRef,
      codeHash: sha256(enrollmentCode),
      ttlS: this.options.enrollmentTtlS ?? DEFAULT_ENROLLMENT_TTL_S,
    });
    this.#commandOutcome(outcome);
    return { enrollmentCode };
  }

  async audit(principal: StaffPrincipal, before: unknown, limit: unknown): Promise<AuditEntry[]> {
    const beforeId =
      typeof before === 'string' && /^[1-9][0-9]{0,18}$/.test(before) ? before : null;
    const n = typeof limit === 'string' && /^[0-9]{1,3}$/.test(limit) ? Number(limit) : 50;
    return this.#store.auditRead(principal.tokenHash, beforeId, Math.min(Math.max(n, 1), 200));
  }

  #commandOutcome(outcome: string): void {
    if (outcome === 'DONE') return;
    if (outcome === 'AUTH_REQUIRED') throw new AuthHttpError('AUTH_REQUIRED');
    if (outcome === 'MFA_REQUIRED') throw new AuthHttpError('2FA_REQUIRED');
    throw new AuthHttpError('FORBIDDEN');
  }
}
