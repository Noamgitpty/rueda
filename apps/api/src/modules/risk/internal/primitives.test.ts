/**
 * US-052 — primitives de l'anti-abus : clé HMAC (fail-closed en production), normalisation des
 * IP, heuristiques anti-robot et portée des routes.
 */
import { describe, expect, it } from 'vitest';
import { decide, isRegular, lacksBrowserHeaders, RhythmTracker } from './bot-heuristics.js';
import {
  normalizeIp,
  parsePreviousRateLimitKey,
  parseRateLimitKey,
  RateKeyHasher,
} from './key-hasher.js';
import { scopeOf } from './rate-limit.guard.js';

describe('clé RUEDA_RATE_LIMIT_KEY', () => {
  it('absente en production : refus de démarrer ; hors production : clé aléatoire', () => {
    expect(() => parseRateLimitKey(undefined, true)).toThrow(/production/);
    expect(() => parseRateLimitKey('', true)).toThrow(/production/);
    const a = parseRateLimitKey(undefined, false);
    const b = parseRateLimitKey(undefined, false);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(false);
  });

  it('mal formée : refus partout ; 32 à 64 octets hexadécimaux acceptés', () => {
    for (const bad of ['zz', 'ab'.repeat(31), 'ab'.repeat(65), `${'ab'.repeat(32)}a`]) {
      expect(() => parseRateLimitKey(bad, false)).toThrow(/RUEDA_RATE_LIMIT_KEY/);
    }
    expect(parseRateLimitKey('ab'.repeat(32), true)).toHaveLength(32);
    expect(parseRateLimitKey('AB'.repeat(64), true)).toHaveLength(64);
  });

  it('le message d’erreur ne contient jamais la valeur', () => {
    const secret = `${'cd'.repeat(31)}zz`;
    try {
      parseRateLimitKey(secret, true);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe('ancienne clé RUEDA_RATE_LIMIT_KEY_PREVIOUS (rotation, US-051)', () => {
  const current = Buffer.alloc(32, 3);

  it('absente ou égale à la courante : aucune rotation ; mal formée : refus sans la valeur', () => {
    expect(parsePreviousRateLimitKey(undefined, current)).toBeNull();
    expect(parsePreviousRateLimitKey('', current)).toBeNull();
    expect(parsePreviousRateLimitKey(current.toString('hex'), current)).toBeNull();
    const secret = `${'ef'.repeat(31)}zz`;
    expect(() => parsePreviousRateLimitKey(secret, current)).toThrow(
      /RUEDA_RATE_LIMIT_KEY_PREVIOUS/,
    );
    try {
      parsePreviousRateLimitKey(secret, current);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('pendant la rotation : empreinte courante d’abord, puis l’ancienne', () => {
    const previous = Buffer.alloc(32, 4);
    const rotating = new RateKeyHasher(current, previous);
    const [first, second] = rotating.hashes('ip', '192.0.2.1');
    expect(first?.equals(new RateKeyHasher(current).hash('ip', '192.0.2.1'))).toBe(true);
    expect(second?.equals(new RateKeyHasher(previous).hash('ip', '192.0.2.1'))).toBe(true);
    expect(rotating.hash('ip', '192.0.2.1').equals(first as Buffer)).toBe(true);
    expect(new RateKeyHasher(current).hashes('ip', '192.0.2.1')).toHaveLength(1);
  });
});

describe('empreintes', () => {
  const h = new RateKeyHasher(Buffer.alloc(32, 1));

  it('32 octets, dépend de la clé et du genre, jamais la valeur en clair', () => {
    const x = h.hash('phone', '+15550000001');
    expect(x).toHaveLength(32);
    expect(x.toString('hex')).not.toContain('5550000001');
    expect(x.equals(h.hash('email', '+15550000001'))).toBe(false);
    expect(x.equals(new RateKeyHasher(Buffer.alloc(32, 2)).hash('phone', '+15550000001'))).toBe(
      false,
    );
  });

  it('normalisation : e-mail, numéro, IPv4 mappée, IPv6 au /64', () => {
    expect(h.hash('email', ' Ana@Example.TEST ').equals(h.hash('email', 'ana@example.test'))).toBe(
      true,
    );
    expect(h.hash('phone', '+1 555 000 0001').equals(h.hash('phone', '+15550000001'))).toBe(true);
    expect(normalizeIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(normalizeIp('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(normalizeIp('2001:db8:1:2::9')).toBe('2001:db8:1:2::/64');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(h.hash('ip', '2001:db8:1:2::1').equals(h.hash('ip', '2001:db8:1:2:ffff::2'))).toBe(true);
    expect(h.hash('ip', '2001:db8:1:2::1').equals(h.hash('ip', '2001:db8:1:3::1'))).toBe(false);
  });
});

describe('heuristiques anti-robot', () => {
  it('en-têtes de navigateur : User-Agent, Accept et Accept-Language exigés', () => {
    const browser = { 'user-agent': 'Mozilla/5.0', accept: 'text/html', 'accept-language': 'es' };
    expect(lacksBrowserHeaders(browser)).toBe(false);
    for (const k of Object.keys(browser)) {
      expect(lacksBrowserHeaders({ ...browser, [k]: undefined })).toBe(true);
      expect(lacksBrowserHeaders({ ...browser, [k]: '  ' })).toBe(true);
    }
  });

  it('rythme régulier : 8 intervalles égaux ⇒ signal ; rythme humain ⇒ aucun', () => {
    const regular = Array.from({ length: 9 }, (_, i) => i * 1000);
    expect(isRegular(regular)).toBe(true);
    expect(isRegular(regular.slice(0, 8))).toBe(false); // pas assez d'intervalles
    const human = [0, 900, 3100, 3500, 7000, 7300, 12000, 12500, 16000];
    expect(isRegular(human)).toBe(false);
    const t = new RhythmTracker(2);
    let last = false;
    for (const at of regular) last = t.record('k', at);
    expect(last).toBe(true);
    t.record('a', 0);
    t.record('b', 0); // borné à 2 clés : « k » est évincée
    expect(t.record('k', 9000)).toBe(false);
  });

  it('décision : aucun signal ⇒ rien ; un ⇒ ralenti ; rafale ou deux ⇒ défi', () => {
    expect(decide([])).toBe('NONE');
    expect(decide(['NO_BROWSER_HEADERS'])).toBe('SLOW');
    expect(decide(['REGULAR_RHYTHM'])).toBe('SLOW');
    expect(decide(['SIGNUP_BURST'])).toBe('CHALLENGE');
    expect(decide(['NO_BROWSER_HEADERS', 'REGULAR_RHYTHM'])).toBe('CHALLENGE');
  });
});

describe('portée des routes', () => {
  it.each([
    ['/webhooks/psp/x', 'webhook'],
    ['/search?country=XX', 'search'],
    ['/search/vehicles', 'search'],
    ['/quotes', 'quote'],
    ['/quote/123', 'quote'],
    ['/auth/login', 'api'],
    ['/', 'api'],
    ['/searching', 'api'],
  ])('%s ⇒ %s', (path, scope) => {
    expect(scopeOf(path)).toBe(scope);
  });
});
