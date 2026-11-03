import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { BRAND_NAME } from '../brand.ts';
import { getRequestI18n } from '../i18n.ts';

// Aucun style codé en dur : les jetons de design arrivent avec US-030.
export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return {
    title: i18n.t('backoffice.meta.title', { brand: BRAND_NAME }),
    description: i18n.t('backoffice.meta.description'),
    robots: { index: false, follow: false },
  };
}

// Mobile-first : largeur de l'appareil, zoom utilisateur conservé (WCAG 2.2).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// `lang` = locale de la requête : une vue = une langue (10b UX-11).
export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const i18n = await getRequestI18n();
  return (
    <html lang={i18n.profile.tag}>
      <body>{children}</body>
    </html>
  );
}
