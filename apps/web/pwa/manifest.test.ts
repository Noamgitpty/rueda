import { readFileSync } from 'node:fs';
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { paletteDocument } from '@rueda/design-tokens';
import { describe, expect, it } from 'vitest';
import { brandFromPublished, embeddedBrand } from '../brand-source.ts';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { iconSpec, initialOf, splitInitial } from './icon.tsx';
import { buildWebManifest, PWA_ICON_NAMES } from './manifest.ts';

// Oracle : le fichier de palette (docs/design/US-028), lu tel quel.
const tinta = JSON.parse(
  readFileSync(
    new URL('../../../docs/design/US-028/tokens-lienzo-tinta.json', import.meta.url),
    'utf8',
  ),
) as { color: { light: Record<string, { $value: string }> } };

// Critère US-048 : « nom, icônes et couleurs viennent du thème (US-034) ».
describe('manifeste de l’application installable', () => {
  const brand = embeddedBrand({});

  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))('%s', (_tag, profile) => {
    const m = buildWebManifest(brand, createTranslator(profile));
    expect(m['name']).toBe(brand.name);
    expect(m['short_name']).toBe(brand.name);
    expect(m['lang']).toBe(profile.tag);
    expect(m['description']).toBe(CATALOGS[profile.language].messages['web.home.tagline']);
    expect(m['display']).toBe('standalone');
    expect(m['start_url']).toBe('/');
    expect(m['scope']).toBe('/');
  });

  it('couleurs = jetons de la palette Tinta (fichier DTCG, pas le code testé)', () => {
    const tintaBrand = embeddedBrand({ THEME_PALETTE: 'lienzo-tinta' });
    const m = buildWebManifest(tintaBrand, createTranslator(LOCALE_CONFIG.locales[0]!));
    expect(String(m['theme_color']).toUpperCase()).toBe(tinta.color.light['primary']!.$value);
    expect(String(m['background_color']).toUpperCase()).toBe(tinta.color.light['surface']!.$value);
  });

  it('icônes PNG 192 et 512 (« any ») et 512 « maskable », versionnées par la marque', () => {
    const icons = buildWebManifest(brand, createTranslator(LOCALE_CONFIG.locales[0]!))['icons'] as {
      src: string;
      sizes: string;
      purpose: string;
      type: string;
    }[];
    expect(icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
    for (const icon of icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.src).toContain(`v=${encodeURIComponent(brand.version)}`);
    }
  });

  it('une marque publiée change nom, couleurs et adresses des icônes', () => {
    const other = brandFromPublished(
      { brandName: 'Otro', versionNo: 3, tokens: paletteDocument('lienzo-grafito') },
      {},
    )!;
    const m = buildWebManifest(other, createTranslator(LOCALE_CONFIG.locales[0]!));
    expect(m['name']).toBe('Otro');
    expect(m['theme_color']).toBe(other.active.theme.colors.light.primary);
    expect(JSON.stringify(m['icons'])).toContain('v=brand-3');
  });
});

describe('icônes dessinées depuis la marque', () => {
  const brand = embeddedBrand({});

  it.each(PWA_ICON_NAMES)('%s : couleurs du thème, logo dans la zone sûre', (name) => {
    const spec = iconSpec(name, brand);
    expect(spec.background).toBe(brand.active.theme.colors.light.primary);
    expect(spec.foreground).toBe(brand.active.theme.colors.light['on-primary']);
    expect(spec.logoUri?.startsWith('data:image/svg+xml')).toBe(true);
    if (spec.fullBleed) expect(spec.logoSize).toBeLessThanOrEqual(spec.size * 0.8);
  });

  it('maskable et Apple : fond plein ; « any » : logo seul', () => {
    expect(iconSpec('maskable-512.png', brand).fullBleed).toBe(true);
    expect(iconSpec('apple-touch-icon.png', brand).fullBleed).toBe(true);
    expect(iconSpec('icon-512.png', brand).fullBleed).toBe(false);
  });

  it('sans logo : initiale sur fond plein', () => {
    const bare = { ...brand, logo: {} };
    const spec = iconSpec('icon-192.png', bare);
    expect(spec.fullBleed).toBe(true);
    expect(spec.logoUri).toBeUndefined();
    expect(spec.initial).toBe('K');
  });

  it('initiale : premier graphème, accents et emoji compris', () => {
    expect(splitInitial('Kmino')).toEqual(['K', 'mino']);
    expect(initialOf('éxito')).toBe('É');
    expect(splitInitial('🚗car')).toEqual(['🚗', 'car']);
  });
});
