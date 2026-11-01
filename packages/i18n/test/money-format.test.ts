import { describe, expect, it } from 'vitest';
import { formatMoney } from '../src/index.ts';
import { amount, profile } from './helpers.ts';

// Valeurs attendues : 19 US-014 (critères), 16 fiche I18N-004 / I18N-005, 17 §1.2.
describe('formatMoney — USD (exposant 2)', () => {
  it('1 234,56 US$ : « US$ 1.234,56 » en es-PA, « $1,234.56 » en en (critère US-014)', () => {
    expect(formatMoney(amount(123456n, 'USD'), profile('es-PA'))).toBe('US$ 1.234,56');
    expect(formatMoney(amount(123456n, 'USD'), profile('en'))).toBe('$1,234.56');
  });

  it('même rendu en es-PY qu’en es-PA (séparateurs de l’espagnol de la configuration)', () => {
    expect(formatMoney(amount(123456n, 'USD'), profile('es-PY'))).toBe('US$ 1.234,56');
  });

  it('toujours deux décimales, zéros conservés', () => {
    expect(formatMoney(amount(14500n, 'USD'), profile('es-PA'))).toBe('US$ 145,00');
    expect(formatMoney(amount(14500n, 'USD'), profile('en'))).toBe('$145.00');
    expect(formatMoney(amount(5n, 'USD'), profile('en'))).toBe('$0.05');
    expect(formatMoney(amount(0n, 'USD'), profile('es-PA'))).toBe('US$ 0,00');
  });

  it('montants du trip PA1 (TA01) : 120,00 + 8,40 = 128,40 affichés sans perte', () => {
    expect(formatMoney(amount(12000n, 'USD'), profile('es-PA'))).toBe('US$ 120,00');
    expect(formatMoney(amount(840n, 'USD'), profile('es-PA'))).toBe('US$ 8,40');
    expect(formatMoney(amount(12840n, 'USD'), profile('en'))).toBe('$128.40');
  });

  it('montant négatif (remboursement, remise)', () => {
    expect(formatMoney(amount(-123456n, 'USD'), profile('es-PA'))).toBe('-US$ 1.234,56');
    expect(formatMoney(amount(-123456n, 'USD'), profile('en'))).toBe('-$1,234.56');
  });
});

describe('formatMoney — PYG (exposant 0, aucune décimale)', () => {
  it('« ₲ 1.050.000 » en es-PY (17 §1.2), sans séparateur décimal', () => {
    expect(formatMoney(amount(1050000n, 'PYG'), profile('es-PY'))).toBe('₲ 1.050.000');
  });

  it('« ₲ 1.250.000 » en es-PY et es-PA (10b UX-16), « ₲1,250,000 » en en', () => {
    expect(formatMoney(amount(1250000n, 'PYG'), profile('es-PY'))).toBe('₲ 1.250.000');
    expect(formatMoney(amount(1250000n, 'PYG'), profile('es-PA'))).toBe('₲ 1.250.000');
    expect(formatMoney(amount(1250000n, 'PYG'), profile('en'))).toBe('₲1,250,000');
  });

  it('jamais de décimale, même pour une petite valeur', () => {
    for (const tag of ['es-PA', 'es-PY', 'en']) {
      const text = formatMoney(amount(7n, 'PYG'), profile(tag));
      expect(text).toBe(tag === 'en' ? '₲7' : '₲ 7');
      expect(text).not.toMatch(/[.,]\d/);
    }
  });
});

describe('formatMoney — adaptateur d’affichage seulement', () => {
  it('exact au-delà de 2^53 (aucun flottant)', () => {
    expect(formatMoney(amount(9007199254740993n, 'PYG'), profile('es-PY'))).toBe(
      '₲ 9.007.199.254.740.993',
    );
    expect(formatMoney(amount(9007199254740993n, 'USD'), profile('en'))).toBe(
      '$90,071,992,547,409.93',
    );
  });

  it('refuse un number (unités mineures en bigint seulement)', () => {
    const bad = { amountMinor: 123456 as unknown as bigint, currency: 'USD', exponent: 2 };
    expect(() => formatMoney(bad, profile('en'))).toThrow(TypeError);
  });

  it('refuse un exposant ou un code de devise invalide', () => {
    const p = profile('en');
    expect(() => formatMoney({ amountMinor: 1n, currency: 'USD', exponent: -1 }, p)).toThrow();
    expect(() => formatMoney({ amountMinor: 1n, currency: 'USD', exponent: 1.5 }, p)).toThrow();
    expect(() => formatMoney({ amountMinor: 1n, currency: 'usd', exponent: 2 }, p)).toThrow();
  });

  it('devise sans symbole configuré : code ISO affiché', () => {
    expect(formatMoney({ amountMinor: 100n, currency: 'EUR', exponent: 2 }, profile('en'))).toBe(
      'EUR1.00',
    );
  });

  it('accepte tout objet porteur des trois champs (indépendant de Money, US-015)', () => {
    const moneyLike = { amountMinor: 2500n, currency: 'USD', exponent: 2, extra: 'ignoré' };
    expect(formatMoney(moneyLike, profile('es-PA'))).toBe('US$ 25,00');
  });
});
