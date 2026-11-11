/**
 * Markdown restreint des blocs éditables (US-121, ADR-095) : liste blanche, arbre fermé, aucun
 * HTML. Attendus : 17 §3.2.13 (« Markdown restreint : aucun script, liens internes seulement »),
 * 19 US-121 (« HTML assaini ») ; charges d'injection classiques (OWASP XSS Filter Evasion).
 */
import { describe, expect, it } from 'vitest';
import {
  RICH_LIMITS,
  isInternalHref,
  isRichDoc,
  parseRichText,
  plainTextOf,
  richTextProblem,
} from '../src/index.ts';

describe('format plain', () => {
  it('une ligne : texte littéral, Markdown et chevrons non interprétés', () => {
    expect(parseRichText('  Alquila **ya** [x](/y)  ', 'plain', 80)).toEqual({
      format: 'plain',
      text: 'Alquila **ya** [x](/y)',
    });
    expect(richTextProblem('Ligne 1\nLigne 2', 'plain', 80)).toBe('une seule ligne attendue');
    expect(richTextProblem('   ', 'plain', 80)).toBe('vide');
    expect(richTextProblem('x'.repeat(81), 'plain', 80)).toBe('plus de 80 caractères');
    // 80 caractères visibles (graphèmes simples), pas 80 unités UTF-16
    expect(richTextProblem('é'.repeat(80), 'plain', 80)).toBeNull();
  });

  it('émojis : longueur en points de code, identique à l’API et au site', () => {
    const ok = '\u{1F697}'.repeat(80);
    expect(richTextProblem(ok, 'plain', 80)).toBeNull();
    expect(isRichDoc(parseRichText(ok, 'plain', 80), 'plain', 80)).toBe(true);
    const tooLong = '\u{1F697}'.repeat(81);
    expect(richTextProblem(tooLong, 'plain', 80)).toBe('plus de 80 caractères');
    expect(isRichDoc({ format: 'plain', text: tooLong }, 'plain', 80)).toBe(false);
    // demi-paire de substitution isolée : refusée des deux côtés
    expect(richTextProblem('a\ud83db', 'plain', 80)).toBe('caractère de contrôle');
    expect(isRichDoc({ format: 'plain', text: 'a\ud83db' }, 'plain', 80)).toBe(false);
  });

  it('marques de direction et caractères invisibles refusés (LRM, RLM, ALM, largeur nulle, BOM)', () => {
    for (const bad of [
      'a\u200eb',
      'a\u200fb',
      'a\u061cb',
      'a\u200bb',
      'a\u200cb',
      'a\u200db',
      'a\u2060b',
      'a\ufeffb',
    ]) {
      expect(richTextProblem(bad, 'plain', 80), JSON.stringify(bad)).toBe('caractère de contrôle');
      expect(isRichDoc({ format: 'plain', text: bad }, 'plain', 80)).toBe(false);
    }
  });

  it('caractères de contrôle et de direction (texte trompeur) refusés', () => {
    for (const bad of ['a\u0000b', 'a\u0007b', 'a\u202eb', 'a\u2066b', 'a\u2028b', 'a\u009bb']) {
      expect(richTextProblem(bad, 'plain', 80), JSON.stringify(bad)).toBe('caractère de contrôle');
    }
  });
});

