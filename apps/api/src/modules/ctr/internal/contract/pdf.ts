/**
 * Rendu PDF DÉTERMINISTE du contrat de location (US-211, ADR-143 ; 17 §2.7 « hachage SHA-256 du
 * PDF exact présenté »). Mêmes lignes ⇒ mêmes octets ⇒ même empreinte, à toute date et sur toute
 * machine : aucune date, aucun identifiant aléatoire, aucune compression, aucun appel à `Intl`, aucune
 * police embarquée (Courier et Courier-Bold, polices standard de PDF, à chasse fixe : la coupure
 * des lignes se compte en caractères). Texte encodé en WinAnsi (cp1252) ; un caractère hors de cet
 * encodage devient « ? » (jamais une erreur au rendu).
 *
 * Une version du rendu est figée avec le document (`renderer_version`) : toute modification de ce
 * fichier qui change les octets exige une NOUVELLE version (`ctr.pdf/2`), l'ancienne restant
 * disponible pour reproduire les contrats déjà enregistrés (test d'empreinte de référence).
 */

export const PDF_RENDERER_V1 = 'ctr.pdf/1';

export type ContractLineStyle = 'title' | 'h' | 'p' | 'kv' | 'note';

/** Une ligne logique du contrat (style, texte) ; le rendu la coupe à la largeur de la page. */
export interface ContractLine {
  readonly s: ContractLineStyle;
  readonly t: string;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_X = 48;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 56;
const TEXT_W = PAGE_W - 2 * MARGIN_X;
/** Courier : chasse de 600 / 1000 em. */
const CHAR_EM = 0.6;

interface StyleSpec {
  readonly face: 'F1' | 'F2';
  readonly size: number;
  readonly leading: number;
  readonly before: number;
}

const STYLES: Readonly<Record<ContractLineStyle, StyleSpec>> = {
  title: { face: 'F2', size: 12, leading: 16, before: 0 },
  h: { face: 'F2', size: 9.5, leading: 13, before: 6 },
  p: { face: 'F1', size: 8.5, leading: 11, before: 2 },
  kv: { face: 'F1', size: 8.5, leading: 11, before: 0 },
  note: { face: 'F2', size: 8.5, leading: 11, before: 2 },
};

/** Caractères WinAnsi de 0x80 à 0x9F (les autres positions de cp1252 sont celles de Latin-1). */
const CP1252_HIGH: Readonly<Record<string, number>> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/** Octet WinAnsi d'un caractère ; espaces insécables ⇒ espace ; hors encodage ⇒ « ? ». */
function winAnsi(ch: string): number {
  const code = ch.codePointAt(0) ?? 0x3f;
  if (code === 0xa0 || code === 0x202f || code === 0x2007 || code === 0x2009) return 0x20;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return CP1252_HIGH[ch] ?? 0x3f;
}

/** Chaîne littérale PDF : ASCII seulement (octets hors ASCII imprimable en octal). */
function pdfString(text: string): string {
  let out = '(';
  for (const ch of text.normalize('NFC')) {
    const b = winAnsi(ch);
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
    else if (b < 0x20 || b > 0x7e) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  return `${out})`;
}

/** Coupe un texte en lignes d'au plus `width` caractères (mots entiers, mot trop long coupé). */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.normalize('NFC').split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter((w) => w.length > 0)) {
      let w = word;
      while ([...w].length > width) {
        if (current.length > 0) {
          lines.push(current);
          current = '';
        }
        const chars = [...w];
        lines.push(chars.slice(0, width).join(''));
        w = chars.slice(width).join('');
      }
      if (current.length === 0) current = w;
      else if ([...current].length + 1 + [...w].length <= width) current = `${current} ${w}`;
      else {
        lines.push(current);
        current = w;
      }
    }
    lines.push(current);
  }
  return lines;
}

interface Placed {
  readonly face: 'F1' | 'F2';
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

const fmt = (n: number): string => {
  // nombres à deux décimales au plus, sans notation exponentielle ni zéro superflu
  const s = (Math.round(n * 100) / 100).toFixed(2);
  return s.replace(/\.?0+$/, '');
};

function layout(lines: readonly ContractLine[], footer: string): Placed[][] {
  const pages: Placed[][] = [[]];
  let y = PAGE_H - MARGIN_TOP;
  for (const line of lines) {
    const st = STYLES[line.s];
    const width = Math.floor(TEXT_W / (st.size * CHAR_EM));
    y -= st.before;
    for (const piece of wrapText(line.t, width)) {
      if (y - st.leading < MARGIN_BOTTOM) {
        pages.push([]);
        y = PAGE_H - MARGIN_TOP;
      }
      y -= st.leading;
      pages[pages.length - 1]!.push({
        face: st.face,
        size: st.size,
        x: MARGIN_X,
        y,
        text: piece,
      });
    }
  }
  const total = pages.length;
  return pages.map((p, i) => [
    ...p,
    { face: 'F1', size: 7.5, x: MARGIN_X, y: 32, text: `${footer} - ${i + 1}/${total}` },
  ]);
}

function contentStream(placed: readonly Placed[]): string {
  const ops: string[] = [];
  for (const p of placed) {
    ops.push(
      `BT /${p.face} ${fmt(p.size)} Tf ${fmt(p.x)} ${fmt(p.y)} Td ${pdfString(p.text)} Tj ET`,
    );
  }
  return `${ops.join('\n')}\n`;
}

/**
 * PDF des lignes données, pied de page « {footer} - n/N ». Octets identiques pour des entrées
 * identiques (le test d'empreinte de référence le vérifie).
 */
export function renderPdf(lines: readonly ContractLine[], footer: string): Uint8Array {
  const pages = layout(lines, footer);
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + 2 * i);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  objects[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((placed, i) => {
    const pageId = 5 + 2 * i;
    const contentId = pageId + 1;
    const stream = contentStream(placed);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  });
  // l'en-tête binaire (quatre octets > 127) signale un fichier binaire aux outils de transfert
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(out, 'latin1'));
}
