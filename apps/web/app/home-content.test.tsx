import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { HomeContent } from './home-content.tsx';

// Critère US-014 : « Given un écran en es, When le test automatisé le parcourt, Then aucune
// chaîne anglaise (et réciproquement) ». Parcourt l'accueil dans chaque locale configurée.
describe('accueil : une vue = une langue', () => {
  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))('%s', (_tag, profile) => {
    const html = renderToStaticMarkup(<HomeContent i18n={createTranslator(profile)} />);
    expect(html).toContain(CATALOGS[profile.language].messages['web.home.tagline']);
    expect(findForeignStrings(html, profile.language)).toEqual([]);
  });
});
