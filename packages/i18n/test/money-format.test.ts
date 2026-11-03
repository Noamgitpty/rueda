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

// Locale fr (DEC-FONDATEUR-17) : aucune valeur dans 08 / 16 / 17 ; oracle = CLDR du français
// (espace fine insécable U+202F pour les milliers, espace insécable U+00A0 avant le symbole),
// vérifié aussi contre `Intl.NumberFormat('fr')`, que `formatMoney` n'utilise pas.
const NBSP = String.fromCodePoint(0xa0);
const NNBSP = String.fromCodePoint(0x202f);

describe('formatMoney — français (lecteur francophone, montants en USD ou en PYG)', () => {
  it('USD : « 1 234,56 $US », deux décimales', () => {
    expect(formatMoney(amount(123456n, 'USD'), profile('fr'))).toBe(`1${NNBSP}234,56${NBSP}$US`);
    expect(formatMoney(amount(14500n, 'USD'), profile('fr'))).toBe(`145,00${NBSP}$US`);
    expect(formatMoney(amount(5n, 'USD'), profile('fr'))).toBe(`0,05${NBSP}$US`);
    expect(formatMoney(amount(-123456n, 'USD'), profile('fr'))).toBe(`-1${NNBSP}234,56${NBSP}$US`);
  });

  it('PYG : « 1 050 000 ₲ », sans décimale', () => {
    expect(formatMoney(amount(1050000n, 'PYG'), profile('fr'))).toBe(
      `1${NNBSP}050${NNBSP}000${NBSP}₲`,
    );
    expect(formatMoney(amount(7n, 'PYG'), profile('fr'))).toBe(`7${NBSP}₲`);
    expect(formatMoney(amount(9007199254740993n, 'PYG'), profile('fr'))).toBe(
      ['9', '007', '199', '254', '740', '993'].join(NNBSP) + `${NBSP}₲`,
    );
  });

  it('concorde avec le CLDR du français embarqué dans Node (oracle externe)', () => {
    const usd = new Intl.NumberFormat('fr', { style: 'currency', currency: 'USD' });
    expect(formatMoney(amount(123456n, 'USD'), profile('fr'))).toBe(usd.format(1234.56));
    expect(formatMoney(amount(-123456n, 'USD'), profile('fr'))).toBe(usd.format(-1234.56));
    const pyg = new Intl.NumberFormat('fr', {
      style: 'currency',
      currency: 'PYG',
      currencyDisplay: 'narrowSymbol',
    });
    expect(formatMoney(amount(1050000n, 'PYG'), profile('fr'))).toBe(pyg.format(1050000));
  });
});

// Locale pt-BR (DEC-FONDATEUR-18) : aucune valeur dans 08 / 16 / 17 ; oracle = CLDR du portugais
// du Brésil (point des milliers, virgule décimale, symbole devant suivi d'une espace insécable
// U+00A0), vérifié contre `Intl.NumberFormat('pt-BR')`, que `formatMoney` n'utilise pas.
describe('formatMoney — portugais du Brésil (montants en USD ou en PYG)', () => {
  it('USD : « US$ 1.234,56 », deux décimales', () => {
    expect(formatMoney(amount(123456n, 'USD'), profile('pt'))).toBe(`US$${NBSP}1.234,56`);
    expect(formatMoney(amount(14500n, 'USD'), profile('pt'))).toBe(`US$${NBSP}145,00`);
    expect(formatMoney(amount(5n, 'USD'), profile('pt'))).toBe(`US$${NBSP}0,05`);
    expect(formatMoney(amount(-123456n, 'USD'), profile('pt'))).toBe(`-US$${NBSP}1.234,56`);
  });

  it('PYG : « ₲ 1.050.000 », sans décimale', () => {
    expect(formatMoney(amount(1050000n, 'PYG'), profile('pt'))).toBe(`₲${NBSP}1.050.000`);
    expect(formatMoney(amount(7n, 'PYG'), profile('pt'))).toBe(`₲${NBSP}7`);
    expect(formatMoney(amount(9007199254740993n, 'PYG'), profile('pt'))).toBe(
      `₲${NBSP}9.007.199.254.740.993`,
    );
  });

  it('concorde avec le CLDR du portugais du Brésil embarqué dans Node (oracle externe)', () => {
    const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });
    expect(formatMoney(amount(123456n, 'USD'), profile('pt'))).toBe(usd.format(1234.56));
    expect(formatMoney(amount(-123456n, 'USD'), profile('pt'))).toBe(usd.format(-1234.56));
    expect(formatMoney(amount(5n, 'USD'), profile('pt'))).toBe(usd.format(0.05));
    const pyg = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'PYG',
      currencyDisplay: 'narrowSymbol',
    });
    expect(formatMoney(amount(1050000n, 'PYG'), profile('pt'))).toBe(pyg.format(1050000));
    expect(formatMoney(amount(-1050000n, 'PYG'), profile('pt'))).toBe(pyg.format(-1050000));
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
