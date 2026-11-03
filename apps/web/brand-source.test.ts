import { readFileSync } from 'node:fs';
import { paletteDocument } from '@rueda/design-tokens';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BRAND_CACHE_TTL_MS,
  brandApiUrl,
  brandFromPublished,
  embeddedBrand,
  getRequestBrand,
  resetBrandCache,
  validBrandName,
} from './brand-source.ts';

// Oracle : le fichier de palette lui-même (docs/design/US-028), pas le code testé.
const tinta = JSON.parse(
  readFileSync(
    new URL('../../docs/design/US-028/tokens-lienzo-tinta.json', import.meta.url),
    'utf8',
  ),
) as {
  brand: { name: { $value: string }; logo: { $value: string } };
  color: Record<string, unknown>;
};

const API = { WEB_BRAND_API_URL: 'http://api.test:3001' };

function published(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    versionId: 'v',
    versionNo: 7,
    brandName: 'Otro',
    tokensSchemaVersion: 1,
    tokens: paletteDocument('lienzo-grafito'),
    css: '/* css-recu-du-serveur */',
    ...overrides,
  };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => resetBrandCache());

describe('marque embarquée (US-034 non configurée)', () => {
  it('nom et logo lus dans le groupe brand de la palette active (DEC-MARQUE)', () => {
    const brand = embeddedBrand({});
    expect(brand.name).toBe(tinta.brand.name.$value);
    expect(brand.logo.light).toBe(tinta.brand.logo.$value);
    expect(brand.source).toBe('embedded');
    expect(brand.active.css).toContain('--color-primary:');
  });

  it('suit la palette choisie par THEME_PALETTE', () => {
    expect(embeddedBrand({ THEME_PALETTE: 'lienzo-grafito' }).active.theme.id).toBe(
      'lienzo-grafito',
    );
  });
});

describe('version publiée par GET /brand', () => {
  it('nom publié, thème recompilé ici (le CSS reçu n’est jamais réinjecté)', () => {
    const brand = brandFromPublished(published(), {});
    expect(brand?.name).toBe('Otro');
    expect(brand?.source).toBe('published');
    expect(brand?.version).toBe('brand-7');
    expect(brand?.active.css).not.toContain('css-recu-du-serveur');
    expect(brand?.active.theme.id).toBe('lienzo-grafito');
  });

  it('refuse (fail-closed) un document invalide, un contraste insuffisant ou un nom douteux', () => {
    expect(brandFromPublished(published({ tokens: { color: {} } }), {})).toBeUndefined();
    // Azur échoue au contraste AA (passation US-030) : refusée ici aussi.
    expect(
      brandFromPublished(published({ tokens: paletteDocument('lienzo-azur') }), {}),
    ).toBeUndefined();
    expect(brandFromPublished(published({ brandName: '<img>' }), {})).toBeUndefined();
    expect(brandFromPublished(published({ versionNo: 'x' }), {})).toBeUndefined();
    expect(brandFromPublished(null, {})).toBeUndefined();
  });

  it('API configurée et disponible : la version publiée est servie, puis gardée en cache', async () => {
    let calls = 0;
    let now = 1_000;
    const fetcher = async (url: string) => {
      calls += 1;
      expect(url).toBe('http://api.test:3001/brand');
      return jsonResponse(published());
    };
    expect((await getRequestBrand(API, fetcher, () => now)).name).toBe('Otro');
    now += BRAND_CACHE_TTL_MS - 1;
    await getRequestBrand(API, fetcher, () => now);
    expect(calls).toBe(1);
    now += 2;
    await getRequestBrand(API, fetcher, () => now);
    expect(calls).toBe(2);
  });

  it('503 BRAND_VERSION_UNAVAILABLE, panne ou réponse invalide : thème embarqué', async () => {
    const embedded = tinta.brand.name.$value;
    const cases = [
      async () => jsonResponse({ code: 'BRAND_VERSION_UNAVAILABLE' }, 503),
      async () => {
        throw new Error('ECONNREFUSED');
      },
      async () => new Response('pas du JSON'),
      async () => jsonResponse(published({ tokens: paletteDocument('lienzo-azur') })),
    ];
    for (const fetcher of cases) {
      resetBrandCache();
      const brand = await getRequestBrand(API, fetcher);
      expect(brand.source).toBe('embedded');
      expect(brand.name).toBe(embedded);
    }
  });

  it('URL de l’API : http(s) seulement, sans identifiants', () => {
    expect(brandApiUrl({})).toBeUndefined();
    expect(brandApiUrl({ WEB_BRAND_API_URL: 'ftp://x' })).toBeUndefined();
    expect(brandApiUrl({ WEB_BRAND_API_URL: 'http://u:p@x' })).toBeUndefined();
    expect(brandApiUrl({ WEB_BRAND_API_URL: 'pas une url' })).toBeUndefined();
    expect(brandApiUrl({ WEB_BRAND_API_URL: 'https://api.test/v1' })?.href).toBe(
      'https://api.test/v1',
    );
  });

  it('nom de marque : court, sans balise ni caractère de contrôle', () => {
    expect(validBrandName(' Kmino ')).toBe('Kmino');
    expect(validBrandName('')).toBeUndefined();
    expect(validBrandName('a'.repeat(41))).toBeUndefined();
    expect(validBrandName('K\u0000')).toBeUndefined();
    expect(validBrandName('{brand_name}')).toBeUndefined();
    expect(validBrandName(42)).toBeUndefined();
  });
});
