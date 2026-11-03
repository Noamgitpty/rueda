/**
 * Vecteurs de PAN (17 §1.6, §4.4 point 3 ; migration 0029, US-019) : table UNIQUE
 * `pan-vectors.json` (numéros de test publics des réseaux, jamais une carte réelle), lue aussi par
 * apps/api/src/modules/pay/internal/pan.test.ts ; corpus `evt-<uuid>` à graine fixe et mutant
 * « définition de 0028 ».
 */
import { readFileSync } from 'node:fs';

export interface PanVector {
  readonly text: string;
  readonly note: string;
}

/** Chemin de la table depuis la racine du dépôt (le test d'identité le cherche dans pan.test.ts). */
export const PAN_VECTORS_PATH = 'packages/db/test/support/pan-vectors.json';

const VECTORS = JSON.parse(
  readFileSync(new URL('./pan-vectors.json', import.meta.url), 'utf8'),
) as { pans: PanVector[]; notPans: PanVector[] };

/** PAN de test publics (nus, séparés, tout groupage, zéros de tête…) : tous refusés. */
export const PANS: readonly PanVector[] = VECTORS.pans;
/** Identifiants structurés et numéros non-PAN : tous acceptés. */
export const NOT_PANS: readonly PanVector[] = VECTORS.notPans;

export const VISA_TEST = '4111111111111111';

/** `evt-<uuid>` refusé par la définition de 0028 (reproduction déterministe du faux positif). */
export const EVT_FALSE_POSITIVE = 'evt-b6e0d932-76ed-4c01-8373-52880805f175';

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

/** `n` identifiants `evt-<uuid v4>` reproductibles (graine fixe, la même que pan.test.ts). */
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
