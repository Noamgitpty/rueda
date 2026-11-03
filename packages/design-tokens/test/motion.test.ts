import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanReducedMotion } from '../lint/motion.ts';
import { themeStyleSheet } from '../src/css.ts';
import {
  cssVariableOf,
  MOTION_RULES,
  motionDurationMs,
  motionPattern,
  MotionRulesError,
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
  validateMotionRules,
} from '../src/motion.ts';
import { loadTheme } from '../src/theme.ts';

const RULES_URL = new URL('../rules/motion.rules.json', import.meta.url);
const raw = (): Record<string, unknown> =>
  JSON.parse(readFileSync(RULES_URL, 'utf8')) as Record<string, unknown>;
const withPattern = (id: string, patch: Record<string, unknown>): Record<string, unknown> => {
  const doc = raw();
  doc['patterns'] = (doc['patterns'] as Record<string, unknown>[]).map((p) =>
    p['id'] === id ? { ...p, ...patch } : p,
  );
  return doc;
};

describe('jetons de mouvement ajoutés par US-031', () => {
  const css = themeStyleSheet(loadTheme('lienzo-tinta'));

  it.each([
    ['--motion-duration-stagger', '40ms'],
    ['--motion-easing-exit', 'cubic-bezier(0.4, 0, 1, 1)'],
    ['--motion-scale-press', '0.98'],
  ])('%s vaut %s dans Tinta', (name, value) => {
    expect(css).toContain(`${name}:${value};`);
  });

  it('mouvement réduit : stagger à 0s et échelle d’appui à 1', () => {
    const block = /@media \(prefers-reduced-motion:reduce\)\{:root\{([^}]*)\}\}/.exec(css)?.[1];
    expect(block).toContain('--motion-duration-stagger:0s;');
    expect(block).toContain('--motion-scale-press:1;');
  });
});

describe('catalogue des micro-interactions (rules/motion.rules.json)', () => {
  it('se charge et couvre les motifs de 10b UX-69 (camino et compteur en signature)', () => {
    const ids = MOTION_RULES.patterns.map((p) => p.id);
    for (const id of ['press', 'enter', 'exit', 'stagger', 'page', 'skeleton', 'photoCaptured'])
      expect(ids).toContain(id);
    expect(
      MOTION_RULES.patterns
        .filter((p) => p.signature)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['camino', 'earningsCounter']);
  });

  it('chaque motif s’arrête avec le mouvement réduit (état final)', () => {
    for (const p of MOTION_RULES.patterns) expect(p.reduced, p.id).toBe('finalState');
  });

  it('aucune boucle infinie, une signature par écran au plus', () => {
    expect(MOTION_RULES.budget.loopsAllowed).toBe(false);
    expect(MOTION_RULES.budget.maxSignaturePerScreen).toBe(1);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['valeur en dur', { duration: '150ms' }, 'duration doit nommer un jeton'],
    ['jeton inconnu', { easing: 'motion.easing.bounce' }, 'easing doit nommer un jeton'],
    ['signature volée', { duration: 'motion.duration.signature' }, 'durée signature est réservée'],
    ['mouvement maintenu', { reduced: 'keep' }, 'état final'],
  ])('refuse : %s', (_label, patch, message) => {
    expect(() => validateMotionRules(withPattern('press', patch))).toThrow(message);
  });

  it('refuse une boucle infinie et un catalogue vide', () => {
    const doc = raw();
    (doc['budget'] as Record<string, unknown>)['loopsAllowed'] = true;
    doc['patterns'] = [];
    const error = (() => {
      try {
        validateMotionRules(doc);
      } catch (e) {
        return e as MotionRulesError;
      }
      return undefined;
    })();
    expect(error?.problems).toEqual(
      expect.arrayContaining([
        'budget.loopsAllowed : aucune boucle infinie (10b UX-69)',
        'patterns : catalogue vide',
      ]),
    );
  });
});

