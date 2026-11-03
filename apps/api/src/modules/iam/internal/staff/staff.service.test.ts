/**
 * Service de la console (US-012), sans base : la base est remplacée par un magasin qui ENREGISTRE
 * les appels et rend les issues des commandes `core.iam_staff_*` (leur logique est prouvée sur
 * PostgreSQL par packages/db/test/l0/l0-iam-staff-mfa et l0-staff-console). Ce qui est prouvé ici :
 * - un rôle sans MFA, ou sans TOTP, n'obtient jamais de principal de console (403 2FA_REQUIRED) ;
 * - un code juste => preuve HMAC recalculée indépendamment (node:crypto) pour CE jeton, CE facteur,
 *   CE pas ; un code faux => échec compté par la base, aucune élévation ;
 * - sans clé de preuve ou sans coffre : aucune élévation (fail-closed) ;
 * - réinitialisation : code d'enrôlement rendu une fois, seule son empreinte va en base.
 */
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeTotpSecretVault } from '../../testing/fake-totp-vault.js';
import { tokenHash } from '../session-token.js';
import { UnavailableTotpVault } from './secret-vault.js';
import { StaffAuthService } from './staff.service.js';
import type { StaffOptions } from './staff.service.js';
import type {
  CommandOutcome,
  ElevateOutcome,
  MfaAttempt,
  ResetTotpInput,
  StaffAccess,
  StaffStore,
} from './staff-store.js';
import { hotp, totpStep } from './totp.js';

const TOKEN = 'A'.repeat(43);
const NOW = 1_800_000_000_000;
const FACTOR = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const USER = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const KEY = createHash('sha256').update('clé de test du service').digest();
const SECRET = Buffer.from('12345678901234567890');

class RecordingStore implements StaffStore {
  calls: string[] = [];
  access: StaffAccess = {
    outcome: 'MFA_REQUIRED',
    userId: USER,
    factorId: FACTOR,
    roles: [{ role: 'OPS_AGENT', countries: ['AA'] }],
  };
  attempt: MfaAttempt = {
    outcome: 'OK',
    factorId: FACTOR,
    secretRef: 'fake-vault:s',
    lastUsedStep: null,
  };
  elevated: { hash: Buffer; factor: string; step: number; proof: Buffer } | null = null;
  reset: ResetTotpInput | null = null;

  begin() {
    this.calls.push('begin');
    return Promise.resolve(this.access);
  }
  enrollReveal(_h: Buffer, codeHash: Buffer) {
    this.calls.push('enrollReveal');
    const ok = codeHash.equals(createHash('sha256').update('ABCDEFGHIJKLMNOP').digest());
    return Promise.resolve(
      ok
        ? { outcome: 'OK' as const, factorId: FACTOR, secretRef: 'fake-vault:s' }
        : { outcome: 'REFUSED' as const, factorId: null, secretRef: null },
    );
  }
  elevate(hash: Buffer, factor: string, step: number, proof: Buffer): Promise<ElevateOutcome> {
    this.calls.push('elevate');
    this.elevated = { hash, factor, step, proof };
    return Promise.resolve(this.access.outcome === 'ENROLLMENT_REQUIRED' ? 'ENROLLED' : 'ELEVATED');
  }
  mfaAttempt() {
    this.calls.push('mfaAttempt');
    return Promise.resolve(this.attempt);
  }
  suspend(): Promise<CommandOutcome> {
    this.calls.push('suspend');
    return Promise.resolve('DONE');
  }
  resetTotp(_h: Buffer, input: ResetTotpInput): Promise<CommandOutcome> {
    this.calls.push('resetTotp');
    this.reset = input;
    return Promise.resolve('DONE');
  }
  auditRead() {
    return Promise.resolve([]);
  }
}

function service(store: RecordingStore, overrides: Partial<StaffOptions> = {}) {
  const vault = new FakeTotpSecretVault();
  vault.put('fake-vault:s', SECRET);
  return new StaffAuthService({
    store,
    vault,
    proofKey: KEY,
    issuer: 'Console',
    clock: () => NOW,
    ...overrides,
  });
}

