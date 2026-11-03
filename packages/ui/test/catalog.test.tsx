import { readFileSync } from 'node:fs';
import { CATALOGS } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { describe, expect, it } from 'vitest';
import * as ui from '../src/index.ts';
import { ComponentCatalog } from '../src/catalog/index.ts';
import { LOCALES, axeViolations, describeViolations, page, render, textOf } from './helpers.tsx';

// Critères US-032 : chaque composant dans ses états (normal, vide, chargement, erreur, désactivé),
// en es, en, fr et pt (DEC-FONDATEUR-17, 18), à 360 px ; 0 violation WCAG 2.2 AA bloquante.
describe('vitrine : chaque locale', () => {
  it.each(LOCALES)('%s : aucune violation axe (WCAG 2.0 à 2.2, A et AA)', async (tag, _p, i18n) => {
    for (const mobile of [false, true]) {
      const html = page(render(<ComponentCatalog i18n={i18n} mobile={mobile} />), tag);
      const violations = await axeViolations(html);
      expect(describeViolations(violations)).toEqual([]);
    }
  });

  it.each(LOCALES)(
    '%s : une vue = une langue, aucune variable non résolue',
    (_tag, profile, i18n) => {
      const html = render(<ComponentCatalog i18n={i18n} />);
      const text = textOf(html);
      expect(findForeignStrings(text, profile.language)).toEqual([]);
      expect(text).toContain(CATALOGS[profile.language].messages['web.catalog.title']);
      // Jamais de « {x} », « undefined », « NaN » ni « null » affichés (10b UX-60).
      expect(text).not.toMatch(/\{[\w.]+\}|\bundefined\b|\bNaN\b|\bnull\b/);
    },
  );

  it('les quatre langues donnent quatre rendus différents', () => {
    const texts = new Map<string, string>();
    for (const [, profile, i18n] of LOCALES) {
      texts.set(profile.language, textOf(render(<ComponentCatalog i18n={i18n} />)));
    }
    expect(new Set(texts.values()).size).toBe(4);
  });

  it('montre chaque composant exporté par la bibliothèque', () => {
    const source = readFileSync(new URL('../src/catalog/catalog.tsx', import.meta.url), 'utf8');
    const components = Object.entries(ui)
      .filter(([name, value]) => typeof value === 'function' && /^[A-Z]/.test(name))
      .map(([name]) => name)
      // Icon et CarIllustration et Skeleton sont montrés à travers les autres composants.
      .filter((name) => !['Icon', 'CarIllustration', 'Skeleton'].includes(name));
    const missing = components.filter((name) => !source.includes(`<${name}`));
    expect(missing).toEqual([]);
  });

  it('montre les cinq états demandés', () => {
    const source = readFileSync(new URL('../src/catalog/catalog.tsx', import.meta.url), 'utf8');
    for (const s of ['normal', 'empty', 'loading', 'error', 'disabled']) {
      expect(source).toContain(`state.${s}}`);
    }
  });
});

// Preuve que le harnais détecte une faute : sans elle, « 0 violation » ne prouverait rien.
describe('harnais axe', () => {
  it('signale un champ sans libellé et un bouton sans nom', async () => {
    const html = page('<input type="text"><button type="button"></button>', 'es');
    const ids = (await axeViolations(html)).map((v) => v.id).sort();
    expect(ids).toEqual(['button-name', 'label']);
  });
});
