import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import {
  UI_CATALOG_FLAG,
  catalogHref,
  isUiCatalogEnabled,
  parseCatalogOptions,
} from './catalog-options.ts';

const TAGS = LOCALE_CONFIG.locales.map((p) => p.tag);

describe('vitrine US-032 : drapeau', () => {
  it('fermée par défaut hors développement (fail-closed)', () => {
    expect(isUiCatalogEnabled({})).toBe(false);
    expect(isUiCatalogEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(isUiCatalogEnabled({ [UI_CATALOG_FLAG]: 'TRUE' })).toBe(false);
    expect(isUiCatalogEnabled({ [UI_CATALOG_FLAG]: '1' })).toBe(false);
  });

  it('ouverte par `true` exactement, ou en développement', () => {
    expect(isUiCatalogEnabled({ [UI_CATALOG_FLAG]: 'true', NODE_ENV: 'production' })).toBe(true);
    expect(isUiCatalogEnabled({ NODE_ENV: 'development' })).toBe(true);
  });
});

describe('vitrine US-032 : paramètres', () => {
  it('locale déclarée seulement ; thème et largeur bornés', () => {
    const fr = TAGS.find((t) => t === 'fr');
    expect(parseCatalogOptions({ lang: fr, theme: 'dark', width: 'full' }, TAGS)).toEqual({
      locale: fr,
      theme: 'dark',
      width: 'full',
    });
    expect(parseCatalogOptions({ lang: 'xx', theme: 'neon', width: '9' }, TAGS)).toEqual({
      locale: undefined,
      theme: 'auto',
      width: 'mobile',
    });
    expect(parseCatalogOptions({ lang: [TAGS[0]!, 'xx'] }, TAGS).locale).toBe(TAGS[0]);
    // portugais du Brésil (DEC-FONDATEUR-18) : servi par la configuration, sans code dédié
    expect(TAGS).toContain('pt');
    expect(parseCatalogOptions({ lang: 'pt' }, TAGS).locale).toBe('pt');
    expect(parseCatalogOptions({ lang: 'pt-BR' }, TAGS).locale).toBeUndefined();
  });

  it('liens : seuls les écarts au défaut figurent dans l’URL', () => {
    const base = { locale: undefined, theme: 'auto', width: 'mobile' } as const;
    expect(catalogHref(base, {})).toBe('?');
    expect(catalogHref(base, { theme: 'dark' })).toBe('?theme=dark');
    expect(catalogHref(base, { locale: 'en', width: 'full' })).toBe('?lang=en&width=full');
  });
});
