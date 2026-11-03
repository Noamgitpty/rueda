/**
 * Les messages visibles de l'authentification passent par @rueda/i18n : chaque clé renvoyée par
 * l'API existe en es, en et fr, avec les mêmes emplacements (`{min}` pour AUTH_PASSWORD_WEAK).
 */
import {
  CATALOGS,
  getProfile,
  parseLocaleConfig,
  createTranslator,
  placeholdersOf,
} from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import raw from '@rueda/i18n/config/locales.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { AUTH_MESSAGES } from './errors.js';

describe('catalogue des messages de l’authentification', () => {
  const keys = Object.values(AUTH_MESSAGES).map((m) => m.messageKey);

  it('chaque clé existe en es, en et fr', () => {
    for (const language of ['es', 'en', 'fr'] as const) {
      const messages = CATALOGS[language].messages as Readonly<Record<string, unknown>>;
      for (const key of keys) expect(messages[key], `${language}:${key}`).toBeTypeOf('string');
    }
  });

  it('emplacements identiques dans les trois langues ; {min} pour le mot de passe faible', () => {
    for (const key of keys) {
      const es = placeholdersOf(CATALOGS.es.messages[key as MessageKey] as string);
      for (const language of ['en', 'fr'] as const) {
        expect(
          placeholdersOf(CATALOGS[language].messages[key as MessageKey] as string),
          `${language}:${key}`,
        ).toEqual(es);
      }
    }
    expect(placeholdersOf(CATALOGS.es.messages['common.auth.passwordWeak'] as string)).toEqual([
      'min',
    ]);
  });

  it('rendu dans chaque locale, sans emplacement résiduel', () => {
    const config = parseLocaleConfig(raw);
    for (const locale of config.locales.map((l) => l.tag)) {
      const t = createTranslator(getProfile(config, locale));
      const text = t.t('common.auth.passwordWeak', { min: 10 });
      expect(text).toContain('10');
      expect(text).not.toContain('{');
    }
  });
});
