/**
 * Chargement de la configuration pays versionnée du dépôt (US-013). Bêta : la source unique est
 * `../data/*.json` (16 ADM-014 « SIMPLIFIÉ : paramètres dans un fichier de configuration versionné ») ;
 * la base reçoit les mêmes données par la migration de graines 0003, générée depuis ces fichiers
 * (`seed-sql.ts`). Les locales viennent de `@rueda/i18n` (`config/locales.json`), non dupliquées.
 */
import locales from '@rueda/i18n/config/locales.json' with { type: 'json' };
import countries from '../data/countries.json' with { type: 'json' };
import currencies from '../data/currencies.json' with { type: 'json' };
import params from '../data/params.json' with { type: 'json' };
import type { CountryConfig } from './model.js';
import { parseCountryConfig } from './parse.js';
import type { CountryConfigSources } from './parse.js';

/** Documents bruts du dépôt (non validés). */
export function repositorySources(): CountryConfigSources {
  return { currencies, countries, params };
}

/** Étiquettes des locales configurées dans `@rueda/i18n`. */
export function knownLocaleTags(): string[] {
  return locales.locales.map((l) => l.tag);
}

/** Configuration du dépôt, validée (lève `CONFIG_INVALID`). */
export function loadRepositoryConfig(): CountryConfig {
  return parseCountryConfig(repositorySources(), { knownLocales: knownLocaleTags() });
}
