/**
 * US-122 — red team du lot 1, axe contenus éditables (RT-L1-A05, US-121, ADR-095) : charges
 * d'injection contre le Markdown restreint des blocs de contenu (script, gestionnaires `on*`,
 * `javascript:`, liens externes, SVG, CSS, caractères de direction et invisibles, arbres forgés,
 * pollution de prototype, charges de taille). Rapport : docs/team/redteam/L1-rls-abus.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Invariant : une charge est REFUSÉE (RichTextError), ou devient un arbre fermé dont tous
 * les nœuds sont du texte, du gras, de l'italique ou un lien INTERNE ; aucune chaîne HTML n'est
 * jamais produite. Attendus : 17 §3.2.13 (« Markdown restreint : aucun script, liens internes
 * seulement »), 19 US-121 (« HTML assaini »), OWASP XSS Filter Evasion ; jamais le code testé.
 */
import { describe, expect, it } from 'vitest';
import {
  EDITABLE_BLOCKS,
  RICH_LIMITS,
  RichTextError,
  isInternalHref,
  isRichDoc,
  parseRichText,
} from '../src/index.ts';
import type { RichDoc, RichFormat } from '../src/index.ts';

const PAYLOADS: readonly (readonly [string, string])[] = [
  ['script', '<script>alert(1)</script>'],
  ['image à gestionnaire', '<img src=x onerror=alert(1)>'],
  ['svg à gestionnaire', '<svg/onload=alert(1)>'],
  ['iframe', '<iframe src="javascript:alert(1)"></iframe>'],
  ['style', '<style>@import "https://evil.example/x.css";</style>'],
  ['lien javascript', '[clic](javascript:alert(1))'],
  ['lien javascript en casse mixte', '[clic](JaVaScRiPt:alert(1))'],
  ['lien javascript avec tabulation', '[clic](java\tscript:alert(1))'],
  ['lien javascript avec entité', '[clic](&#106;avascript:alert(1))'],
  ['lien data', '[clic](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
  ['lien vbscript', '[clic](vbscript:msgbox(1))'],
  ['lien protocole relatif', '[clic](//evil.example/x)'],
  ['lien https', '[clic](https://evil.example/x)'],
  ['lien contre-oblique', '[clic](/\\evil.example)'],
  ['lien avec chemin et tabulation', '[clic](/\t/evil.example)'],
  ['lien avec retour à la ligne encodé', '[clic](/%0d%0aSet-Cookie:x=1)'],
  ['lien imbriqué', '[[clic](javascript:alert(1))](/ok)'],
  ['gras autour d’une balise', '**<img src=x onerror=alert(1)>**'],
  ['italique autour d’un lien', '*[clic](javascript:alert(1))*'],
  ['liste avec lien externe', '- [a](https://evil.example)\n- b'],
  ['liste ordonnée avec lien', '1. [a](data:text/html,x)'],
  ['direction inversée', 'gpj.exe\u202eannuler'],
  ['isolat de direction', '\u2066 pwned \u2069'],
  ['espace de largeur nulle', 'abc\u200bdef'],
  ['caractère de contrôle', 'abc\u0000def'],
  ['séparateur de ligne', 'abc\u2028def'],
  ['demi-paire de substitution', 'a\ud83db'],
  ['étiquettes cachées', 'abc\u{E0041}\u{E0042}'],
  ['très long', 'x'.repeat(200_000)],
  ['liens en rafale', '[a](/x)'.repeat(2_000)],
  ['astérisques en rafale', '*a'.repeat(5_000)],
  ['lien interne trop long', `[a](/${'a'.repeat(400)})`],
];

const FORMATS: readonly RichFormat[] = ['plain', 'rich'];

/** Parcourt l'arbre : tout nœud est d'un type permis ; tout lien est interne ; aucun HTML. */
function assertClosedTree(doc: RichDoc): void {
  if (doc.format === 'plain') {
    expect(typeof doc.text).toBe('string');
    return;
  }
  const inline = (n: { t: string; v?: string; href?: string }): void => {
    expect(['text', 'strong', 'em', 'link']).toContain(n.t);
    if (n.t === 'link') {
      expect(isInternalHref(n.href ?? ''), `href ${n.href}`).toBe(true);
      expect(n.href).toMatch(/^[/#]/);
      expect(n.href).not.toMatch(/^\/\//);
    }
  };
  for (const b of doc.blocks) {
    expect(['p', 'ul', 'ol']).toContain(b.t);
    if (b.t === 'p') b.c.forEach(inline);
    else b.items.forEach((i) => i.forEach(inline));
  }
}

describe('RT-L1-A05 — charges d’injection : refus ou arbre fermé (jamais de HTML, jamais de lien externe)', () => {
  it.each(PAYLOADS.flatMap(([name, p]) => FORMATS.map((f) => [name, f, p] as const)))(
    '%s (%s)',
    (_name, format, payload) => {
      let doc: RichDoc | null = null;
      try {
        doc = parseRichText(payload, format, 600);
      } catch (error) {
        expect(error, 'seule RichTextError est une issue de refus').toBeInstanceOf(RichTextError);
      }
      if (doc !== null) {
        // l'arbre produit est revalidé par le site : accepté tel quel, et fermé
        expect(isRichDoc(doc, format, 600)).toBe(true);
        assertClosedTree(doc);
        // aucune chaîne HTML produite par l'analyse : les chevrons restent du TEXTE
        expect(JSON.stringify(doc)).not.toMatch(/"t":"(html|script|img|iframe|svg)"/);
      }
    },
  );

  it('temps borné : aucune charge ne fait tourner l’analyse plus de 2 s (ReDoS, copies quadratiques)', () => {
    for (const [name, payload] of PAYLOADS) {
      const t0 = performance.now();
      try {
        parseRichText(payload, 'rich', 600);
      } catch {
        // refus : permis
      }
      expect(performance.now() - t0, name).toBeLessThan(2_000);
    }
    const t0 = performance.now();
    try {
      parseRichText('*'.repeat(100_000), 'rich', 100_000);
      parseRichText(`${'['.repeat(50_000)}x`, 'rich', 100_000);
      parseRichText(`${'**a'.repeat(30_000)}`, 'rich', 100_000);
    } catch {
      // refus : permis
    }
    expect(performance.now() - t0).toBeLessThan(5_000);
  });

  it('bornes de l’arbre : plus de 20 paragraphes, 12 éléments de liste ou 400 nœuds ⇒ refus', () => {
    const blocks = Array.from({ length: RICH_LIMITS.maxBlocks + 1 }, (_, i) => `p${i}`).join(
      '\n\n',
    );
    expect(() => parseRichText(blocks, 'rich', 10_000)).toThrow(RichTextError);
    const items = Array.from({ length: RICH_LIMITS.maxItems + 1 }, (_, i) => `- i${i}`).join('\n');
    expect(() => parseRichText(items, 'rich', 10_000)).toThrow(RichTextError);
    const nodes = Array.from({ length: 12 }, () => '*a***b**[c](/d)'.repeat(25)).join('\n\n');
    expect(() => parseRichText(nodes, 'rich', 100_000)).toThrow(RichTextError);
  });
});

describe('RT-L1-A05 — arbre forgé reçu par le site : revalidation stricte', () => {
  const valid: RichDoc = {
    format: 'rich',
    blocks: [{ t: 'p', c: [{ t: 'text', v: 'Hola' }] }],
  };

  it('témoin : un arbre conforme est accepté', () => {
    expect(isRichDoc(valid, 'rich', 600)).toBe(true);
  });

  it.each([
    [
      'nœud html',
      { format: 'rich', blocks: [{ t: 'p', c: [{ t: 'html', v: '<script>alert(1)</script>' }] }] },
    ],
    [
      'lien javascript',
      {
        format: 'rich',
        blocks: [{ t: 'p', c: [{ t: 'link', v: 'x', href: 'javascript:alert(1)' }] }],
      },
    ],
    [
      'lien externe',
      {
        format: 'rich',
        blocks: [{ t: 'p', c: [{ t: 'link', v: 'x', href: 'https://evil.example' }] }],
      },
    ],
    [
      'lien protocole relatif',
      { format: 'rich', blocks: [{ t: 'p', c: [{ t: 'link', v: 'x', href: '//evil.example' }] }] },
    ],
    [
      'champ en trop (gestionnaire)',
      { format: 'rich', blocks: [{ t: 'p', c: [{ t: 'text', v: 'x', onclick: 'alert(1)' }] }] },
    ],
    [
      'champ en trop au bloc',
      { format: 'rich', blocks: [{ t: 'p', c: [{ t: 'text', v: 'x' }], style: 'x' }] },
    ],
    [
      'texte non chaîne',
      { format: 'rich', blocks: [{ t: 'p', c: [{ t: 'text', v: { toString: 'x' } }] }] },
    ],
    ['format inattendu', { format: 'html', blocks: [] }],
    ['liste vide', { format: 'rich', blocks: [{ t: 'ul', items: [] }] }],
    ['mauvais format attendu', { format: 'plain', text: 'x' }],
    [
      'texte à caractère de direction',
      { format: 'rich', blocks: [{ t: 'p', c: [{ t: 'text', v: 'a\u202eb' }] }] },
    ],
  ] as const)('%s : refusé', (_name, forged) => {
    expect(isRichDoc(forged, 'rich', 600)).toBe(false);
  });

  it('pollution de prototype : un arbre JSON portant __proto__ ou constructor n’est pas accepté et ne pollue rien', () => {
    const polluted = JSON.parse(
      '{"format":"rich","blocks":[{"t":"p","c":[{"t":"text","v":"x"}]}],"__proto__":{"polluted":true}}',
    ) as unknown;
    expect(isRichDoc(polluted, 'rich', 600)).toBe(false);
    const ctor = JSON.parse(
      '{"format":"plain","text":"x","constructor":{"prototype":{"polluted":true}}}',
    ) as unknown;
    expect(isRichDoc(ctor, 'plain', 600)).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('charge de taille : un arbre annoncé énorme est refusé avant le parcours', () => {
    const huge = {
      format: 'rich',
      blocks: [{ t: 'p', c: Array.from({ length: 1_000_000 }, () => ({ t: 'text', v: 'x' })) }],
    };
    const t0 = performance.now();
    expect(isRichDoc(huge, 'rich', 600)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});

describe('RT-L1-A05 — le registre des blocs éditables ne contient aucune clé juridique ni format libre', () => {
  it('chaque bloc déclare un format plain ou rich et une longueur bornée à 600 caractères au plus', () => {
    for (const [key, block] of Object.entries(EDITABLE_BLOCKS)) {
      expect(['plain', 'rich'], key).toContain(block.format);
      expect(block.maxLength, key).toBeLessThanOrEqual(600);
      expect(block.maxLength, key).toBeGreaterThan(0);
    }
  });
});
