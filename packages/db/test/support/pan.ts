/**
 * Vecteurs de PAN (17 §1.6, §4.4 point 3 ; migration 0029, US-019) : numéros de test publics des
 * réseaux (jamais une carte réelle), identifiants structurés, corpus `evt-<uuid>` à graine fixe et
 * mutant « définition de 0028 ». Mêmes vecteurs que apps/api/src/modules/pay/internal/pan.test.ts.
 */

export const VISA_TEST = '4111111111111111';

/** `evt-<uuid>` refusé par la définition de 0028 (reproduction déterministe du faux positif). */
export const EVT_FALSE_POSITIVE = 'evt-b6e0d932-76ed-4c01-8373-52880805f175';

/** PAN de test publics, nus ou séparés : tous refusés. */
export const PANS: readonly string[] = [
  VISA_TEST,
  '4111 1111 1111 1111',
  '4111-1111-1111-1111',
  '4222222222222', // Visa 13
  '5555555555554444', // Mastercard
  '5105-1051-0510-5100',
  '2223003122003222', // Mastercard série 2
  '378282246310005', // Amex
  '3782 822463 10005', // Amex 4-6-5
  '30569309025904', // Diners
  '3056 930902 5904', // Diners 4-6-4
  '6011111111111117', // Discover
  '3530111333300000', // JCB
  `card${VISA_TEST}`,
  `${EVT_FALSE_POSITIVE} ${VISA_TEST}`,
  '2031 4111 1111 1111 1111', // PAN au milieu d'une suite plus longue
  `{"x-debug": "${VISA_TEST}"}`,
];

/** Identifiants structurés et numéros non-PAN : tous acceptés. */
export const NOT_PANS: readonly string[] = [
  EVT_FALSE_POSITIVE,
  EVT_FALSE_POSITIVE.slice(4),
  // groupes 2 à 5 en forme 4-4-4-1, préfixe 4, Luhn valide : seul l'écart des UUID le protège
  'evt-d2f69ff4-4996-4768-9028-5f9a743db520',
  EVT_FALSE_POSITIVE.toUpperCase(),
  `{"x-request-id": "${EVT_FALSE_POSITIVE.slice(4)}"}`,
  '4111111111111112', // Luhn invalide
  '378282246310006',
  '411111111111', // 12 chiffres
  '41111111111111111111', // 20 chiffres
  '4111  1111 1111 1111', // double espace
  '1730633212346', // horodatage en millisecondes, Luhn valide, préfixe hors émetteurs
  '7111111111111114', // Luhn valide, préfixe 7 hors émetteurs
  '41-11111111-11116', // séparateurs hors forme de carte (Luhn valide)
  '411111******1111', // masqué
];

/** Générateur déterministe (mulberry32). */
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

/** `n` identifiants `evt-<uuid v4>` reproductibles (graine fixe). */
export function evtCorpus(n: number, seed = 20261103): string[] {
  const next = rng(seed);
  return Array.from({ length: n }, () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16));
    hex[12] = '4';
    hex[16] = ['8', '9', 'a', 'b'][Math.floor(next() * 4)] ?? '8';
    const h = hex.join('');
    return `evt-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  });
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Mutant : définition de 0028 (chiffres joints par un espace ou un tiret, Luhn). */
export function containsPan0028(text: string): boolean {
  for (const m of text.matchAll(/[0-9](?:[ -]?[0-9])*/g)) {
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}