describe('format rich', () => {
  it('paragraphes, listes, gras, italique, liens internes', () => {
    const doc = parseRichText(
      'Gana **más** con tu *auto*.\nSigue [aquí](/hosts).\n\n- Uno\n- Dos [ayuda](#ayuda)\n\n1. A\n2. B',
      'rich',
      600,
    );
    expect(doc).toEqual({
      format: 'rich',
      blocks: [
        {
          t: 'p',
          c: [
            { t: 'text', v: 'Gana ' },
            { t: 'strong', v: 'más' },
            { t: 'text', v: ' con tu ' },
            { t: 'em', v: 'auto' },
            { t: 'text', v: '. Sigue ' },
            { t: 'link', v: 'aquí', href: '/hosts' },
            { t: 'text', v: '.' },
          ],
        },
        {
          t: 'ul',
          items: [
            [{ t: 'text', v: 'Uno' }],
            [
              { t: 'text', v: 'Dos ' },
              { t: 'link', v: 'ayuda', href: '#ayuda' },
            ],
          ],
        },
        { t: 'ol', items: [[{ t: 'text', v: 'A' }], [{ t: 'text', v: 'B' }]] },
      ],
    });
    expect(plainTextOf(doc)).toBe('Gana más con tu auto. Sigue aquí.\n\nUno\nDos ayuda\n\nA\nB');
    expect(isRichDoc(doc, 'rich', 600)).toBe(true);
  });

  it('balises : jamais interprétées, restent du texte (React les échappera)', () => {
    const doc = parseRichText('<img src=x onerror=alert(1)> <b>x</b>', 'rich', 600);
    expect(doc).toEqual({
      format: 'rich',
      blocks: [{ t: 'p', c: [{ t: 'text', v: '<img src=x onerror=alert(1)> <b>x</b>' }] }],
    });
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'https://example.test',
    '//example.test',
    '/\\example.test',
    'data:text/html,<script>alert(1)</script>',
    'mailto:a@example.test',
    'vbscript:x',
    '/ok"onmouseover="x',
    "/ok'x",
    '/ok<x',
    'ayuda',
    '',
  ])('lien hors du site refusé : %s', (href) => {
    expect(richTextProblem(`Ver [aquí](${href})`, 'rich', 600)).toMatch(/^lien hors du site/);
  });

  it('chemins internes admis', () => {
    for (const href of ['/', '/hosts', '/a/b-c_d.e~f', '/s?city=panama&x=1', '/a#b', '#faq']) {
      expect(isInternalHref(href), href).toBe(true);
    }
  });

  it('bornes : paragraphes, éléments de liste, longueur', () => {
    const many = Array.from({ length: RICH_LIMITS.maxBlocks + 1 }, (_, i) => `P${i}`).join('\n\n');
    expect(richTextProblem(many, 'rich', 10_000)).toBe(
      `plus de ${RICH_LIMITS.maxBlocks} paragraphes`,
    );
    const list = Array.from({ length: RICH_LIMITS.maxItems + 1 }, (_, i) => `- ${i}`).join('\n');
    expect(richTextProblem(list, 'rich', 10_000)).toBe(
      `liste de plus de ${RICH_LIMITS.maxItems} éléments`,
    );
  });
});

describe('isRichDoc : revalidation stricte côté site', () => {
  const ok = { format: 'rich', blocks: [{ t: 'p', c: [{ t: 'text', v: 'Hola' }] }] };

  it('arbre conforme accepté ; format différent refusé', () => {
    expect(isRichDoc(ok, 'rich', 600)).toBe(true);
    expect(isRichDoc(ok, 'plain', 600)).toBe(false);
    expect(isRichDoc({ format: 'plain', text: 'Hola' }, 'plain', 80)).toBe(true);
  });

  it.each([
    ['nœud inconnu (html)', { format: 'rich', blocks: [{ t: 'html', v: '<script>' }] }],
    ['inline inconnu', { format: 'rich', blocks: [{ t: 'p', c: [{ t: 'raw', v: '<b>' }] }] }],
    [
      'lien externe',
      { format: 'rich', blocks: [{ t: 'p', c: [{ t: 'link', v: 'x', href: 'javascript:x' }] }] },
    ],
    [
      'champ en trop (attributs)',
      {
        format: 'rich',
        blocks: [{ t: 'p', c: [{ t: 'link', v: 'x', href: '/a', onclick: 'x' }] }],
      },
    ],
    ['champ en trop (racine)', { ...ok, html: '<b>' }],
    ['texte vide', { format: 'rich', blocks: [{ t: 'p', c: [{ t: 'text', v: '' }] }] }],
    ['texte non chaîne', { format: 'rich', blocks: [{ t: 'p', c: [{ t: 'text', v: 1 }] }] }],
    ['aucun bloc', { format: 'rich', blocks: [] }],
    [
      'tableau en ligne au-delà du plafond (borné avant le parcours)',
      {
        format: 'rich',
        blocks: [{ t: 'p', c: Array.from({ length: 401 }, () => ({ t: 'text', v: 'x' })) }],
      },
    ],
    ['plain multiligne', { format: 'plain', text: 'a\nb' }],
    ['plain trop long', { format: 'plain', text: 'x'.repeat(81) }],
    ['contrôle', { format: 'plain', text: 'a\u202eb' }],
    ['null', null],
    ['tableau', [ok]],
  ])('%s : refusé', (_label, value) => {
    const format = (value as { format?: string } | null)?.format === 'plain' ? 'plain' : 'rich';
    expect(isRichDoc(value, format, 80)).toBe(false);
  });
});
