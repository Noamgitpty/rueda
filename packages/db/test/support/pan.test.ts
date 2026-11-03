/**
 * Identité des vecteurs de PAN entre la base et l'API (revue architecture US-019 2026-11-03d,
 * n° 3) : une seule table, `pan-vectors.json`, lue par `l0-pay-pan.test.ts` (base) et par
 * apps/api/src/modules/pay/internal/pan.test.ts (TypeScript). Sans base (test:unit).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVT_FALSE_POSITIVE, NOT_PANS, PANS, PAN_VECTORS_PATH, VISA_TEST } from './pan.ts';

const repo = (path: string): URL => new URL(`../../../../${path}`, import.meta.url);
const read = (path: string): string => readFileSync(repo(path), 'utf8');

describe('vecteurs de PAN partagés', () => {
  it('la base et l’API lisent la même table, sans liste recopiée', () => {
    const json = JSON.parse(read(PAN_VECTORS_PATH)) as { pans: unknown; notPans: unknown };
    expect(PANS).toEqual(json.pans);
    expect(NOT_PANS).toEqual(json.notPans);
    const apiTest = read('apps/api/src/modules/pay/internal/pan.test.ts');
    expect(apiTest).toContain(`'${PAN_VECTORS_PATH}'`);
    expect(apiTest).toContain('VECTORS.pans');
    expect(apiTest).toContain('VECTORS.notPans');
    // aucune liste de PAN écrite à la main dans le test de l'API (hors cas de masque nommés)
    expect(apiTest).not.toMatch(/const PANS\b|const NOT_PANS\b/);
    const l0 = read('packages/db/test/l0/l0-pay-pan.test.ts');
    expect(l0).toMatch(/\bPANS\b/);
    expect(l0).toMatch(/\bNOT_PANS\b/);
  });

  it('contenu : 34 PAN (UnionPay 16 et 19, Visa 19, replis de 0028), 17 non-PAN, sans doublon', () => {
    expect(PANS).toHaveLength(34);
    expect(NOT_PANS).toHaveLength(17);
    const texts = [...PANS, ...NOT_PANS].map((v) => v.text);
    expect(new Set(texts).size).toBe(texts.length);
    const notes = PANS.map((v) => v.note);
    for (const n of ['UnionPay 16', 'UnionPay 19', 'Visa 19', 'repli : préfixe 7']) {
      expect(notes).toContain(n);
    }
    expect(PANS.map((v) => v.text)).toContain(VISA_TEST);
    expect(NOT_PANS.map((v) => v.text)).toContain(EVT_FALSE_POSITIVE);
  });
});
