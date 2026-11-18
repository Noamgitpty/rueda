/**
 * Détecteur de PAN (17 §4.4 point 3, F26 ; portée SAQ A, 17 §1.6). Numéros de test publics des
 * réseaux (jamais une carte réelle) ; même définition que `core.payment_text_has_pan` (0029,
 * 0131). Vecteurs : table UNIQUE `packages/db/test/support/pan-vectors.json`, jouée aussi en base
 * par `packages/db/test/l0/l0-pay-pan.test.ts` (identité vérifiée par `test/support/pan.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { idempotencyKeyToSend, settlementOperationKey } from './idempotency.js';
import { containsPan, luhnValid, maskPan, maskPanDeep, panScanStats } from './pan.js';

interface Vector {
  readonly text: string;
  readonly note: string;
}
/** Chemin de la table partagée, depuis la racine du dépôt (cité tel quel par le test d'identité). */
const PAN_VECTORS_PATH = 'packages/db/test/support/pan-vectors.json';
const VECTORS = JSON.parse(
  readFileSync(new URL(`../../../../../../${PAN_VECTORS_PATH}`, import.meta.url), 'utf8'),
) as { pans: Vector[]; notPans: Vector[] };

const VISA_TEST = '4111111111111111';
const AMEX_TEST = '378282246310005';
/** `evt-<uuid>` refusé par la définition de 0028 (reproduction déterministe du faux positif). */
const EVT_FALSE_POSITIVE = 'evt-b6e0d932-76ed-4c01-8373-52880805f175';

