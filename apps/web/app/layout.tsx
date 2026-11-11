import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { getRequestBrand } from '../brand-source.ts';
import { getRequestContent, pageDescription } from '../content-source.ts';
import { getRequestI18n } from '../i18n.ts';
import { iconUrl, MANIFEST_PATH } from '../pwa/manifest.ts';
import { ThemeStyle } from '../theme.tsx';

// Nom, description, manifeste et icônes viennent de la marque de la requête (US-034, US-048) :
// version publiée si l'API la donne, thème embarqué sinon. Aucun nom ni style codé en dur.
export async function generateMetadata(): Promise<Metadata> {
  // marque et blocs lus en parallèle (chacun borné à 1,5 s, mis en cache 30 s) : la page n'attend
  // jamais les deux délais l'un après l'autre (revue architecture US-121, 2e passe, n° 5)
  const i18nP = getRequestI18n();
  const [brand, i18n, content] = await Promise.all([
    getRequestBrand(),
    i18nP,
    i18nP.then((i18n) => getRequestContent(i18n)),
  ]);
  return {
    title: brand.name,
    // accroche de l'accueil : bloc publié dans la langue de la page, sinon catalogue (US-121)
    description: pageDescription(i18n, content),
    applicationName: brand.name,
    manifest: MANIFEST_PATH,
    icons: {
      icon: [{ url: iconUrl('icon-192.png', brand), type: 'image/png', sizes: '192x192' }],
      apple: [{ url: iconUrl('apple-touch-icon.png', brand), sizes: '180x180' }],
    },
    appleWebApp: { capable: true, title: brand.name, statusBarStyle: 'default' },
    formatDetection: { telephone: false },
  };
}

// Mobile d'abord : largeur de l'appareil, zoom conservé (WCAG 1.4.4), encoche couverte
// (`viewport-fit=cover`, marges `safe-area-inset-*` dans la coquille). Couleur de la barre du
// système = fond de page du thème, en clair et en sombre.
export async function generateViewport(): Promise<Viewport> {
  const { active } = await getRequestBrand();
  const { light, dark } = active.theme.colors;
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor:
      active.dataTheme === undefined
        ? [
            { media: '(prefers-color-scheme: light)', color: light.surface },
            { media: '(prefers-color-scheme: dark)', color: dark.surface },
          ]
        : active.theme.colors[active.dataTheme].surface,
  };
}

// `lang` = locale de la requête : une vue = une langue (10b UX-11).
export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const [brand, i18n] = await Promise.all([getRequestBrand(), getRequestI18n()]);
  // `data-theme` absent = clair ou sombre selon l'appareil ; sinon mode imposé par la configuration.
  return (
    <html lang={i18n.profile.tag} data-theme={brand.active.dataTheme}>
      <head>
        <ThemeStyle active={brand.active} />
      </head>
      <body>{children}</body>
    </html>
  );
}
