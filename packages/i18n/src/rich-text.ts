/**
 * Texte des blocs de contenu éditables (US-121, ADR-095) : Markdown **restreint** analysé en un
 * arbre fermé, par liste blanche. Aucune chaîne HTML n'est jamais produite : l'API assainit en
 * construisant cet arbre (`parseRichText`), le site le revalide (`isRichDoc`) puis le rend en
 * éléments React (texte échappé par React, aucun `dangerouslySetInnerHTML`).
 *
 * Deux formats, fixés par le registre des blocs (`editable-blocks.ts`) :
 * - `plain` : une seule ligne de texte ; tout caractère Markdown reste littéral ;
 * - `rich` : paragraphes séparés par une ligne vide, listes (`- …`, `1. …`), `**gras**`,
 *   `*italique*`, liens **internes** `[texte](/chemin)` ou `[texte](#ancre)`.
 *
 * Tout le reste est du texte. Un lien vers une autre origine, un schéma (`javascript:`,
 * `https:`…), un caractère de contrôle ou un texte trop long est un **problème** : refus à
 * l'enregistrement (API), arbre invalide à la lecture (le site affiche alors le catalogue).
 */

export type RichFormat = 'plain' | 'rich';

export type RichInline =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'strong'; readonly v: string }
  | { readonly t: 'em'; readonly v: string }
  | { readonly t: 'link'; readonly v: string; readonly href: string };

export type RichBlock =
  | { readonly t: 'p'; readonly c: readonly RichInline[] }
  | { readonly t: 'ul' | 'ol'; readonly items: readonly (readonly RichInline[])[] };

export type RichDoc =
  | { readonly format: 'plain'; readonly text: string }
  | { readonly format: 'rich'; readonly blocks: readonly RichBlock[] };

/** Bornes de l'arbre (PROPOSÉ) : au-delà, le bloc n'est pas une page entière éditable. */
export const RICH_LIMITS = { maxBlocks: 20, maxItems: 12, maxNodes: 400 } as const;

/** Chemin interne : `/…` (jamais `//`) ou ancre `#…` ; caractères d'URL non ambigus seulement. */
const INTERNAL_HREF =
  /^(?:\/(?!\/)[A-Za-z0-9\-._~/%]*(?:\?[A-Za-z0-9\-._~=&%]*)?(?:#[A-Za-z0-9\-._~]*)?|#[A-Za-z0-9\-._~]+)$/;
// contrôles C0 / C1, séparateurs de ligne, marques et contrôles de direction (LRM, RLM, ALM,
// U+202A à 202E, U+2066 à 2069), caractères invisibles (U+200B à 200D, U+2060, U+FEFF) et
// demi-paires de substitution isolées (le drapeau `u` ne les fait pas apparier par paire)
/* eslint-disable no-control-regex -- liste des caractères refusés, voulue */
const CONTROL =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff\ud800-\udfff]/u;
/* eslint-enable no-control-regex */

/** Longueur en points de code (même unité à l'API et au site : un émoji compte pour un). */
export const codePoints = (s: string): number => [...s].length;

/** Motif des chemins internes (repris tel quel par le contrat OpenAPI : test de parité). */
export const INTERNAL_HREF_PATTERN = INTERNAL_HREF.source;

export function isInternalHref(href: string): boolean {
  return href.length <= 300 && INTERNAL_HREF.test(href);
}

export class RichTextError extends Error {
  override readonly name = 'RichTextError';
}

const LINK = /^\[([^\]\n]{1,200})\]\(([^)\s]*)\)/;
const STRONG = /^\*\*([^*\n]{1,500})\*\*/;
const EM = /^\*([^*\n]{1,500})\*/;

function inline(line: string): RichInline[] {
  const out: RichInline[] = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') out.push({ t: 'text', v: text });
    text = '';
  };
  let rest = line;
  while (rest.length > 0) {
    const link = rest[0] === '[' ? LINK.exec(rest) : null;
    if (link !== null) {
      const href = link[2] ?? '';
      if (!isInternalHref(href)) throw new RichTextError(`lien hors du site : ${href}`);
      flush();
      out.push({ t: 'link', v: link[1] ?? '', href });
      rest = rest.slice(link[0].length);
      continue;
    }
    const strong = rest.startsWith('**') ? STRONG.exec(rest) : null;
    if (strong !== null) {
      flush();
      out.push({ t: 'strong', v: strong[1] ?? '' });
      rest = rest.slice(strong[0].length);
      continue;
    }
    const em = rest[0] === '*' ? EM.exec(rest) : null;
    if (em !== null) {
      flush();
      out.push({ t: 'em', v: em[1] ?? '' });
      rest = rest.slice(em[0].length);
      continue;
    }
    text += rest[0];
    rest = rest.slice(1);
  }
  flush();
  return out;
}

const UL_ITEM = /^- (.+)$/;
const OL_ITEM = /^\d{1,2}\. (.+)$/;

function block(raw: string): RichBlock {
  const lines = raw.split('\n').map((l) => l.trim());
  const items = (re: RegExp): string[] | null => {
    const got = lines.map((l) => re.exec(l)?.[1]);
    return got.every((g): g is string => g !== undefined) ? got : null;
  };
  const ul = items(UL_ITEM);
  if (ul !== null) return { t: 'ul', items: ul.map(inline) };
  const ol = items(OL_ITEM);
  if (ol !== null) return { t: 'ol', items: ol.map(inline) };
  // retours à la ligne d'un paragraphe : espaces (aucun <br> à produire)
  return { t: 'p', c: inline(lines.join(' ')) };
}

