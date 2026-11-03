import type { ReactNode } from 'react';
import { getRequestBrand } from '../../brand-source.ts';
import { getRequestI18n } from '../../i18n.ts';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { AppShell } from './_shell/app-shell.tsx';

/**
 * Écrans du produit (voyageur et hôte, même PWA) dans la coquille mobile-first (US-048). Les outils
 * internes (`/ui`, `/lab/pwa-ios`) restent hors de ce groupe.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const [brand, i18n] = await Promise.all([getRequestBrand(), getRequestI18n()]);
  return (
    <AppShell
      brand={brand}
      i18n={i18n}
      locales={LOCALE_CONFIG.locales}
      serviceWorker={process.env.NODE_ENV === 'production'}
    >
      {children}
    </AppShell>
  );
}
