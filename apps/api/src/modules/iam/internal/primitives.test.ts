/**
 * Jetons, cookie de session, UUID v7, limiteur (US-010). Oracles : FIPS 180-4 (SHA-256 de
 * « abc »), RFC 6265bis (préfixe __Host-), 17 §6.6 (HttpOnly, Secure, SameSite=Lax), RFC 9562.
 */
import { describe, expect, it } from 'vitest';
import {
  clearedSessionCookie,
  readSessionToken,
  SESSION_COOKIE,
  sessionCookie,
} from './cookies.js';
import { isWellFormedToken, newOpaqueToken, tokenHash } from './session-token.js';
import { FixedWindowLimiter } from './throttle.js';
import { uuidV7 } from './uuid-v7.js';

describe('jetons opaques', () => {
  it('32 octets aléatoires en base64url (43 caractères), tous distincts', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => newOpaqueToken()));
    expect(tokens.size).toBe(1000);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    }
  });

  it('empreinte = SHA-256 du texte (FIPS 180-4 : « abc »)', () => {
    expect(tokenHash('abc').toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(tokenHash(newOpaqueToken())).toHaveLength(32);
  });

  it('forme : tout autre texte est traité comme absent', () => {
    for (const bad of [
      null,
      undefined,
      '',
      'abc',
      `${newOpaqueToken()}x`,
      'a'.repeat(42) + '=',
      ' '.repeat(43),
    ]) {
      expect(isWellFormedToken(bad as string | null | undefined)).toBe(false);
    }
  });
});

describe('cookie de session', () => {
  it('__Host-, HttpOnly, Secure, SameSite=Lax, Path=/, sans Domain, Max-Age entier', () => {
    const token = newOpaqueToken();
    const header = sessionCookie(token, 1_209_599.7);
    expect(SESSION_COOKIE).toBe('__Host-session');
    expect(header.startsWith(`__Host-session=${token}; `)).toBe(true);
    const attrs = header.split('; ').slice(1);
    expect(attrs).toEqual(
      expect.arrayContaining(['Max-Age=1209599', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']),
    );
    expect(header).not.toMatch(/domain=/i);
    expect(header).not.toMatch(/expires=/i);
    expect(sessionCookie(token, -5)).toContain('Max-Age=0;');
    expect(() => sessionCookie('pas un jeton', 60)).toThrow();
  });

  it('effacement : valeur vide, Max-Age=0, mêmes attributs', () => {
    expect(clearedSessionCookie()).toBe(
      '__Host-session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
  });

  it('lecture : un seul cookie bien formé ; absent, doublé ou mal formé => null', () => {
    const t = newOpaqueToken();
    expect(readSessionToken(`theme=dark; __Host-session=${t}; locale=fr`)).toBe(t);
    expect(readSessionToken([`a=1`, `__Host-session=${t}`])).toBe(t);
    expect(readSessionToken(undefined)).toBeNull();
    expect(readSessionToken('session=' + t)).toBeNull(); // sans le préfixe : ignoré
    expect(readSessionToken(`__Host-session=${t}; __Host-session=${newOpaqueToken()}`)).toBeNull();
    expect(readSessionToken('__Host-session=attaquant')).toBeNull();
  });
});

describe('UUID v7', () => {
  it('RFC 9562 : horodatage en tête, version 7, variante 10, ordonnable', () => {
    const ms = 0x017f22e279b0; // exemple de RFC 9562 annexe A.6
    const id = uuidV7(ms, Buffer.alloc(10, 0xff));
    expect(id).toMatch(/^017f22e2-79b0-7fff-bfff-ffffffffffff$/);
    const a = uuidV7(1_000);
    const b = uuidV7(2_000);
    expect(a < b).toBe(true);
    expect(uuidV7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(() => uuidV7(-1)).toThrow();
  });
});

describe('limiteur à fenêtre fixe', () => {
  it('bloque au-delà de la limite, se libère à la fin de la fenêtre, reset efface', () => {
    let now = 0;
    const l = new FixedWindowLimiter(3, 1000, () => now);
    const k = FixedWindowLimiter.key('login', 'ana@example.test');
    expect(k).not.toContain('ana');
    expect([l.hit(k), l.hit(k), l.hit(k)]).toEqual([true, true, true]);
    expect(l.isBlocked(k)).toBe(true);
    expect(l.hit(k)).toBe(false);
    now = 1000;
    expect(l.isBlocked(k)).toBe(false);
    l.hit(k);
    l.reset(k);
    expect(l.isBlocked(k)).toBe(false);
  });

  it('mémoire bornée : au-delà de maxKeys, les plus anciennes clés sont retirées', () => {
    const l = new FixedWindowLimiter(1, 60_000, () => 0, 10);
    for (let i = 0; i < 50; i++) l.hit(`k${i}`);
    expect(l.isBlocked('k0')).toBe(false);
    expect(l.isBlocked('k49')).toBe(true);
  });
});
