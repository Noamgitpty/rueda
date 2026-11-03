/**
 * Critère 1 de US-010 (« seul un hachage robuste est stocké ») côté API : argon2id (17 §3.1.4,
 * §6.6). Oracle de la primitive : vecteur de test de RFC 9106 §5.3 (Argon2id), pas le code testé.
 */
import { describe, expect, it } from 'vitest';
import {
  Argon2idPasswordHasher,
  deriveArgon2id,
  normalizePassword,
  parsePhc,
} from './password-hasher.js';

// Paramètres réduits pour la vitesse des tests (la chaîne PHC porte ses paramètres).
const FAST = { memoryKiB: 1024, passes: 1, parallelism: 1, saltLength: 16, tagLength: 32 };

describe('argon2id', () => {
  it('RFC 9106 §5.3 : vecteur de test Argon2id (m = 32 KiB, t = 3, p = 4, secret et données associées)', async () => {
    const tag = await deriveArgon2id({
      message: Buffer.alloc(32, 0x01),
      nonce: Buffer.alloc(16, 0x02),
      secret: Buffer.alloc(8, 0x03),
      associatedData: Buffer.alloc(12, 0x04),
      memoryKiB: 32,
      passes: 3,
      parallelism: 4,
      tagLength: 32,
    });
    expect(tag.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });

  it('paramètres par défaut : m = 64 MiB, t = 3, p = 1, sel 16 octets, empreinte 32 octets (ADR-052)', async () => {
    const encoded = await new Argon2idPasswordHasher().hash('Correct-Horse-9');
    expect(encoded).toMatch(
      /^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
  });

  it('le hachage stocké ne contient jamais le mot de passe et change à chaque appel (sel aléatoire)', async () => {
    const hasher = new Argon2idPasswordHasher(FAST);
    const password = 'Correct-Horse-9';
    const a = await hasher.hash(password);
    const b = await hasher.hash(password);
    expect(a).not.toBe(b);
    for (const h of [a, b]) {
      expect(h).not.toContain(password);
      expect(h).not.toContain(Buffer.from(password).toString('base64').replace(/=+$/, ''));
    }
    expect(await hasher.verify(a, password)).toBe(true);
    expect(await hasher.verify(b, password)).toBe(true);
    expect(await hasher.verify(a, 'correct-horse-9')).toBe(false);
    expect(await hasher.verify(a, '')).toBe(false);
  });

  it('chaîne mal formée, autre algorithme ou paramètres hors bornes : refus sans calcul démesuré', async () => {
    const hasher = new Argon2idPasswordHasher(FAST);
    const good = await hasher.hash('Correct-Horse-9');
    const salt = good.split('$')[4] as string;
    const tag = good.split('$')[5] as string;
    for (const bad of [
      'Correct-Horse-9',
      '',
      good.replace('$argon2id$', '$argon2i$'),
      good.replace('v=19', 'v=16'),
      `$argon2id$v=19$m=4194304,t=3,p=1$${salt}$${tag}`, // 4 GiB
      `$argon2id$v=19$m=65536,t=1000,p=1$${salt}$${tag}`,
      `$argon2id$v=19$m=65536,t=3,p=64$${salt}$${tag}`,
      `$argon2id$v=19$m=65536,t=3,p=1$AAAA$${tag}`, // sel de 3 octets
    ]) {
      expect(parsePhc(bad), bad).toBeNull();
      expect(await hasher.verify(bad, 'Correct-Horse-9'), bad).toBe(false);
    }
  });

  it('normalisation NFKC : deux saisies Unicode équivalentes donnent le même mot de passe', async () => {
    const hasher = new Argon2idPasswordHasher(FAST);
    const composed = 'Contraseña-segura';
    const decomposed = 'Contraseña-segura';
    expect(normalizePassword(decomposed)).toBe(composed);
    expect(await hasher.verify(await hasher.hash(composed), decomposed)).toBe(true);
  });
});