/** Générateur déterministe (mulberry32) : corpus reproductible, même graine qu'en base. */
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
function evtCorpus(n: number, seed = 20261103): string[] {
  const next = rng(seed);
  return Array.from({ length: n }, () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16));
    hex[12] = '4';
    hex[16] = ['8', '9', 'a', 'b'][Math.floor(next() * 4)] ?? '8';
    const h = hex.join('');
    return `evt-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  });
}

/** Mutant : définition de 0028 (suite de chiffres joints par un espace ou un tiret, Luhn). */
function containsPan0028(text: string): boolean {
  for (const m of text.matchAll(/[0-9](?:[ -]?[0-9])*/g)) {
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}

describe('PAN', () => {
  it('table partagée : 41 PAN (dont UnionPay, 19 chiffres, bords des empreintes de 0131), 20 non-PAN', () => {
    expect(VECTORS.pans).toHaveLength(41);
    expect(VECTORS.notPans).toHaveLength(20);
    const notes = VECTORS.pans.map((v) => v.note).join(' | ');
    expect(notes).toMatch(/UnionPay 16/);
    expect(notes).toMatch(/UnionPay 19/);
    expect(notes).toMatch(/Visa 19/);
  });

  it('Luhn', () => {
    expect(luhnValid(VISA_TEST)).toBe(true);
    expect(luhnValid(AMEX_TEST)).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it.each(VECTORS.pans)('PAN refusé : $note', ({ text }) => {
    expect(containsPan(text)).toBe(true);
  });

  it.each(VECTORS.notPans)('accepté : $note', ({ text }) => {
    expect(containsPan(text)).toBe(false);
  });

  it('10 000 evt-<uuid> générés (graine fixe) : aucun PAN ; le mutant 0028 en refuse', () => {
    const corpus = evtCorpus(10_000);
    expect(new Set(corpus).size).toBe(10_000);
    expect(corpus.filter((t) => containsPan(t))).toEqual([]);
    expect(corpus.filter((t) => maskPan(t).masked > 0)).toEqual([]);
    // mutation : l'ancienne définition est tuée par ce corpus et par la reproduction fixe
    expect(corpus.filter((t) => containsPan0028(t)).length).toBeGreaterThan(0);
    expect(containsPan0028(EVT_FALSE_POSITIVE)).toBe(true);
  });

  it('0131 / ADR-155 : 200 000 clés réduites par idempotencyKeyToSend, aucun PAN ni masque ; le mutant 0029 en refuse', () => {
    // clés de remboursement (08 E4) : UUID à graine fixe, 126 caractères > 64 ⇒ hex(sha256)
    const next = rng(20261117);
    const uuid = (): string => {
      const h = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16)).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
    };
    let mutantKilled = 0;
    const leaks: string[] = [];
    for (let i = 0; i < 200_000; i++) {
      const plain = settlementOperationKey({
        tripId: uuid(),
        segmentId: uuid(),
        settlementVersion: 1 + (i % 3),
        operationType: 'REFUND',
        tenderId: uuid(),
        instanceSeq: 1,
        attemptNo: 1 + (i % 2),
      });
      const sent = idempotencyKeyToSend(plain, 64);
      if (!/^[0-9a-f]{64}$/.test(sent)) leaks.push(`forme : ${sent}`);
      // formes reçues : la référence seule, et l'événement normalisé du webhook de preuve
      const event = JSON.stringify([{ merchantReference: sent, status: 'SUCCEEDED' }]);
      if (containsPan(sent) || containsPan(event) || maskPan(event).masked > 0) leaks.push(sent);
      // mutant « définition de 0029 » : une lettre collée (sans chiffre) retire l'exclusion
      if (containsPan(`g${sent}`)) mutantKilled += 1;
    }
    expect(leaks).toEqual([]);
    // environ 0,32 % attendu (QA d'US-122 : 638 sur 200 000)
    expect(mutantKilled).toBeGreaterThan(300);
    console.log(`[US-019 PAN] 200 000 clés réduites : 0 refus (0029 en refusait ${mutantKilled})`);
  });

  it('0131 / ADR-155 : un vrai PAN reste refusé et masqué à côté d’une empreinte, empreinte intacte', () => {
    const sent = idempotencyKeyToSend(`${'x'.repeat(70)}:a1`, 64);
    expect(sent).toMatch(/^[0-9a-f]{64}$/);
    for (const text of [
      `${sent} ${VISA_TEST}`,
      `${sent}-4111-1111-1111-1111`,
      `${VISA_TEST}-${sent}`,
      JSON.stringify({ merchantReference: sent, card: AMEX_TEST }),
    ]) {
      expect(containsPan(text), text).toBe(true);
      const r = maskPan(text);
      expect(r.masked, text).toBeGreaterThan(0);
      expect(containsPan(r.text), text).toBe(false);
      expect(r.text, text).toContain(sent);
    }
    // jetons hors forme exacte : toujours analysés (capitales, 65 caractères, lettre collée)
    for (const text of [
      `${VISA_TEST}${'F'.repeat(48)}`,
      `${'a'.repeat(24)}${VISA_TEST}${'a'.repeat(25)}`,
      `g${VISA_TEST}${'a'.repeat(48)}`,
    ]) {
      expect(containsPan(text), text).toBe(true);
    }
  });

  it('10 000 UUID aléatoires (crypto) : aucun PAN', () => {
    const found = Array.from({ length: 10_000 }, () => randomUUID()).filter((u) =>
      containsPan(`evt-${u}`),
    );
    expect(found).toEqual([]);
  });

  it('complexité linéaire : 256 ko de petits groupes, au plus 19 étapes par groupe', () => {
    // pire cas des revues (« 1 1 1 … », « 4 4 4 … ») : 131 072 groupes d'un chiffre
    for (const digit of ['1', '4', '0']) {
      const text = `${digit} `.repeat(128 * 1024);
      const stats = panScanStats(text);
      expect(stats.groups).toBe(128 * 1024);
      expect(stats.steps).toBeLessThanOrEqual(19 * stats.groups);
    }
    // 256 ko masqués en profondeur dans des en-têtes : borne d'étapes, temps consigné seulement
    const headers = Object.fromEntries(
      Array.from({ length: 256 }, (_, i) => [`x-${i}`, '4 '.repeat(512)]),
    );
    const t0 = performance.now();
    const r = maskPanDeep(headers);
    console.log(`[US-019 PAN] maskPanDeep 256 ko : ${(performance.now() - t0).toFixed(1)} ms`);
    expect(containsPan(JSON.stringify(r.value))).toBe(false);
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
    for (const { text, note } of VECTORS.pans) {
      const r = maskPan(text);
      expect(r.masked, note).toBeGreaterThan(0);
      expect(containsPan(r.text), note).toBe(false);
    }
    for (const { text, note } of VECTORS.notPans) {
      expect(maskPan(text), note).toEqual({ text, masked: 0 });
    }
  });

  it('masque : au plus trois passes, puis tous les chiffres du segment (fail-closed)', () => {
    // chaque masque recolle ses 4 derniers chiffres au groupe suivant : nouvelle fenêtre à chaque passe
    // 1re passe : 4000000000004111 ; 2e passe : 4111 1111 1111 116 (4 derniers chiffres recollés)
    const twoPasses = maskPan('4000000000004111 1111 1111 116');
    expect(twoPasses).toEqual({ text: '400000******411111*****1116', masked: 2 });
    expect(containsPan(twoPasses.text)).toBe(false);
  });

  it('masque en profondeur : chaînes, tableaux, objets, clés', () => {
    const r = maskPanDeep({ a: [VISA_TEST, 'x'], [AMEX_TEST]: { b: 'ok' }, n: 3 });
    expect(r.masked).toBe(2);
    expect(containsPan(JSON.stringify(r.value))).toBe(false);
    expect(r.value).toMatchObject({ a: ['411111******1111', 'x'], n: 3 });
  });
});
