/**
 * Détecteur de PAN (17 §4.4 point 3, F26 ; portée SAQ A, 17 §1.6). Numéros de test publics des
 * réseaux (jamais une carte réelle) ; même définition que `core.payment_text_has_pan` (0028).
 */
import { describe, expect, it } from 'vitest';
import { containsPan, luhnValid, maskPan, maskPanDeep } from './pan.js';

// numéros de test publiés par les réseaux (Luhn valides)
const VISA_TEST = '4111111111111111';
const AMEX_TEST = '378282246310005';

describe('PAN', () => {
  it('Luhn', () => {
    expect(luhnValid(VISA_TEST)).toBe(true);
    expect(luhnValid(AMEX_TEST)).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it.each([
    [VISA_TEST, true],
    [AMEX_TEST, true],
    ['4111 1111 1111 1111', true],
    ['4111-1111-1111-1111', true],
    [`carte ${VISA_TEST} fin`, true],
    ['4111111111111112', false], // Luhn invalide
    ['411111111111', false], // 12 chiffres
    ['41111111111111111111', false], // 20 chiffres : pas un PAN
    ['4111  1111 1111 1111', false], // double espace : deux suites courtes
    ['1700000000', false], // horodatage en secondes
    ['2031-07-01T08:00:00.000Z', false],
  ])('%s ⇒ %s', (text, expected) => {
    expect(containsPan(text)).toBe(expected);
  });

  it('masque : 6 premiers et 4 derniers chiffres, plus aucune suite détectable', () => {
    const r = maskPan(`a ${VISA_TEST} b ${AMEX_TEST}`);
    expect(r).toEqual({ text: 'a 411111******1111 b 378282*****0005', masked: 2 });
    expect(containsPan(r.text)).toBe(false);
  });

  it('masque en profondeur : chaînes, tableaux, objets, clés', () => {
    const r = maskPanDeep({ a: [VISA_TEST, 'x'], [AMEX_TEST]: { b: 'ok' }, n: 3 });
    expect(r.masked).toBe(2);
    expect(containsPan(JSON.stringify(r.value))).toBe(false);
    expect(r.value).toMatchObject({ a: ['411111******1111', 'x'], n: 3 });
  });
});
