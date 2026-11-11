/**
 * Locale de la requête (US-014, 10b UX-11) : choix mémorisé (cookie), puis `Accept-Language`,
 * puis locale par défaut de la configuration. Une vue = une langue : les pages et le layout ne
 * lisent la langue qu'ici.
 */
import { createTranslator, LOCALE_COOKIE, negotiateLocale, getProfile } from '@rueda/i18n';
import type { Translator } from '@rueda/i18n';
import { cookies, headers } from 'next/headers';
import { LOCALE_CONFIG } from './locale-config.ts';

/** Étiquette de la locale de la requête (`es-PA`, `en`…), même règle que `getRequestI18n`. */
export async function getRequestLocaleTag(): Promise<string> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return negotiateLocale(
    {
      stored: cookieStore.get(LOCALE_COOKIE)?.value,
      acceptLanguage: headerList.get('accept-language'),
    },
    LOCALE_CONFIG,
  );
}

export async function getRequestI18n(): Promise<Translator> {
  return createTranslator(getProfile(LOCALE_CONFIG, await getRequestLocaleTag()));
}
