/**
 * Identité des vecteurs de PAN entre la base et l'API (revue architecture US-019 2026-11-03d,
 * n° 3) : une seule table, `pan-vectors.json`, lue par `l0-pay-pan.test.ts` (base) et par
 * apps/api/src/modules/pay/internal/pan.test.ts (TypeScript). Sans base (test:unit).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EVT_FALSE_POSITIVE,
  HEX_FALSE_POSITIVE,
  NOT_PANS,
  PANS,
  PAN_VECTORS_PATH,
  VISA_TEST,
  reducedKeyCorpus,
} from './pan.ts';

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

  it('contenu : 41 PAN (UnionPay 16 et 19, Visa 19, replis de 0028, bords des empreintes de 0129), 20 non-PAN, sans doublon', () => {
    expect(PANS).toHaveLength(41);
    expect(NOT_PANS).toHaveLength(20);
    const texts = [...PANS, ...NOT_PANS].map((v) => v.text);
    expect(new Set(texts).size).toBe(texts.length);
    const notes = PANS.map((v) => v.note);
    for (const n of ['UnionPay 16', 'UnionPay 19', 'Visa 19', 'repli : préfixe 7']) {
      expect(notes).toContain(n);
    }
    expect(PANS.map((v) => v.text)).toContain(VISA_TEST);
    expect(NOT_PANS.map((v) => v.text)).toContain(EVT_FALSE_POSITIVE);
  });

  it('0129 : la reproduction est bien hex(sha256) de sa clé de remboursement ; corpus réduit reproductible', () => {
    const plain =
      'f32ac183-4791-4f5c-af1f-aabdd0d12b3b:9fb6aea1-3d03-457d-ab48-c3e7564599eb:v1:REFUND:' +
      'c38fe3d7-830e-49f4-a4a1-72334be7812b:i1:a1';
    expect(plain.length).toBeGreaterThan(64);
    expect(createHash('sha256').update(plain, 'utf8').digest('hex')).toBe(HEX_FALSE_POSITIVE);
    expect(NOT_PANS.map((v) => v.text)).toContain(HEX_FALSE_POSITIVE);
    expect(PANS.map((v) => v.text)).toContain(`g${HEX_FALSE_POSITIVE}`);
    expect(reducedKeyCorpus(3)).toEqual(reducedKeyCorpus(3));
  });
});
