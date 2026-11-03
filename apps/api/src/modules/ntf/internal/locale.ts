/**
 * Langue d'un message = langue du **destinataire** (17 §1.4 ; 10b §3.9 « langue = préférence du
 * profil de chaque destinataire »). Ordre :
 *
 *   1. la locale préférée du compte, si elle est déclarée dans `@rueda/i18n` et active dans le pays
 *      de l'événement ;
 *   2. une locale active du pays de la même langue (`es-AR` → `es-PA` au Panama, `es-PY` au
 *      Paraguay ; `en-GB` → `en`), par `matchLocale` ;
 *   3. sinon la locale par défaut du pays ; sans pays, la locale par défaut de `@rueda/i18n`.
 *
 * Aucune constante de pays : tout vient de CFG (`countries.json`) et de `config/locales.json`.
 */
import { getProfile, matchLocale } from '@rueda/i18n';
import type { LocaleConfig, LocaleProfile } from '@rueda/i18n';

export interface CountryLocales {
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}

export function chooseLocale(
  preferred: string | null,
  country: CountryLocales | null,
  config: LocaleConfig,
): LocaleProfile {
  const active: LocaleConfig = country
    ? {
        defaultLocale: country.defaultLocale,
        locales: config.locales.filter((p) => country.locales.includes(p.tag)),
      }
    : config;
  const tag =
    (preferred !== null && preferred !== '' ? matchLocale(preferred, active) : undefined) ??
    active.defaultLocale;
  return getProfile(config, tag);
}
