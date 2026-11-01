import { describe, expect, it } from 'vitest';
import { createCurrencyRegistry, money, type Currency } from '../src/index.ts';
import { PYG, USD, errorCodeOf, registry } from './fixtures.ts';

describe('registre de devises (exposant fourni par la configuration, ADR-024)', () => {
  it("donne l'exposant de la configuration", () => {
    expect(USD).toMatchObject({ code: 'USD', exponent: 2 });
    expect(PYG).toMatchObject({ code: 'PYG', exponent: 0 });
    expect(registry.codes()).toEqual(['USD', 'PYG']);
    expect(registry.has('PYG')).toBe(true);
    expect(registry.has('EUR')).toBe(false);
  });

  it('refuse une devise non configurée : CURRENCY_UNSUPPORTED (16 PRC-021)', () => {
    expect(errorCodeOf(() => registry.get('EUR'))).toBe('CURRENCY_UNSUPPORTED');
  });

  it('refuse une devise fabriquée hors registre : CURRENCY_UNSUPPORTED', () => {
    const forged = { code: 'USD', exponent: 2 } as unknown as Currency;
    expect(errorCodeOf(() => money(1n, forged))).toBe('CURRENCY_UNSUPPORTED');
  });

  it('un même code dans deux registres a l’exposant de son registre', () => {
    const other = createCurrencyRegistry([{ code: 'USD', exponent: 3 }]);
    expect(other.get('USD').exponent).toBe(3);
    expect(USD.exponent).toBe(2);
  });

  it.each([
    ['code minuscule', [{ code: 'usd', exponent: 2 }]],
    ['code trop long', [{ code: 'USDT', exponent: 2 }]],
    ['exposant négatif', [{ code: 'USD', exponent: -1 }]],
    ['exposant décimal', [{ code: 'USD', exponent: 1.5 }]],
    ['exposant trop grand', [{ code: 'USD', exponent: 19 }]],
    [
      'doublon',
      [
        { code: 'PYG', exponent: 0 },
        { code: 'PYG', exponent: 0 },
      ],
    ],
  ])('refuse une configuration invalide (%s) : CURRENCY_CONFIG_INVALID', (_label, definitions) => {
    expect(errorCodeOf(() => createCurrencyRegistry(definitions))).toBe('CURRENCY_CONFIG_INVALID');
  });

  it('les devises du registre sont immuables', () => {
    expect(Object.isFrozen(USD)).toBe(true);
    expect(Object.isFrozen(registry)).toBe(true);
  });
});
