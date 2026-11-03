/**
 * Anti-énumération (16 ACC-001 ; revue sécurité US-010) : « coût égal ». Une connexion fait
 * exactement UNE vérification argon2id, aux MÊMES paramètres, que l'email soit inconnu, le mot
 * de passe faux, le compte banni ou la connexion réussie ; une inscription fait exactement UN
 * hachage, que l'email soit libre ou déjà pris.
 */
import { describe, expect, it } from 'vitest';
import { FakeAuthStore } from '../testing/fake-auth-store.js';
import { FAST_HASHER } from '../testing/http-harness.js';
import { RecordingIdentityNotifier } from '../testing/recording-notifier.js';
import { AuthService } from './auth.service.js';
import { AuthHttpError } from './errors.js';
import { Argon2idPasswordHasher, parsePhc } from './password-hasher.js';
import { DEFAULT_AUTH_POLICY } from './policy.js';

class CountingHasher extends Argon2idPasswordHasher {
  hashes = 0;
  verified: string[] = [];

  override async hash(password: string): Promise<string> {
    this.hashes++;
    return FAST_HASHER.hash(password);
  }

  override async verify(encoded: string, password: string): Promise<boolean> {
    this.verified.push(encoded);
    return FAST_HASHER.verify(encoded, password);
  }
}

const CTX = { ip: '203.0.113.9', userAgent: 'vitest' };
const SIGNUP = {
  email: 'ana@example.test',
  password: 'Correct-Horse-9',
  legalFirstName: 'Ana',
  legalLastName: 'Pérez',
  locale: 'en',
  termsAccepted: true,
};

function setup() {
  const store = new FakeAuthStore();
  const hasher = new CountingHasher();
  const service = new AuthService(
    store,
    new RecordingIdentityNotifier(),
    hasher,
    DEFAULT_AUTH_POLICY,
    () => Date.now(),
  );
  return { store, hasher, service };
}

const params = (encoded: string) => {
  const p = parsePhc(encoded);
  return (
    p && { m: p.memoryKiB, t: p.passes, p: p.parallelism, salt: p.salt.length, tag: p.hash.length }
  );
};

describe('coût égal (anti-énumération)', () => {
  it('connexion : une seule vérification, aux mêmes paramètres, quel que soit le cas', async () => {
    const { store, hasher, service } = setup();
    await service.signup(SIGNUP, CTX);
    await service.signup({ ...SIGNUP, email: 'ban@example.test' }, CTX);
    store.setStatus((await store.findCredentials('ban@example.test'))?.userId as string, 'BANNED');
    const stored = (await store.findCredentials('ana@example.test'))?.passwordHash as string;

    const cases = [
      { email: 'nobody@example.test', password: 'Correct-Horse-9' }, // email inconnu
      { email: 'pas-un-email', password: 'Correct-Horse-9' }, // email mal formé
      { email: 'ana@example.test', password: 'Wrong-Pass-99' }, // mauvais mot de passe
      { email: 'ban@example.test', password: 'Correct-Horse-9' }, // compte banni
    ];
    for (const input of cases) {
      hasher.verified = [];
      await expect(service.login(input, CTX, null)).rejects.toBeInstanceOf(AuthHttpError);
      expect(hasher.verified, input.email).toHaveLength(1);
      expect(params(hasher.verified[0] as string), input.email).toEqual(params(stored));
    }
    hasher.verified = [];
    await service.login({ email: 'ana@example.test', password: 'Correct-Horse-9' }, CTX, null);
    expect(hasher.verified).toEqual([stored]);
  });

  it('la vérification factice est toujours la même et n’accepte aucun mot de passe', async () => {
    const { hasher, service } = setup();
    await service.signup(SIGNUP, CTX);
    hasher.verified = [];
    for (const email of ['x@example.test', 'y@example.test']) {
      await service.login({ email, password: 'Correct-Horse-9' }, CTX, null).catch(() => undefined);
    }
    expect(hasher.verified).toHaveLength(2);
    expect(hasher.verified[0]).toBe(hasher.verified[1]);
    expect(await FAST_HASHER.verify(hasher.verified[0] as string, 'Correct-Horse-9')).toBe(false);
  });

  it('inscription : un seul hachage, email libre ou déjà pris', async () => {
    const { hasher, service } = setup();
    await service.signup(SIGNUP, CTX);
    expect(hasher.hashes).toBe(1);
    await service.signup(SIGNUP, CTX);
    expect(hasher.hashes).toBe(2);
  });
});
