import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from './trust-proxy.js';

describe('RUEDA_API_TRUST_PROXY', () => {
  it('absente ou vide : aucun mandataire de confiance (défaut sûr)', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('  ')).toBe(false);
  });

  it('nombre de mandataires de 1 à 10', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
    expect(parseTrustProxy('10')).toBe(10);
  });

  it('toute autre valeur : refus de démarrer', () => {
    for (const bad of ['true', '0', '11', '-1', '1.5', 'loopback', '10.0.0.0/8', '1,2']) {
      expect(() => parseTrustProxy(bad), bad).toThrow(/RUEDA_API_TRUST_PROXY/);
    }
  });
});
