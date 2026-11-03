import { describe, expect, it } from 'vitest';
import { CATALOGS, CATALOG_LANGUAGES, CATALOG_VERSION, createTranslator } from '../src/index.ts';
import type { Catalog } from '../src/index.ts';
import { compareCatalogs, findForeignStrings } from '../src/testing/index.ts';
import { CONFIG, profile } from './helpers.ts';

describe('parité des catalogues (16 NFR-11 : clé manquante = échec)', () => {
  it('en a exactement les clés, pluriels et emplacements de es (qui fait foi)', () => {
    expect(compareCatalogs(CATALOGS.es.messages, CATALOGS.en.messages)).toEqual([]);
  });

  it('fr a exactement les clés, pluriels et emplacements de es (DEC-FONDATEUR-17)', () => {
    expect(compareCatalogs(CATALOGS.es.messages, CATALOGS.fr.messages)).toEqual([]);
  });

  it('les trois catalogues sont deux à deux à parité', () => {
    for (const a of CATALOG_LANGUAGES) {
      for (const b of CATALOG_LANGUAGES) {
        expect(compareCatalogs(CATALOGS[a].messages, CATALOGS[b].messages)).toEqual([]);
      }
    }
  });

  it('es, en et fr partagent la version du catalogue', () => {
    expect(CATALOGS.es.version).toBe(CATALOG_VERSION);
    expect(CATALOGS.en.version).toBe(CATALOG_VERSION);
    expect(CATALOGS.fr.version).toBe(CATALOG_VERSION);
  });

  it('chaque langue de catalogue est servie par au moins une locale de la configuration', () => {
    for (const language of CATALOG_LANGUAGES) {
      expect(CONFIG.locales.some((p) => p.language === language)).toBe(true);
    }
  });

  it('chaque langue de la configuration a un catalogue', () => {
    for (const p of CONFIG.locales) expect(CATALOG_LANGUAGES).toContain(p.language);
  });

  it('détecte une clé manquante, une clé en trop, un emplacement ou un pluriel divergent', () => {
    const reference: Catalog = {
      'a.greeting': 'Hola {name}',
      'a.days': { one: '{count} día', other: '{count} días' },
      'a.only': 'Solo en es',
    };
    const candidate: Catalog = {
      'a.greeting': 'Hello {nom}',
      'a.days': 'days',
      'a.extra': 'Extra',
    };
    expect(compareCatalogs(reference, candidate)).toEqual([
      'clé manquante : a.only',
      'emplacements différents : a.greeting (name ≠ nom)',
      'pluriel incohérent : a.days',
      'emplacements différents : a.days (count ≠ )',
      'clé en trop : a.extra',
    ]);
  });

  it('détecte un message vide et une forme « other » absente', () => {
    const reference: Catalog = { k: 'x', p: { one: 'a', other: 'b' } };
    const candidate = { k: ' ', p: { one: 'a' } } as unknown as Catalog;
    expect(compareCatalogs(reference, candidate)).toEqual([
      'message vide : k',
      'forme « other » absente : p',
    ]);
  });

  it('surcharge régionale : sous-ensemble permis, clé inconnue refusée', () => {
    expect(
      compareCatalogs(CATALOGS.es.messages, { 'web.home.tagline': 'Otro' }, { partial: true }),
    ).toEqual([]);
    expect(compareCatalogs(CATALOGS.es.messages, { 'web.nope': 'x' }, { partial: true })).toEqual([
      'clé en trop : web.nope',
    ]);
  });

  it('les pluriels espagnols, anglais et français ont au moins « one » et « other »', () => {
    for (const language of CATALOG_LANGUAGES) {
      for (const message of Object.values(CATALOGS[language].messages)) {
        if (typeof message === 'object') {
          expect(message.one).toBeTypeOf('string');
          expect(message.other).toBeTypeOf('string');
        }
      }
    }
  });
});

describe('mélange de langues (« une vue = une langue », 10b UX-11)', () => {
  it('tous les messages d’une langue réunis ne contiennent aucune chaîne des deux autres', () => {
    for (const language of CATALOG_LANGUAGES) {
      const all = Object.values(CATALOGS[language].messages)
        .map((m) => (typeof m === 'string' ? m : Object.values(m).join(' | ')))
        .join(' | ');
      expect(findForeignStrings(all, language)).toEqual([]);
    }
  });

  it('écran rendu en français : aucune chaîne espagnole ni anglaise', () => {
    const t = createTranslator(profile('fr')).t;
    const rendered = [
      `<html lang="fr"><title>${t('backoffice.meta.title', { brand: 'Kmino' })}</title>`,
      `<label>${t('common.locale.switchLabel')}</label>`,
      `<p>${t('common.locale.current', { language: profile('fr').displayName })}</p>`,
      `<p>${t('web.home.tagline')}</p>`,
      `<p>${t('common.price.finalForDays', { count: 3 })}</p>`,
      `<p>${t('backoffice.home.intro')}</p></html>`,
    ].join('');
    expect(findForeignStrings(rendered, 'fr')).toEqual([]);
  });

  it('signale une chaîne espagnole ou anglaise dans une vue française', () => {
    const rendered = `<p>${CATALOGS.fr.messages['web.home.tagline']}</p><p>Consola interna.</p><p>Internal console.</p>`;
    expect(findForeignStrings(rendered, 'fr')).toEqual(['Consola interna.', 'Internal console.']);
  });

  it('signale une chaîne anglaise dans une vue espagnole', () => {
    const rendered = `<p>${CATALOGS.es.messages['web.home.tagline']}</p><p>Internal console.</p>`;
    expect(findForeignStrings(rendered, 'es')).toEqual(['Internal console.']);
  });
});
