/**
 * Détecteur de PAN (17 §4.4 point 3, F26 ; portée SAQ A, 17 §1.6). Numéros de test publics des
 * réseaux (jamais une carte réelle) ; même définition que `core.payment_text_has_pan` (0029),
 * mêmes vecteurs que `packages/db/test/l0/l0-pay-pan.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cardShape, containsPan, luhnValid, maskPan, maskPanDeep } from './pan.js';

// numéros de test publiés par les réseaux (Luhn valides)
const VISA_TEST = '4111111111111111';
const AMEX_TEST = '378282246310005';

/** `evt-<uuid>` refusé par la définition de 0028 (reproduction déterministe du faux positif). */
const EVT_FALSE_POSITIVE = 'evt-b6e0d932-76ed-4c01-8373-52880805f175';

/** PAN de test publics, nus ou séparés : tous refusés. */
const PANS: readonly string[] = [
  VISA_TEST,
  '4111 1111 1111 1111',
  '4111-1111-1111-1111',
  '4222222222222', // Visa 13
  '4012888888881881',
  '5555555555554444', // Mastercard
  '5555 5555 5555 4444',
  '5105-1051-0510-5100',
  '2223003122003222', // Mastercard série 2
  AMEX_TEST,
  '3782 822463 10005', // Amex 4-6-5
  '3714-496353-98431',
  '30569309025904', // Diners 14
  '3056 930902 5904', // Diners 4-6-4
  '6011111111111117', // Discover
  '3530111333300000', // JCB
  '6200000000000005', // UnionPay
  `carte ${VISA_TEST} fin`,
  `card${VISA_TEST}`,
  `${EVT_FALSE_POSITIVE} ${VISA_TEST}`,
  `2031 4111 1111 1111 1111`, // PAN au milieu d'une suite plus longue
  `{"x-debug":"${VISA_TEST}"}`,
];

/** Identifiants structurés et numéros non-PAN : tous acceptés. */
const NOT_PANS: readonly string[] = [
  EVT_FALSE_POSITIVE,
  EVT_FALSE_POSITIVE.slice(4), // UUID nu
  // groupes 2 à 5 en forme 4-4-4-1, préfixe 4, Luhn valide : seul l'écart des UUID le protège
  'evt-d2f69ff4-4996-4768-9028-5f9a743db520',
  EVT_FALSE_POSITIVE.toUpperCase(),
  `e_${EVT_FALSE_POSITIVE.slice(4)}`,
  '4111111111111112', // Luhn invalide
  '5555555555554445',
  '378282246310006',
  '411111111111', // 12 chiffres
  '41111111111111111111', // 20 chiffres : pas un PAN
  '4111  1111 1111 1111', // double espace : deux suites courtes
  '1700000000', // horodatage en secondes
  '1730633212346', // horodatage en millisecondes, Luhn valide, préfixe hors émetteurs
  '2031-07-01T08:00:00.000Z',
  '7111111111111114', // Luhn valide, préfixe 7 hors émetteurs
  '41-11111111-11116', // séparateurs hors forme de carte (Luhn valide)
];

/** Générateur déterministe (mulberry32) : corpus reproductible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function uuidV4(next: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Math.floor(next() * 4)] ?? '8';
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const next = rng(20261103);
const EVT_CORPUS = Array.from({ length: 10_000 }, () => `evt-${uuidV4(next)}`);

/** Mutant : définition de 0028 (suite de chiffres joints par un espace ou un tiret, Luhn). */
function containsPan0028(text: string): boolean {
  for (const m of text.matchAll(/[0-9](?:[ -]?[0-9])*/g)) {
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}

describe('PAN', () => {
  it('Luhn', () => {
    expect(luhnValid(VISA_TEST)).toBe(true);
    expect(luhnValid(AMEX_TEST)).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it('formes de carte', () => {
    expect(cardShape([16])).toBe(true);
    expect(cardShape([4, 4, 4, 4])).toBe(true);
    expect(cardShape([4, 4, 4, 4, 3])).toBe(true);
    expect(cardShape([4, 6, 5])).toBe(true);
    expect(cardShape([4, 6, 4])).toBe(true);
    expect(cardShape([8, 4, 4, 4, 12])).toBe(false); // UUID
    expect(cardShape([4, 4, 4, 12])).toBe(false);
    expect(cardShape([2, 4, 4, 4])).toBe(false);
    expect(cardShape([12])).toBe(false);
  });

  it.each(PANS)('PAN refusé : %s', (text) => {
    expect(containsPan(text)).toBe(true);
  });

  it.each(NOT_PANS)('accepté : %s', (text) => {
    expect(containsPan(text)).toBe(false);
  });

  it('10 000 evt-<uuid> générés (graine fixe) : aucun PAN ; le mutant 0028 en refuse', () => {
    expect(new Set(EVT_CORPUS).size).toBe(10_000);
    expect(EVT_CORPUS.filter((t) => containsPan(t))).toEqual([]);
    expect(EVT_CORPUS.filter((t) => maskPan(t).masked > 0)).toEqual([]);
    // mutation : l'ancienne définition est tuée par ce corpus et par la reproduction fixe
    expect(EVT_CORPUS.filter((t) => containsPan0028(t)).length).toBeGreaterThan(0);
    expect(containsPan0028(EVT_FALSE_POSITIVE)).toBe(true);
  });

  it('10 000 UUID aléatoires (crypto) : aucun PAN', () => {
    const found = Array.from({ length: 10_000 }, () => randomUUID()).filter((u) =>
      containsPan(`evt-${u}`),
    );
    expect(found).toEqual([]);
  });

  it('masque : 6 premiers et 4 derniers chiffres, plus aucune suite détectable', () => {
    const r = maskPan(`a ${VISA_TEST} b ${AMEX_TEST}`);
    expect(r).toEqual({ text: 'a 411111******1111 b 378282*****0005', masked: 2 });
    expect(containsPan(r.text)).toBe(false);
  });

  it('masque : PAN séparé, UUID voisin intact, chaque vecteur PAN neutralisé', () => {
    expect(maskPan(`${EVT_FALSE_POSITIVE} 4111-1111-1111-1111`)).toEqual({
      text: `${EVT_FALSE_POSITIVE} 411111******1111`,
      masked: 1,
    });
    expect(maskPan('2031 4111 1111 1111 1111').text).toBe('2031 411111******1111');
    for (const pan of PANS) {
      const r = maskPan(pan);
      expect(r.masked, pan).toBeGreaterThan(0);
      expect(containsPan(r.text), pan).toBe(false);
    }
    for (const text of NOT_PANS) expect(maskPan(text), text).toEqual({ text, masked: 0 });
  });

  it('masque en profondeur : chaînes, tableaux, objets, clés', () => {
    const r = maskPanDeep({ a: [VISA_TEST, 'x'], [AMEX_TEST]: { b: 'ok' }, n: 3 });
    expect(r.masked).toBe(2);
    expect(containsPan(JSON.stringify(r.value))).toBe(false);
    expect(r.value).toMatchObject({ a: ['411111******1111', 'x'], n: 3 });
  });
});
