import { readFileSync } from 'node:fs';
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { embeddedBrand } from '../../../brand-source.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import { HomeContent } from '../../home-content.tsx';
import { OfflineContent } from '../offline/offline-content.tsx';
import { retryTarget } from '../offline/offline-retry.tsx';
import { AppShell, MAIN_ID } from './app-shell.tsx';

const brand = embeddedBrand({});
const LOCALES = LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const);

function render(profile: (typeof LOCALE_CONFIG.locales)[number], screen: 'home' | 'offline') {
  const i18n = createTranslator(profile);
  return decode(
    renderToStaticMarkup(
      <AppShell brand={brand} i18n={i18n} locales={LOCALE_CONFIG.locales} serviceWorker={false}>
        {screen === 'home' ? <HomeContent i18n={i18n} /> : <OfflineContent i18n={i18n} />}
      </AppShell>,
    ),
  );
}

/** Texte rendu, entités HTML décodées (« You&#x27;re » → « You're »). */
function decode(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Texte visible sans les noms de langue du sélecteur (écrits dans leur langue, avec `lang`). */
function withoutLanguageNames(html: string): string {
  return html.replace(/<button[^>]*name="locale"[^>]*>[^<]*<\/button>/g, '');
}

describe('coquille : une vue = une langue, dans les quatre langues', () => {
  it.each(LOCALES)('%s, accueil et écran hors ligne', (_tag, profile) => {
    const messages = CATALOGS[profile.language].messages;
    for (const screen of ['home', 'offline'] as const) {
      const html = render(profile, screen);
      expect(findForeignStrings(withoutLanguageNames(html), profile.language)).toEqual([]);
      expect(html).toContain(messages['web.shell.skipToContent']);
    }
    expect(render(profile, 'home')).toContain(messages['web.s01.title']);
    expect(render(profile, 'offline')).toContain(messages['web.offline.title']);
  });
});

describe('structure accessible (WCAG 2.2 AA)', () => {
  const profile = LOCALE_CONFIG.locales[0]!;
  const html = render(profile, 'home');

  it('le lien d’évitement est le premier lien et vise le contenu principal', () => {
    expect(/<a [^>]*>/.exec(html)?.[0]).toContain(`href="#${MAIN_ID}"`);
    expect(html).toContain(`<main id="${MAIN_ID}"`);
  });

  it('marque : nom de la marque du thème, nom accessible du catalogue', () => {
    expect(html).toContain(
      `aria-label="${CATALOGS[profile.language].messages['web.shell.homeLink'].toString().replace('{brand}', brand.name)}"`,
    );
    expect(html).not.toContain('{brand_name}');
  });

  it('choix de langue : toutes les locales de la configuration, avec `lang`, courante marquée', () => {
    for (const p of LOCALE_CONFIG.locales) {
      expect(html).toContain(`value="${p.tag}" lang="${p.tag}"`);
    }
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('action="/locale"');
  });

  it('région live des changements de réseau présente dès le rendu (UX-48)', () => {
    expect(html).toMatch(/role="status" aria-live="polite"/);
  });

  it('un seul titre de niveau 1 par écran', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(render(profile, 'offline').match(/<h1/g)).toHaveLength(1);
  });
});

describe('reprise de l’écran hors ligne', () => {
  it('recharge l’adresse demandée, ou l’accueil depuis /offline', () => {
    expect(retryTarget('/viajes/1', '?a=1')).toBe('/viajes/1?a=1');
    expect(retryTarget('/offline', '')).toBe('/');
  });
});

// Critère « cibles tactiles ≥ 44 px » : chaque contrôle de la coquille réserve la cible du thème
// (48 px, `size.touchTarget`) ; mesuré aussi à 360 px par apps/web/scripts/shell-check.mjs.
describe('styles de la coquille', () => {
  const css = readFileSync(new URL('./shell.module.css', import.meta.url), 'utf8');
  const block = (selector: string) =>
    new RegExp(`\\n\\.${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  it.each(['skip', 'brand', 'languageToggle', 'languageOption'])(
    '.%s : cible tactile du thème',
    (selector) => {
      expect(block(selector)).toContain('min-block-size: var(--size-touch-target)');
    },
  );

  it('mouvement réduit : le panneau de langue ne s’anime pas', () => {
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)[\s\S]*\.languagePanel \{\s*animation: none/,
    );
  });

  it('jeton de touche ≥ 44 px dans le thème', () => {
    const px = Number(/--size-touch-target:(\d+)px/.exec(brand.active.css)?.[1]);
    expect(px).toBeGreaterThanOrEqual(44);
  });
});
