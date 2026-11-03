import { describe, expect, it } from 'vitest';
import { buildTheme, loadTheme, themeStyleSheet, ThemeFormatError } from '../src/index.ts';
import { patch, tinta } from './helpers.ts';

const problems = (palette: unknown, overrides?: unknown): string[] => {
  try {
    buildTheme(palette, overrides);
  } catch (error) {
    if (error instanceof ThemeFormatError) return [...error.problems];
    throw error;
  }
  return [];
};

describe('validation des jetons (fail-closed)', () => {
  it('refuse une valeur qui sortirait du bloc CSS', () => {
    const evil = patch(tinta(), 'color.light.primary.$value', '#1D3461;}body{display:none');
    expect(problems(evil).join()).toMatch(/color\.light\.primary/);
    const shadow = patch(tinta(), 'shadow.raised.$value', '0 1px 2px red;}</style><script>');
    expect(problems(shadow).join()).toMatch(/shadow\.raised/);
    const font = patch(tinta(), 'font.family.body.$value', ['Manrope";}', 'sans-serif']);
    expect(problems(font).join()).toMatch(/font\.family\.body/);
  });

  it('refuse un type inconnu', () => {
    expect(problems(patch(tinta(), 'space.4.$type', 'gradient')).join()).toMatch(
      /type "gradient" refusé/,
    );
  });

  it('refuse un jeton requis absent', () => {
    expect(problems(patch(tinta(), 'color.dark.focus', undefined))).toContain(
      'color.dark.focus : jeton requis absent',
    );
    expect(problems(patch(tinta(), 'radius.md', undefined))).toContain(
      'radius.md : jeton requis absent',
    );
  });

  it('refuse un alias vers un jeton absent ou circulaire', () => {
    expect(problems(patch(tinta(), 'radius.card.$value', '{radius.huge}')).join()).toMatch(/alias/);
    const loop = patch(
      patch(tinta(), 'radius.card.$value', '{radius.sm}'),
      'radius.sm.$value',
      '{radius.card}',
    );
    expect(problems(loop).join()).toMatch(/alias circulaire/);
  });

  it('refuse une palette sans identifiant ni version', () => {
    expect(problems(patch(tinta(), 'meta', undefined))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/meta\.direction/),
        expect.stringMatching(/meta\.version/),
      ]),
    );
  });

  it('complète une palette ancienne par le socle, en alias vers ses propres jetons', () => {
    const cielo = loadTheme('marina');
    expect(cielo.colors.light['avatar-1']).toBe(cielo.colors.light.accent);
    expect(cielo.tokens.find((t) => t.name === 'radius-card')?.light).toBe(
      cielo.tokens.find((t) => t.name === 'radius-lg')?.light,
    );
  });
});

// Critère US-030 : « Given un changement de jeton publié, When une page est rechargée, Then le
// nouveau rendu s'applique sans déploiement. » Les surcharges sont la forme que prendra la version
// publiée (US-034) ; la page recalcule la feuille à chaque rendu.
describe('retouche publiée (surcharges)', () => {
  it('une surcharge de couleur change la feuille générée', () => {
    const touched = loadTheme('lienzo-tinta', {
      color: { light: { primary: { $value: '#22406F', $type: 'color' } } },
    });
    expect(themeStyleSheet(touched)).toContain('--color-primary:#22406F;');
    expect(touched.colors.dark.primary).toBe('#A9C1EA');
  });

  it('une surcharge non conforme est refusée comme une palette', () => {
    expect(() =>
      loadTheme('lienzo-tinta', {
        color: { light: { text: { $value: '#C0C0C0', $type: 'color' } } },
      }),
    ).toThrow(/text \/ surface/);
  });
});
