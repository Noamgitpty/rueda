/**
 * Critère US-031 : « Given `prefers-reduced-motion`, When il est actif, Then aucune animation non
 * essentielle n'est jouée. » Preuve sur les composants animés **réels** de `packages/ui` (lus sur
 * disque, jamais recopiés) :
 *
 * 1. on découvre chaque module CSS qui anime (transition ou animation) — la liste attendue est
 *    écrite ici, pour qu'un test vide ne passe pas ;
 * 2. on rejoue la cascade avec le mouvement réduit : variables de la feuille du thème (bloc
 *    `prefers-reduced-motion`) pour **chaque palette acceptée**, puis règles du composant dans
 *    leur bloc `reduce` ; chaque transition doit durer 0 et chaque animation valoir `none` ;
 * 3. les règles de base du thème (`BASE_CSS`) coupent en plus toute animation et transition ;
 * 4. aucun script de `packages/ui` n'anime sans consulter la préférence ;
 * 5. preuve par mutation : sans son bloc `reduce`, un vrai composant fait échouer le lint.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssRuleBlocks, scanReducedMotion } from '../lint/motion.ts';
import { BASE_CSS, themeStyleSheet } from '../src/css.ts';
import { listPalettes, loadTheme } from '../src/theme.ts';
import { REPO_ROOT } from './helpers.ts';

const UI_SRC = join(REPO_ROOT, 'packages/ui/src');

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && ext.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

const name = (path: string): string => path.slice(UI_SRC.length + 1).replaceAll('\\', '/');
const MOTION_PROPS =
  /^(transition|transition-duration|animation|animation-name|animation-duration)$/;

const uiCss = files(UI_SRC, /\.css$/).map((path) => ({
  file: name(path),
  css: readFileSync(path, 'utf8'),
}));
const animated = uiCss.filter((f) =>
  cssRuleBlocks(f.css).some((b) => b.decls.some((d) => MOTION_PROPS.test(d.prop))),
);

const isReduce = (c: string): boolean => /prefers-reduced-motion\s*:\s*reduce/.test(c);

/** Variables du bloc `@media (prefers-reduced-motion:reduce){:root{…}}` de la feuille. */
function reducedVariables(sheet: string): Map<string, string> {
  const block = /@media \(prefers-reduced-motion:reduce\)\{:root\{([^}]*)\}\}/.exec(sheet)?.[1];
  const vars = new Map<string, string>();
  for (const decl of (block ?? '').split(';').filter(Boolean)) {
    const [k, v] = decl.split(':');
    vars.set((k as string).trim(), (v as string).trim());
  }
  return vars;
}

/** Durées d'une valeur `transition` / `animation`, variables résolues. */
function durations(value: string, vars: ReadonlyMap<string, string>): string[] {
  // Seules les durées comptent : une durée absente du bloc réduit reste visible (UNRESOLVED).
  const resolved = value.replace(
    /var\((--[\w-]+)\)/g,
    (_m, v: string) =>
      vars.get(v) ?? (v.startsWith('--motion-duration-') ? `UNRESOLVED(${v})` : ''),
  );
  return [...resolved.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b|UNRESOLVED\([\w-]+\)/g)].map(
    (m) => m[0],
  );
}

describe('mouvement réduit sur les composants animés de packages/ui (US-031, 10b UX-69)', () => {
  it('trouve les composants animés attendus (aucun test vide)', () => {
    const found = animated.map((f) => f.file);
    for (const f of [
      'button.module.css',
      'card.module.css',
      'icon-button.module.css',
      'skeleton.module.css',
    ])
      expect(found).toContain(f);
  });

  const accepted = listPalettes().filter((p) => p.accepted);
  it('au moins la palette par défaut est contrôlée', () => {
    expect(accepted.map((p) => p.id)).toContain('lienzo-tinta');
  });

  describe.each(accepted.map((p) => [p.id] as const))('palette %s', (paletteId) => {
    const sheet = themeStyleSheet(loadTheme(paletteId));
    const vars = reducedVariables(sheet);

    it('la feuille du thème met chaque durée de mouvement à 0s et l’échelle d’appui à 1', () => {
      const motionDurations = [...sheet.matchAll(/--(motion-duration-[\w-]+):/g)].map((m) => m[1]);
      expect(motionDurations.length).toBeGreaterThan(0);
      for (const v of motionDurations) expect(vars.get(`--${v}`), v).toBe('0s');
      expect(vars.get('--motion-scale-press')).toBe('1');
    });

    it.each(animated.map((f) => [f.file, f.css] as const))(
      '%s : avec le mouvement réduit, transitions à 0 et animations à none',
      (_file, css) => {
        const blocks = cssRuleBlocks(css);
        const stoppedSelectors = new Set(
          blocks
            .filter((b) => b.conditions.some(isReduce))
            .filter((b) =>
              b.decls.some((d) => /^animation(-name)?$/.test(d.prop) && d.value === 'none'),
            )
            .flatMap((b) => b.selectors),
        );
        let checked = 0;
        for (const b of blocks.filter((x) => !x.conditions.some(isReduce))) {
          for (const d of b.decls.filter((x) => MOTION_PROPS.test(x.prop))) {
            checked += 1;
            if (/^animation(-name)?$/.test(d.prop) && d.value !== 'none') {
              for (const s of b.selectors) expect(stoppedSelectors.has(s), `${s} animé`).toBe(true);
              continue;
            }
            const times = durations(d.value, vars);
            expect(times.length, `${b.selectors.join(', ')} ${d.prop}`).toBeGreaterThan(0);
            for (const t of times)
              expect(t, `${b.selectors.join(', ')} ${d.prop}: ${d.value}`).toMatch(/^0(\.0+)?m?s$/);
          }
        }
        expect(checked).toBeGreaterThan(0);
      },
    );
  });

  it('les règles de base coupent toute animation et toute transition restantes', () => {
    const rule =
      /@media \(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{([^}]*)\}\}/.exec(
        BASE_CSS,
      )?.[1] ?? '';
    expect(rule).toContain('animation-duration:0s!important');
    expect(rule).toContain('animation-iteration-count:1!important');
    expect(rule).toContain('transition-duration:0s!important');
    expect(rule).toContain('scroll-behavior:auto!important');
  });

  it('le lint du mouvement réduit ne relève rien dans packages/ui (CSS et scripts)', () => {
    const findings = files(UI_SRC, /\.(css|tsx?)$/).flatMap((path) =>
      scanReducedMotion(readFileSync(path, 'utf8'), path.endsWith('.css') ? 'css' : 'ts').map(
        (f) => `${name(path)}:${f.line} ${f.text}`,
      ),
    );
    expect(findings).toEqual([]);
  });

  it.each(animated.filter((f) => /@keyframes/.test(f.css)).map((f) => [f.file, f.css] as const))(
    'mutation : %s sans son bloc reduce fait échouer le lint',
    (_file, css) => {
      expect(scanReducedMotion(css, 'css')).toEqual([]);
      const mutated = css.replace(
        /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n?/g,
        '',
      );
      expect(mutated).not.toBe(css);
      expect(scanReducedMotion(mutated, 'css').map((f) => f.rule)).toContain('reduced-motion');
    },
  );
});
