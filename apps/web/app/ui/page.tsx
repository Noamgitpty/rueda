import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createTranslator, getProfile } from '@rueda/i18n';
import { ComponentCatalog } from '@rueda/ui/catalog';
import { getRequestI18n } from '../../i18n.ts';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { CatalogControls } from './catalog-controls.tsx';
import { isUiCatalogEnabled, parseCatalogOptions } from './catalog-options.ts';
import { ThemeMode } from './theme-mode.tsx';

// Évalué à chaque requête : le drapeau est lu au démarrage du serveur, pas au build.
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  if (!isUiCatalogEnabled()) return {};
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.catalog.title'), robots: { index: false, follow: false } };
}

/**
 * Vitrine vivante de la bibliothèque (US-032, DSN-005) : `/ui?lang=fr&theme=dark&width=full`.
 * Outil de revue du design : la langue choisie s'applique à toute la vitrine (`lang` sur son
 * conteneur), le thème par `data-theme` sur `<html>`, la largeur par un cadre de 360 px.
 */
export default async function UiCatalogPage({ searchParams }: { searchParams: SearchParams }) {
  if (!isUiCatalogEnabled()) notFound();
  const tags = LOCALE_CONFIG.locales.map((p) => p.tag);
  const options = parseCatalogOptions(await searchParams, tags);
  const i18n = options.locale
    ? createTranslator(getProfile(LOCALE_CONFIG, options.locale))
    : await getRequestI18n();
  return (
    <main lang={i18n.profile.tag}>
      <ThemeMode mode={options.theme} />
      <ComponentCatalog
        i18n={i18n}
        mobile={options.width === 'mobile'}
        controls={<CatalogControls i18n={i18n} options={options} locales={LOCALE_CONFIG.locales} />}
      />
    </main>
  );
}
