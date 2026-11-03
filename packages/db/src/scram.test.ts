import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { randomPassword, scramSha256Verifier } from './scram.ts';

// Vecteur de RFC 7677 §3 (utilisateur « user », mot de passe « pencil »).
const SALT = 'W22ZaJ0SNY7soEsUEjb6gQ==';
const AUTH_MESSAGE =
  'n=user,r=rOprNGfwEbeRWgbNEkqO,' +
  'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,' +
  'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
const CLIENT_PROOF = 'dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=';
const SERVER_SIGNATURE = '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=';

describe('scramSha256Verifier', () => {
  const verifier = scramSha256Verifier('pencil', {
    salt: Buffer.from(SALT, 'base64'),
    iterations: 4096,
  });
  const [, rest = ''] = verifier.split('SCRAM-SHA-256$');
  const [iterSalt = '', keys = ''] = rest.split('$');
  const [storedKeyB64 = '', serverKeyB64 = ''] = keys.split(':');

  it('a le format stocké par PostgreSQL', () => {
    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    );
    expect(iterSalt).toBe(`4096:${SALT}`);
  });

  it('valide la preuve client du vecteur RFC 7677 (H(preuve ⊕ signature) = StoredKey)', () => {
    const storedKey = Buffer.from(storedKeyB64, 'base64');
    const clientSignature = createHmac('sha256', storedKey).update(AUTH_MESSAGE).digest();
    const proof = Buffer.from(CLIENT_PROOF, 'base64');
    const clientKey = Buffer.from(proof.map((b, i) => b ^ (clientSignature[i] as number)));
    expect(createHash('sha256').update(clientKey).digest().toString('base64')).toBe(storedKeyB64);
  });

  it('produit la signature serveur du vecteur RFC 7677', () => {
    const serverKey = Buffer.from(serverKeyB64, 'base64');
    expect(createHmac('sha256', serverKey).update(AUTH_MESSAGE).digest().toString('base64')).toBe(
      SERVER_SIGNATURE,
    );
  });

  it('refuse un mot de passe non ASCII imprimable', () => {
    expect(() => scramSha256Verifier('a b')).toThrow();
    expect(() => scramSha256Verifier('')).toThrow();
  });

  it('randomPassword : 64 caractères hexadécimaux, différents à chaque appel', () => {
    const a = randomPassword();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(randomPassword()).not.toBe(a);
  });
});