function countNodes(doc: RichDoc): number {
  if (doc.format === 'plain') return 1;
  return doc.blocks.reduce(
    (n, b) => n + 1 + (b.t === 'p' ? b.c.length : b.items.reduce((m, i) => m + 1 + i.length, 0)),
    0,
  );
}

/**
 * Analyse un corps de bloc. Lève `RichTextError` (message en français, pour le détail du refus)
 * si le corps sort de la liste blanche ou de ses bornes.
 */
export function parseRichText(source: string, format: RichFormat, maxLength: number): RichDoc {
  const body = source.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
  if (body.length === 0) throw new RichTextError('vide');
  if (codePoints(body) > maxLength) throw new RichTextError(`plus de ${maxLength} caractères`);
  if (CONTROL.test(body)) throw new RichTextError('caractère de contrôle');
  if (format === 'plain') {
    if (body.includes('\n')) throw new RichTextError('une seule ligne attendue');
    return { format: 'plain', text: body };
  }
  const parts = body.split(/\n[ ]*\n+/).filter((p) => p.trim() !== '');
  if (parts.length > RICH_LIMITS.maxBlocks) {
    throw new RichTextError(`plus de ${RICH_LIMITS.maxBlocks} paragraphes`);
  }
  const doc: RichDoc = { format: 'rich', blocks: parts.map(block) };
  for (const b of doc.blocks) {
    if (b.t !== 'p' && b.items.length > RICH_LIMITS.maxItems) {
      throw new RichTextError(`liste de plus de ${RICH_LIMITS.maxItems} éléments`);
    }
  }
  if (countNodes(doc) > RICH_LIMITS.maxNodes) throw new RichTextError('trop d’éléments');
  return doc;
}

/** Problème du corps (message français), ou `null` s'il respecte la liste blanche. */
export function richTextProblem(
  source: string,
  format: RichFormat,
  maxLength: number,
): string | null {
  try {
    parseRichText(source, format, maxLength);
    return null;
  } catch (error) {
    if (error instanceof RichTextError) return error.message;
    throw error;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const hasOnly = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).every((k) => keys.includes(k)) && keys.every((k) => k in v);

const safeText = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 2 * max &&
  codePoints(v) <= max &&
  !CONTROL.test(v);

function isInline(v: unknown): v is RichInline {
  if (!isRecord(v)) return false;
  switch (v['t']) {
    case 'text':
      return hasOnly(v, ['t', 'v']) && safeText(v['v'], 2_000) && !v['v'].includes('\n');
    case 'strong':
    case 'em':
      return hasOnly(v, ['t', 'v']) && safeText(v['v'], 500) && !v['v'].includes('\n');
    case 'link':
      return (
        hasOnly(v, ['t', 'v', 'href']) &&
        safeText(v['v'], 200) &&
        !v['v'].includes('\n') &&
        typeof v['href'] === 'string' &&
        isInternalHref(v['href'])
      );
    default:
      return false;
  }
}

// plafond AVANT le parcours : le site ne fait pas confiance à la taille annoncée par l'API
const isInlines = (v: unknown): v is RichInline[] =>
  Array.isArray(v) && v.length > 0 && v.length <= RICH_LIMITS.maxNodes && v.every(isInline);

function isBlock(v: unknown): v is RichBlock {
  if (!isRecord(v)) return false;
  if (v['t'] === 'p') return hasOnly(v, ['t', 'c']) && isInlines(v['c']);
  if (v['t'] === 'ul' || v['t'] === 'ol') {
    const items = v['items'];
    return (
      hasOnly(v, ['t', 'items']) &&
      Array.isArray(items) &&
      items.length > 0 &&
      items.length <= RICH_LIMITS.maxItems &&
      items.every(isInlines)
    );
  }
  return false;
}

/**
 * Revalidation d'un arbre reçu (le site ne fait pas confiance à l'API) : forme exacte, aucun
 * champ en trop, liens internes seulement, format attendu par le registre, longueur bornée.
 */
export function isRichDoc(value: unknown, format: RichFormat, maxLength: number): value is RichDoc {
  if (!isRecord(value) || value['format'] !== format) return false;
  if (format === 'plain') {
    return (
      hasOnly(value, ['format', 'text']) &&
      safeText(value['text'], maxLength) &&
      !value['text'].includes('\n')
    );
  }
  const blocks = value['blocks'];
  if (
    !hasOnly(value, ['format', 'blocks']) ||
    !Array.isArray(blocks) ||
    blocks.length === 0 ||
    blocks.length > RICH_LIMITS.maxBlocks ||
    !blocks.every(isBlock)
  ) {
    return false;
  }
  const doc = value as RichDoc;
  return countNodes(doc) <= RICH_LIMITS.maxNodes && codePoints(plainTextOf(doc)) <= maxLength;
}

/** Texte brut d'un arbre (aperçu, longueur, lecteurs sans rendu). */
export function plainTextOf(doc: RichDoc): string {
  if (doc.format === 'plain') return doc.text;
  const line = (c: readonly RichInline[]): string => c.map((n) => n.v).join('');
  return doc.blocks
    .map((b) => (b.t === 'p' ? line(b.c) : b.items.map(line).join('\n')))
    .join('\n\n');
}