describe('animations pilotées en JavaScript', () => {
  const theme = loadTheme('lienzo-tinta');

  it('durée du motif en ms, 0 avec le mouvement réduit (valeur finale d’emblée)', () => {
    expect(motionDurationMs(theme, 'earningsCounter', false)).toBe(700);
    expect(motionDurationMs(theme, 'press', false)).toBe(150);
    expect(motionDurationMs(theme, 'earningsCounter', true)).toBe(0);
  });

  it('motif inconnu : erreur', () => {
    expect(() => motionPattern('bounce')).toThrow(MotionRulesError);
  });

  it('préférence : lue par matchMedia, réduite sans matchMedia ou en cas d’erreur (fail-closed)', () => {
    const queries: string[] = [];
    const mm = (matches: boolean) => (q: string) => {
      queries.push(q);
      return { matches };
    };
    expect(prefersReducedMotion(mm(false))).toBe(false);
    expect(prefersReducedMotion(mm(true))).toBe(true);
    expect(queries).toEqual([REDUCED_MOTION_QUERY, REDUCED_MOTION_QUERY]);
    expect(prefersReducedMotion(undefined)).toBe(true);
    expect(
      prefersReducedMotion(() => {
        throw new Error('indisponible');
      }),
    ).toBe(true);
  });

  it('nom de variable CSS d’un jeton', () => {
    expect(cssVariableOf('motion.duration.fast')).toBe('--motion-duration-fast');
  });
});

describe('lint du mouvement réduit (lint/motion.ts)', () => {
  const rules = (source: string, kind: 'css' | 'ts' | 'markup'): string[] =>
    scanReducedMotion(source, kind).map((f) => f.rule);

  it.each<[string, string]>([
    ['animation sans arrêt', '.a { animation: spin var(--motion-duration-slow) infinite; }'],
    ['animation-name sans arrêt', '.a { animation-name: spin; }'],
    [
      'arrêt sur un autre sélecteur',
      '.a { animation: x 1s; }\n@media (prefers-reduced-motion: reduce) { .b { animation: none; } }',
    ],
    [
      'arrêt hors du bloc reduce',
      '.a { animation: x 1s; }\n@media (max-width: 400px) { .a { animation: none; } }',
    ],
    [
      'liste de sélecteurs partiellement arrêtée',
      '.a, .b { animation: x 1s; }\n@media (prefers-reduced-motion: reduce) { .a { animation: none; } }',
    ],
  ])('CSS fautif : %s', (_label, css) => {
    expect(rules(css, 'css')).toContain('reduced-motion');
  });

  it.each<[string, string]>([
    [
      'arrêt explicite',
      '.a { animation: x var(--motion-duration-slow); }\n@media (prefers-reduced-motion: reduce) {\n  .a { opacity: 1; animation: none; }\n}',
    ],
    [
      'animation réservée à no-preference',
      '@media (prefers-reduced-motion: no-preference) { .a { animation: x var(--motion-duration-slow); } }',
    ],
    [
      'transition seule (durée de jeton, coupée par le thème)',
      '.a { transition: opacity var(--motion-duration-fast); }',
    ],
    ['keyframes ignorées', '@keyframes x { from { opacity: 0; } to { opacity: 1; } }'],
    ['animation: none', '.a { animation: none; }'],
    ['commentaire', '/* .a { animation: x 1s; } */'],
  ])('CSS conforme : %s', (_label, css) => {
    expect(rules(css, 'css')).toEqual([]);
  });

  it('script : requestAnimationFrame ou .animate( sans préférence => constat', () => {
    expect(rules('requestAnimationFrame(tick);', 'ts')).toEqual(['reduced-motion']);
    expect(rules('el.animate([{ opacity: 0 }], 300);', 'ts')).toEqual(['reduced-motion']);
    expect(
      rules('if (!prefersReducedMotion(window.matchMedia)) requestAnimationFrame(tick);', 'ts'),
    ).toEqual([]);
    expect(rules('// requestAnimationFrame(tick)', 'ts')).toEqual([]);
  });

  it('balisage : SMIL refusé, bloc <style> jugé comme du CSS', () => {
    expect(rules('<svg><circle><animate attributeName="r" /></circle></svg>', 'markup')).toEqual([
      'reduced-motion',
    ]);
    expect(rules('<style>.a { animation: x 1s; }</style>', 'markup')).toEqual(['reduced-motion']);
    expect(rules('<svg><path d="M0 0" /></svg>', 'markup')).toEqual([]);
  });

  it('position du constat : ligne de la déclaration', () => {
    const [f] = scanReducedMotion(
      '.a {\n  color: var(--color-text);\n  animation: x 1s;\n}',
      'css',
    );
    expect(f).toMatchObject({ line: 3, column: 3 });
  });
});
