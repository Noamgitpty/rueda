/**
 * US-311 — export CSV (17 §2.2 « exports CSV » ; RFC 4180 ; OWASP « CSV injection »). Attendus
 * tirés de la RFC 4180 (virgule, CRLF, guillemets doublés) et de la règle OWASP (préfixe `'` des
 * cellules qui commencent par `=`, `+`, `-`, `@`, tabulation, retour chariot), jamais du code testé.
 */
import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, toCsv } from './csv.js';

describe('toCsv', () => {
  it('en-têtes puis lignes, CRLF final, colonnes dans l’ordre donné, absentes vides', () => {
    expect(toCsv(['a', 'b'], [{ a: 'x', b: 1 }, { b: true }, { a: null }])).toBe(
      'a,b\r\nx,1\r\n,true\r\n,\r\n',
    );
  });

  it('guillemets RFC 4180 : virgule, guillemet, retour à la ligne', () => {
    expect(toCsv(['v'], [{ v: 'a,b' }, { v: 'il dit "oui"' }, { v: 'l1\nl2' }])).toBe(
      'v\r\n"a,b"\r\n"il dit ""oui"""\r\n"l1\nl2"\r\n',
    );
  });

  it.each(['=1+1', '+33', '-2', '@SUM(A1)', '\tx', '\rx'])(
    'injection de formule neutralisée : %j',
    (v) => {
      const out = toCsv(['v'], [{ v }]).split('\r\n')[1] ?? '';
      expect(out.replace(/^"/, '').startsWith(`'${v.slice(0, 1)}`)).toBe(true);
    },
  );

  it('montants en unités mineures : chaînes de chiffres recopiées telles quelles (bigint sans perte)', () => {
    expect(toCsv(['m'], [{ m: '9007199254740993' }, { m: 12840n }])).toBe(
      'm\r\n9007199254740993\r\n12840\r\n',
    );
  });

  it('colonnes des exports : aucune donnée personnelle (ni nom, ni contact, ni pièce, ni carte)', () => {
    const all = Object.values(CSV_COLUMNS).flat();
    for (const c of all) {
      expect(c).not.toMatch(/name|email|phone|document|card|address|license|holder|birth/i);
    }
  });
});