/** Preuve attendue, recalculée ici selon ADR-062 (oracle indépendant du code testé). */
function expectedProof(step: number): Buffer {
  const s = Buffer.alloc(8);
  s.writeBigInt64BE(BigInt(step));
  return createHmac('sha256', KEY)
    .update(
      Buffer.concat([
        Buffer.from('rueda-staff-mfa-v1'),
        createHash('sha256').update(TOKEN).digest(),
        Buffer.from(FACTOR.replace(/-/g, ''), 'hex'),
        s,
      ]),
    )
    .digest();
}

describe('principal de console : TOTP obligatoire', () => {
  it.each([
    ['TOTP_NOT_ENROLLED', 403, '2FA_REQUIRED'],
    ['ENROLLMENT_REQUIRED', 403, '2FA_REQUIRED'],
    ['MFA_REQUIRED', 403, '2FA_REQUIRED'],
    ['LOCKED', 403, '2FA_REQUIRED'],
    ['NOT_STAFF', 403, 'FORBIDDEN'],
    ['AUTH_REQUIRED', 401, 'AUTH_REQUIRED'],
  ] as const)('%s => %i %s', async (outcome, status, code) => {
    const store = new RecordingStore();
    store.access = { ...store.access, outcome };
    await expect(service(store).principal(TOKEN)).rejects.toMatchObject({
      code,
      status,
    });
  });

  it('session élevée : principal avec rôles et preuve de possession ; cookie mal formé => 401 sans requête', async () => {
    const store = new RecordingStore();
    store.access = { ...store.access, outcome: 'ELEVATED' };
    const p = await service(store).principal(TOKEN);
    expect(p).toMatchObject({ userId: USER, roles: store.access.roles });
    expect(p.tokenHash.equals(tokenHash(TOKEN))).toBe(true);
    const other = new RecordingStore();
    await expect(service(other).principal('forge')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    expect(other.calls).toEqual([]);
  });
});

describe('vérification du code', () => {
  it('code juste : élévation avec la preuve HMAC de ce jeton, ce facteur, ce pas', async () => {
    const store = new RecordingStore();
    const step = totpStep(NOW);
    expect(await service(store).verify(TOKEN, { code: hotp(SECRET, step) })).toBe('ELEVATED');
    expect(store.calls).toEqual(['begin', 'mfaAttempt', 'elevate']);
    expect(store.elevated?.step).toBe(step);
    expect(store.elevated?.factor).toBe(FACTOR);
    expect(store.elevated?.proof.equals(expectedProof(step))).toBe(true);
  });

  it('la tentative est comptée par la base AVANT que le secret ne sorte ; code faux : aucun appel de plus', async () => {
    const store = new RecordingStore();
    await expect(service(store).verify(TOKEN, { code: '000000' })).rejects.toMatchObject({
      code: 'AUTH_TOTP_INVALID',
      status: 400,
    });
    expect(store.calls).toEqual(['begin', 'mfaAttempt']);
    // facteur verrouillé par la base : le secret ne sort pas, aucune élévation
    store.calls = [];
    store.attempt = { outcome: 'LOCKED', factorId: null, secretRef: null, lastUsedStep: null };
    await expect(
      service(store).verify(TOKEN, { code: hotp(SECRET, totpStep(NOW)) }),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_LOCKED', status: 429 });
    expect(store.calls).toEqual(['begin', 'mfaAttempt']);
  });

  it('limiteur /staff/* : tentatives MFA par compte et par IP, toute requête par IP (429)', async () => {
    const limits = {
      requestsPerIp: 3,
      requestWindowMs: 60_000,
      mfaPerIp: 100,
      mfaPerAccount: 2,
      mfaWindowMs: 60_000,
    };
    const store = new RecordingStore();
    const s = service(store, { limits });
    for (let i = 0; i < 2; i += 1) {
      await expect(s.verify(TOKEN, { code: '000000' }, '203.0.113.9')).rejects.toMatchObject({
        code: 'AUTH_TOTP_INVALID',
      });
    }
    await expect(s.verify(TOKEN, { code: '000000' }, '198.51.100.1')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
    const byIp = service(new RecordingStore(), { limits: { ...limits, mfaPerIp: 1 } });
    await expect(byIp.verify(TOKEN, { code: '000000' }, '203.0.113.9')).rejects.toMatchObject({
      code: 'AUTH_TOTP_INVALID',
    });
    const other = 'C'.repeat(43);
    await expect(byIp.verify(other, { code: '000000' }, '203.0.113.9')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    for (let i = 0; i < 3; i += 1) s.throttle('192.0.2.7');
    expect(() => s.throttle('192.0.2.7')).toThrow(
      expect.objectContaining({ code: 'RATE_LIMITED' }),
    );
    expect(() => s.throttle('192.0.2.8')).not.toThrow();
  });

  it('pas déjà consommé : jamais présenté à la base (anti-rejeu), compté comme un échec', async () => {
    const store = new RecordingStore();
    const step = totpStep(NOW);
    store.attempt = { ...store.attempt, lastUsedStep: step };
    await expect(service(store).verify(TOKEN, { code: hotp(SECRET, step) })).rejects.toMatchObject({
      code: 'AUTH_TOTP_INVALID',
    });
    expect(store.calls).not.toContain('elevate');
  });

  it('enrôlement : code d’enrôlement exigé, puis ENROLLED', async () => {
    const store = new RecordingStore();
    store.access = { ...store.access, outcome: 'ENROLLMENT_REQUIRED' };
    const code = hotp(SECRET, totpStep(NOW));
    await expect(service(store).verify(TOKEN, { code })).rejects.toMatchObject({
      code: 'REQUEST_INVALID',
    });
    await expect(
      service(store).verify(TOKEN, { code, enrollmentCode: 'ZZZZZZZZZZZZZZZZ' }),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_INVALID' });
    expect(
      await service(store).verify(TOKEN, { code, enrollmentCode: 'abcd efgh ijkl mnop' }),
    ).toBe('ENROLLED');
    const enrolled = await service(store).enroll(TOKEN, 'ABCD-EFGH-IJKL-MNOP');
    expect(enrolled.secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('fail-closed : sans clé de preuve ou sans coffre, aucune élévation (503)', async () => {
    const code = hotp(SECRET, totpStep(NOW));
    const a = new RecordingStore();
    await expect(service(a, { proofKey: null }).verify(TOKEN, { code })).rejects.toMatchObject({
      code: 'STAFF_MFA_UNAVAILABLE',
      status: 503,
    });
    expect(a.calls).toEqual([]);
    const b = new RecordingStore();
    await expect(
      service(b, { vault: new UnavailableTotpVault() }).verify(TOKEN, { code }),
    ).rejects.toMatchObject({ code: 'STAFF_MFA_UNAVAILABLE' });
    expect(b.calls).not.toContain('elevate');
  });
});

describe('commandes IAM de la console', () => {
  const principal = { userId: USER, roles: [], tokenHash: tokenHash(TOKEN) };

  it('réinitialisation : code d’enrôlement rendu une fois ; en base, son empreinte seulement', async () => {
    const store = new RecordingStore();
    const { enrollmentCode } = await service(store).resetTotp(
      principal,
      FACTOR,
      'Téléphone perdu, vérifié par appel',
    );
    expect(enrollmentCode).toMatch(/^[A-Z2-7]{16}$/);
    expect(store.reset?.codeHash.equals(createHash('sha256').update(enrollmentCode).digest())).toBe(
      true,
    );
    expect(JSON.stringify(store.reset)).not.toContain(enrollmentCode);
    expect(store.reset?.secretRef).toMatch(/^fake-vault:/);
    expect(store.reset?.ttlS).toBe(86_400);
  });

  it('motif obligatoire (10 à 1000 caractères) et cible UUID, sinon 400 sans appel', async () => {
    const store = new RecordingStore();
    for (const [target, reason] of [
      [FACTOR, 'court'],
      ['pas-un-uuid', 'Motif suffisamment long'],
      [FACTOR, 'x'.repeat(1001)],
    ] as const) {
      await expect(service(store).suspend(principal, target, reason)).rejects.toMatchObject({
        code: 'REQUEST_INVALID',
      });
    }
    expect(store.calls).toEqual([]);
  });
});
