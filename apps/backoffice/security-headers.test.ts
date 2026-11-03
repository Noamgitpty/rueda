/**
 * En-têtes de sécurité du back-office (revue sécurité US-012, constat 14) : jamais en cadre, rien
 * d'une autre origine, aucune fuite de l'adresse, HTTPS imposé, type MIME respecté. Vérifiés sur
 * la configuration Next réellement exportée (toutes les routes).
 */
import { describe, expect, it } from 'vitest';
import nextConfig from './next.config.ts';
import { contentSecurityPolicy, securityHeaders } from './security-headers.ts';

const byKey = (headers: readonly { key: string; value: string }[]) =>
  Object.fromEntries(headers.map((h) => [h.key.toLowerCase(), h.value]));

describe('en-têtes de sécurité du back-office', () => {
  it('production : CSP stricte, frame-ancestors none, HSTS, no-referrer, nosniff', () => {
    const h = byKey(securityHeaders(true));
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['content-security-policy']).toContain("object-src 'none'");
    expect(h['content-security-policy']).toContain("connect-src 'self'");
    expect(h['content-security-policy']).not.toContain('unsafe-eval');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['strict-transport-security']).toMatch(/^max-age=\d{8,}; includeSubDomains$/);
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-content-type-options']).toBe('nosniff');
  });

  it('développement seulement : unsafe-eval (rechargement à chaud)', () => {
    expect(contentSecurityPolicy(false)).toContain("'unsafe-eval'");
  });

  it('next.config applique ces en-têtes à toutes les routes', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const all = rules.find((r) => r.source === '/:path*');
    expect(all).toBeDefined();
    const h = byKey(all?.headers ?? []);
    for (const key of [
      'content-security-policy',
      'x-frame-options',
      'strict-transport-security',
      'referrer-policy',
      'x-content-type-options',
    ]) {
      expect(h[key], key).toBeTruthy();
    }
  });
});
