/**
 * Lint du mouvement réduit (US-031, 10b UX-69, WCAG 2.3.3) : avec `prefers-reduced-motion:
 * reduce`, aucune animation non essentielle ne joue. Les durées des jetons tombent à `0s` et
 * `BASE_CSS` coupe animations et transitions ; ce lint exige en plus, source par source :
 *
 * - CSS : chaque sélecteur qui déclare une `animation` (ou `animation-name`) hors d'un bloc
 *   `@media (prefers-reduced-motion: no-preference)` la remet à `none` dans un bloc
 *   `@media (prefers-reduced-motion: reduce)` du même fichier ;
 * - TS / JS : un fichier qui anime par script (`requestAnimationFrame`, `.animate(`) consulte la
 *   préférence (`prefers-reduced-motion`, `prefersReducedMotion`, `REDUCED_MOTION_QUERY`) ;
 * - HTML / SVG : aucune animation SMIL (`<animate…>`), que le CSS ne peut pas arrêter ; les blocs
 *   `<style>` suivent la règle CSS.
 *
 * Analyse par motifs, sans dépendance. Limite connue : une animation écrite en CSS dans une
 * chaîne TS n'est pas suivie (le lint des styles y refuse déjà toute durée en dur).
 */
import type { SourceKind, StyleFinding } from './scan.ts';

export const REDUCED_MOTION_MESSAGE =
  'animation sans arrêt avec prefers-reduced-motion : ajouter « animation: none » dans @media (prefers-reduced-motion: reduce) (10b UX-69)';
export const SCRIPTED_MOTION_MESSAGE =
  'animation par script sans consulter prefers-reduced-motion (motionDurationMs ou prefersReducedMotion de @rueda/design-tokens)';
export const SMIL_MESSAGE =
  'animation SMIL (<animate…>) : impossible à arrêter avec prefers-reduced-motion, utiliser du CSS';

interface RuleBlock {
  readonly selectors: readonly string[];
  readonly conditions: readonly string[];
  readonly decls: readonly { prop: string; value: string; index: number }[];
}

const blank = (m: string): string => m.replace(/[^\n]/g, ' ');

function position(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  return { line: before.split('\n').length, column: index - before.lastIndexOf('\n') };
}

/** Blocs de règles d'une feuille, avec la pile des conditions (`@media…`) qui les entourent. */
export function cssRuleBlocks(css: string, offset = 0): RuleBlock[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, blank);
  const blocks: RuleBlock[] = [];
  const stack: { prelude: string; decls: RuleBlock['decls'][number][] }[] = [];
  let start = 0;
  const flush = (end: number): void => {
    const top = stack.at(-1);
    const chunk = text.slice(start, end);
    const m = /^\s*(-?[A-Za-z-]+)\s*:([\s\S]*)$/.exec(chunk);
    if (top && m) {
      const lead = chunk.length - chunk.trimStart().length;
      top.decls.push({
        prop: (m[1] as string).toLowerCase(),
        value: (m[2] as string).trim(),
        index: offset + start + lead,
      });
    }
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      stack.push({ prelude: text.slice(start, i).trim(), decls: [] });
      start = i + 1;
    } else if (ch === ';') {
      flush(i);
      start = i + 1;
    } else if (ch === '}') {
      flush(i);
      const closed = stack.pop();
      if (closed && !closed.prelude.startsWith('@')) {
        const preludes = stack.map((s) => s.prelude);
        // Le contenu d'un @keyframes (`from`, `50%`…) n'est pas une règle de sélecteur.
        if (!preludes.some((p) => /^@(-[a-z]+-)?keyframes\b/i.test(p))) {
          blocks.push({
            selectors: closed.prelude.split(',').map((s) => s.replace(/\s+/g, ' ').trim()),
            conditions: preludes.filter((p) => p.startsWith('@')),
            decls: closed.decls,
          });
        }
      }
      start = i + 1;
    }
  }
  return blocks;
}

const reduceQuery = (c: string): boolean =>
  /^@media\b.*prefers-reduced-motion\s*:\s*reduce/i.test(c);
const noPreferenceQuery = (c: string): boolean =>
  /^@media\b.*prefers-reduced-motion\s*:\s*no-preference/i.test(c);
const animates = (d: { prop: string; value: string }): boolean =>
  (d.prop === 'animation' || d.prop === 'animation-name') &&
  !/^(none|initial|unset|inherit|revert)$/i.test(d.value.trim());
const stops = (d: { prop: string; value: string }): boolean =>
  (d.prop === 'animation' || d.prop === 'animation-name') && /^none$/i.test(d.value.trim());

function scanCss(css: string, offset: number, source: string): StyleFinding[] {
  const blocks = cssRuleBlocks(css, offset);
  const stopped = new Set<string>();
  for (const b of blocks)
    if (b.conditions.some(reduceQuery) && b.decls.some(stops))
      for (const s of b.selectors) stopped.add(s);
  const findings: StyleFinding[] = [];
  for (const b of blocks) {
    if (b.conditions.some(reduceQuery) || b.conditions.some(noPreferenceQuery)) continue;
    for (const d of b.decls.filter(animates)) {
      const missing = b.selectors.filter((s) => !stopped.has(s));
      if (missing.length === 0) continue;
      findings.push({
        ...position(source, d.index),
        rule: 'reduced-motion',
        text: `${missing.join(', ')} { ${d.prop}: ${d.value} }`.replace(/\s+/g, ' ').slice(0, 80),
        message: REDUCED_MOTION_MESSAGE,
      });
    }
  }
  return findings;
}

/** Constats « mouvement réduit » d'un fichier source. */
export function scanReducedMotion(source: string, kind: SourceKind): StyleFinding[] {
  if (kind === 'css') return scanCss(source, 0, source);
  const findings: StyleFinding[] = [];
  if (kind === 'markup') {
    const text = source.replace(/<!--[\s\S]*?-->/g, blank);
    for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      const start = (m.index ?? 0) + m[0].indexOf('>') + 1;
      findings.push(...scanCss(m[1] as string, start, source));
    }
    for (const m of text.matchAll(/<(animate|animateTransform|animateMotion|set)\b/g))
      findings.push({
        ...position(source, m.index ?? 0),
        rule: 'reduced-motion',
        text: m[0],
        message: SMIL_MESSAGE,
      });
    return findings;
  }
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (m, p: string) => p + blank(m.slice(p.length)));
  const guarded =
    /prefers-reduced-motion|prefersReducedMotion|REDUCED_MOTION_QUERY|motionDurationMs/.test(text);
  if (guarded) return findings;
  for (const m of text.matchAll(/\brequestAnimationFrame\s*\(|\.animate\s*\(/g))
    findings.push({
      ...position(source, m.index ?? 0),
      rule: 'reduced-motion',
      text: m[0],
      message: SCRIPTED_MOTION_MESSAGE,
    });
  return findings;
}
