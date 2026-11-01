import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { HomeContent } from './home-content.tsx';

// Critère US-014 : aucune chaîne d'une autre langue sur l'écran, dans chaque locale configurée.
describe('accueil du back-office : une vue = une langue', () => {
  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))('%s', (_tag, profile) => {
    const html = renderToStaticMarkup(<HomeContent i18n={createTranslator(profile)} />);
    expect(html).toContain(CATALOGS[profile.language].messages['backoffice.home.intro']);
    expect(findForeignStrings(html, profile.language)).toEqual([]);
  });
});
