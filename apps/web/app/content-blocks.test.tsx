/**
 * Blocs éditables côté site (US-121, ADR-095). Attendus : 19 US-121 (critère 1 : nouveau texte au
 * rechargement, sans déploiement ; critère 2 : jamais un bloc vide), 10b UX-58 et US-014 (une vue
 * = une langue : le texte du catalogue livré remplace un bloc absent dans la langue), catalogue
 * `@rueda/i18n` (10b §4.3) pour les textes de repli. Charges d'injection : OWASP XSS Filter
 * Evasion.
 */
import { CATALOGS, createTranslator, getProfile } from '@rueda/i18n';
import type { RichDoc } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { HomeContent } from './home-content.tsx';
import {
  CONTENT_CACHE_TTL_MS,
  contentFromResponse,
  countryOf,
  getRequestContent,
  NO_CONTENT,
  pageDescription,
  resetContentCache,
} from '../content-source.ts';
import { LOCALE_CONFIG } from '../locale-config.ts';
import nextConfig from '../next.config.ts';
import { contentSecurityPolicy, securityHeaders } from '../security-headers.ts';

const API = { WEB_BRAND_API_URL: 'http://api.test:3001' };
const plain = (text: string): RichDoc => ({ format: 'plain', text });
const view = (key: string, locale: string, doc: unknown, fallback = false) => ({
  key,
  locale,
  country: null,
  versionNo: 2,
  bodyMd: 'ignoré par le site',
  assetId: null,
  format: (doc as { format?: string }).format,
  doc,
  fallback,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const i18nOf = (tag: string) => createTranslator(getProfile(LOCALE_CONFIG, tag));
// locales régionales de la configuration (es-xx), sans constante de pays dans le test
const REGIONAL = LOCALE_CONFIG.locales.filter((p) => /^[a-z]{2}-[A-Z]{2}$/.test(p.tag));
const ES_REGIONAL = REGIONAL.find((p) => p.language === 'es')?.tag ?? 'es';

afterEach(() => resetContentCache());

describe('contentFromResponse : liste blanche et revalidation', () => {
  it('bloc du registre, dans la langue de la page : remplace le texte du catalogue visé', () => {
    const c = contentFromResponse(
      { locale: 'fr', blocks: [view('home.hero.title', 'fr', plain('Nouveau titre'))] },
      'fr',
    );
    expect(c.get('web.s01.title')).toEqual(plain('Nouveau titre'));
  });

  it.each([
    ['repli es signalé par l’API (fallback)', view('home.hero.title', 'es', plain('Hola'), true)],
    ['autre langue', view('home.hero.title', 'es', plain('Hola'))],
    ['clé hors registre', view('home.evil.title', 'fr', plain('x'))],
    ['format inattendu', view('home.hero.title', 'fr', { format: 'rich', blocks: [] })],
    [
      'arbre avec nœud html',
      view('home.owner.body', 'fr', { format: 'rich', blocks: [{ t: 'html', v: '<script>' }] }),
    ],
    [
      'lien javascript:',
      view('home.owner.body', 'fr', {
        format: 'rich',
        blocks: [{ t: 'p', c: [{ t: 'link', v: 'x', href: 'javascript:alert(1)' }] }],
      }),
    ],
    ['texte trop long', view('home.hero.title', 'fr', plain('x'.repeat(81)))],
    ['clé héritée de l’objet', view('constructor', 'fr', plain('x'))],
  ])('%s : ignoré (catalogue)', (_label, block) => {
    expect(contentFromResponse({ locale: 'fr', blocks: [block] }, 'fr').size).toBe(0);
  });

  it('réponse d’une autre langue ou mal formée : aucun bloc', () => {
    expect(contentFromResponse({ locale: 'es', blocks: [] }, 'fr')).toBe(NO_CONTENT);
    for (const body of [null, [], 'x', { locale: 'fr' }, { locale: 'fr', blocks: {} }]) {
      expect(contentFromResponse(body, 'fr').size).toBe(0);
    }
  });

  it('pays : région de l’étiquette de locale seulement (aucune constante de pays)', () => {
    expect(REGIONAL.length).toBeGreaterThan(0);
    for (const p of REGIONAL) expect(countryOf(p.tag)).toBe(p.tag.slice(-2));
    expect(countryOf('es')).toBeNull();
    expect(countryOf('en')).toBeNull();
    expect(countryOf('pt')).toBeNull();
  });
});

describe('getRequestContent : sans déploiement, fail-closed', () => {
  it('critère 1 : bloc republié ⇒ nouveau texte au rechargement suivant le TTL', async () => {
    let title = 'Primer título';
    const urls: string[] = [];
    const fetcher = (url: string) => {
      urls.push(url);
      return Promise.resolve(
        json({ locale: 'es', blocks: [view('home.hero.title', 'es', plain(title))] }),
      );
    };
    let now = 0;
    const i18n = i18nOf(ES_REGIONAL);
    expect((await getRequestContent(i18n, API, fetcher, () => now)).get('web.s01.title')).toEqual(
      plain('Primer título'),
    );
    expect(urls).toEqual([
      `http://api.test:3001/brand/content?locale=es&country=${ES_REGIONAL.slice(-2)}`,
    ]);
    title = 'Segundo título';
    now = CONTENT_CACHE_TTL_MS;
    expect((await getRequestContent(i18n, API, fetcher, () => now)).get('web.s01.title')).toEqual(
      plain('Segundo título'),
    );
  });

  it('sans WEB_BRAND_API_URL, API en erreur, injoignable ou JSON invalide : aucun bloc', async () => {
    const i18n = i18nOf('en');
    expect(await getRequestContent(i18n, {}, () => Promise.reject(new Error('x')))).toBe(
      NO_CONTENT,
    );
    for (const fetcher of [
      () => Promise.resolve(json({ code: 'X' }, 503)),
      () => Promise.reject(new Error('réseau')),
      () => Promise.resolve(new Response('<html>', { status: 200 })),
    ]) {
      resetContentCache();
      expect((await getRequestContent(i18n, API, fetcher)).size).toBe(0);
    }
  });
});

describe('accueil avec blocs (critères 1 et 2)', () => {
  it('bloc publié dans la langue : affiché à la place du texte livré', () => {
    const content = new Map([['web.s01.title', plain('Un título nuevo')]] as const);
    const html = renderToStaticMarkup(<HomeContent i18n={i18nOf(ES_REGIONAL)} content={content} />);
    expect(html).toContain('Un título nuevo');
    expect(html).not.toContain(CATALOGS.es.messages['web.s01.title']);
  });

  it.each(LOCALE_CONFIG.locales.map((p) => p.tag))(
    'critère 2 (%s) : bloc publié en es seulement ⇒ texte livré dans la langue, jamais vide ni mêlé',
    (tag) => {
      const i18n = i18nOf(tag);
      const language = i18n.profile.language;
      // ce que l'API rend pour un bloc publié en es seulement : la version es marquée fallback
      const content = contentFromResponse(
        {
          locale: language,
          blocks: [view('home.hero.title', 'es', plain('Solo en español'), language !== 'es')],
        },
        language,
      );
      const html = renderToStaticMarkup(<HomeContent i18n={i18n} content={content} />);
      if (language === 'es') {
        expect(html).toContain('Solo en español');
      } else {
        expect(html).not.toContain('Solo en español');
        expect(html).toContain(CATALOGS[language].messages['web.s01.title']);
        expect(findForeignStrings(html, language)).toEqual([]);
      }
    },
  );

  it('bloc rich : paragraphes et lien interne rendus en éléments ; aucune balise injectée', () => {
    const doc: RichDoc = {
      format: 'rich',
      blocks: [
        {
          t: 'p',
          c: [
            { t: 'text', v: '<img src=x onerror=alert(1)> Gana ' },
            { t: 'strong', v: 'más' },
            { t: 'text', v: ' — ' },
            { t: 'link', v: 'cómo', href: '/hosts' },
          ],
        },
        { t: 'ul', items: [[{ t: 'em', v: 'uno' }]] },
      ],
    };
    const html = renderToStaticMarkup(
      <HomeContent i18n={i18nOf(ES_REGIONAL)} content={new Map([['web.s01.owner.body', doc]])} />,
    );
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; Gana <strong>más</strong>');
    expect(html).toMatch(/<a class="[^"]*" href="\/hosts">cómo<\/a>/);
    expect(html).toContain('<ul');
    expect(html).not.toContain('<img');
  });
});

describe('description de la page (métadonnées du layout)', () => {
  it.each(LOCALE_CONFIG.locales.map((p) => p.tag))(
    '%s : accroche publiée dans la langue de la page, sinon catalogue de cette langue',
    (tag) => {
      const i18n = i18nOf(tag);
      const language = i18n.profile.language;
      expect(pageDescription(i18n, NO_CONTENT)).toBe(
        CATALOGS[language].messages['web.home.tagline'],
      );
      const published = contentFromResponse(
        {
          locale: language,
          blocks: [view('home.hero.tagline', language, plain('Accroche publiée'))],
        },
        language,
      );
      expect(pageDescription(i18n, published)).toBe('Accroche publiée');
      // bloc d'une autre langue (repli es de l'API) : jamais dans la description
      const fallback = contentFromResponse(
        {
          locale: language,
          blocks: [view('home.hero.tagline', 'es', plain('Solo es'), language !== 'es')],
        },
        language,
      );
      expect(pageDescription(i18n, fallback)).toBe(
        language === 'es' ? 'Solo es' : CATALOGS[language].messages['web.home.tagline'],
      );
    },
  );
});

describe('en-têtes de sécurité du site (CSP renforcée, US-121)', () => {
  const byKey = (headers: readonly { key: string; value: string }[]) =>
    Object.fromEntries(headers.map((h) => [h.key.toLowerCase(), h.value]));

  it('production : rien d’une autre origine, ni objet, ni base, ni cadre ; pas de unsafe-eval', () => {
    const csp = contentSecurityPolicy(true);
    for (const d of [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]) {
      expect(csp).toContain(d);
    }
    expect(csp).not.toMatch(/unsafe-eval|ws:|https?:|\*/);
    const h = byKey(securityHeaders(true));
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['permissions-policy']).toContain('microphone=()');
  });

  it('next.config applique ces en-têtes à toutes les routes', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const all = rules.find((r) => r.source === '/:path*');
    expect(byKey(all?.headers ?? [])['content-security-policy']).toBeDefined();
  });
});
