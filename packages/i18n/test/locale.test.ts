import { describe, expect, it } from 'vitest';
import {
  LocaleConfigError,
  getProfile,
  isSupportedLocale,
  negotiateLocale,
  parseAcceptLanguage,
  parseLocaleConfig,
} from '../src/index.ts';
import type { LocaleConfig } from '../src/index.ts';
import { CONFIG, rawConfig } from './helpers.ts';

describe('configuration des locales (ADR-024 : données, pas de code)', () => {
  it('config/locales.json est valide et déclare es-PA, es-PY, en et fr', () => {
    expect(CONFIG.locales.map((p) => p.tag)).toEqual(['es-PA', 'es-PY', 'en', 'fr']);
    expect(CONFIG.locales.map((p) => p.language)).toEqual(['es', 'es', 'en', 'fr']);
  });

  it('formats espagnols et français : 24 h ; anglais : 12 h ; dates jj/mm/aaaa partout (16 I18N-003)', () => {
    for (const p of CONFIG.locales) {
      expect(p.date.datePattern).toBe('{day}/{month}/{year}');
      expect(p.date.hourCycle).toBe(p.language === 'en' ? 'h12' : 'h23');
    }
  });

  it('refuse une configuration invalide', () => {
    const base = rawConfig();
    const locales = base['locales'] as Record<string, unknown>[];
    const first = locales[0] as Record<string, unknown>;
    const cases: unknown[] = [
      null,
      { ...base, locales: [] },
      { ...base, defaultLocale: 'de' },
      { ...base, locales: [first, first] },
      { ...base, locales: [{ ...first, tag: 'es_PA' }] },
      { ...base, locales: [{ ...first, language: 'en' }] },
      {
        ...base,
        locales: [{ ...first, number: { group: '.', decimal: '.', minimumGroupingDigits: 1 } }],
      },
      {
        ...base,
        locales: [
          {
            ...first,
            currency: { symbols: {}, pattern: '{amount}', negativePattern: '-{symbol}{amount}' },
          },
        ],
      },
      {
        ...base,
        locales: [
          {
            ...first,
            date: {
              ...(first['date'] as object),
              hourCycle: 'h12',
              timePattern: '{hour}:{minute}',
            },
          },
        ],
      },
    ];
    for (const raw of cases) expect(() => parseLocaleConfig(raw)).toThrow(LocaleConfigError);
  });

  it('getProfile : locale non déclarée refusée', () => {
    expect(() => getProfile(CONFIG, 'pt-BR')).toThrow(LocaleConfigError);
  });
});

describe('parseAcceptLanguage', () => {
  it('trie par qualité, garde l’ordre à égalité, ignore q=0 et les étiquettes invalides', () => {
    expect(parseAcceptLanguage('en-US,en;q=0.9,es;q=0.9,fr;q=0,<x>;q=1')).toEqual([
      { tag: 'en-US', quality: 1 },
      { tag: 'en', quality: 0.9 },
      { tag: 'es', quality: 0.9 },
    ]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
  });
});

describe('negotiateLocale (10b UX-11)', () => {
  it('le choix mémorisé l’emporte sur Accept-Language', () => {
    expect(negotiateLocale({ stored: 'en', acceptLanguage: 'es-PY' }, CONFIG)).toBe('en');
  });

  it('choix mémorisé inconnu : ignoré', () => {
    expect(negotiateLocale({ stored: 'xx', acceptLanguage: 'es-PY' }, CONFIG)).toBe('es-PY');
  });

  it('correspondance exacte, insensible à la casse', () => {
    expect(negotiateLocale({ acceptLanguage: 'es-py' }, CONFIG)).toBe('es-PY');
    expect(negotiateLocale({ acceptLanguage: 'en' }, CONFIG)).toBe('en');
  });

  it('même langue, autre région : locale par défaut si elle est de cette langue', () => {
    expect(negotiateLocale({ acceptLanguage: 'es-AR' }, CONFIG)).toBe(CONFIG.defaultLocale);
    expect(negotiateLocale({ acceptLanguage: 'en-GB' }, CONFIG)).toBe('en');
  });

  it('la locale par défaut vient de la configuration, pas du code', () => {
    const paraguayFirst: LocaleConfig = { ...CONFIG, defaultLocale: 'es-PY' };
    expect(negotiateLocale({ acceptLanguage: 'es' }, paraguayFirst)).toBe('es-PY');
    expect(negotiateLocale({}, paraguayFirst)).toBe('es-PY');
  });

  it('français (DEC-FONDATEUR-17) : fr et fr-FR d’après Accept-Language, puis le cookie', () => {
    expect(negotiateLocale({ acceptLanguage: 'fr' }, CONFIG)).toBe('fr');
    expect(negotiateLocale({ acceptLanguage: 'fr-FR' }, CONFIG)).toBe('fr');
    expect(negotiateLocale({ acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8' }, CONFIG)).toBe('fr');
    expect(negotiateLocale({ acceptLanguage: 'fr-CA' }, CONFIG)).toBe('fr');
    expect(negotiateLocale({ acceptLanguage: 'de-DE,fr;q=0.8' }, CONFIG)).toBe('fr');
    expect(negotiateLocale({ stored: 'fr', acceptLanguage: 'es-PY' }, CONFIG)).toBe('fr');
    expect(negotiateLocale({ stored: 'es-PY', acceptLanguage: 'fr-FR' }, CONFIG)).toBe('es-PY');
    // Le cookie porte une locale déclarée exacte : « fr-FR » n'en est pas une, on négocie.
    expect(negotiateLocale({ stored: 'fr-FR', acceptLanguage: 'en' }, CONFIG)).toBe('en');
    expect(isSupportedLocale('fr', CONFIG)).toBe(true);
    expect(isSupportedLocale('fr-FR', CONFIG)).toBe(false);
  });

  it('langue non prise en charge, joker ou rien : locale par défaut', () => {
    expect(negotiateLocale({ acceptLanguage: 'de-DE,it;q=0.8' }, CONFIG)).toBe(
      CONFIG.defaultLocale,
    );
    expect(negotiateLocale({ acceptLanguage: 'de,*;q=0.5,en;q=0.1' }, CONFIG)).toBe(
      CONFIG.defaultLocale,
    );
    expect(negotiateLocale({}, CONFIG)).toBe(CONFIG.defaultLocale);
  });

  it('préférence de second rang retenue si la première n’est pas prise en charge', () => {
    expect(negotiateLocale({ acceptLanguage: 'pt-BR,en;q=0.7' }, CONFIG)).toBe('en');
  });

  it('isSupportedLocale', () => {
    expect(isSupportedLocale('es-PA', CONFIG)).toBe(true);
    expect(isSupportedLocale('es', CONFIG)).toBe(false);
  });
});
