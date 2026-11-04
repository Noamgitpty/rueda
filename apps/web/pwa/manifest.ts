/**
 * Manifeste de l'application installable (US-048, 10b UX-03, ADR-039, ADR-072). Fonction pure :
 * nom, couleurs et icônes viennent de la marque de la requête (version publiée US-034, sinon
 * thème embarqué US-030) ; la description est dans la langue de la requête.
 */
import type { Translator } from '@rueda/i18n';
import type { ShellBrand } from '../brand-source.ts';

/** Icônes générées depuis le thème (`app/icons/[name]/route.tsx`). */
export const PWA_ICONS = {
  'icon-192.png': { size: 192, purpose: 'any' },
  'icon-512.png': { size: 512, purpose: 'any' },
  'maskable-512.png': { size: 512, purpose: 'maskable' },
  'apple-touch-icon.png': { size: 180, purpose: 'apple' },
} as const;
export type PwaIconName = keyof typeof PWA_ICONS;
export const PWA_ICON_NAMES = Object.keys(PWA_ICONS) as PwaIconName[];

export function isPwaIconName(name: string): name is PwaIconName {
  return Object.hasOwn(PWA_ICONS, name);
}

/** URL d'une icône, avec la version de la marque : une nouvelle marque = de nouvelles icônes. */
export function iconUrl(name: PwaIconName, brand: ShellBrand): string {
  return `/icons/${name}?v=${encodeURIComponent(brand.version)}`;
}

export const MANIFEST_PATH = '/manifest.webmanifest';
export const START_URL = '/';

export function buildWebManifest(brand: ShellBrand, i18n: Translator): Record<string, unknown> {
  const light = brand.active.theme.colors.light;
  return {
    id: START_URL,
    name: brand.name,
    short_name: brand.name,
    description: i18n.t('web.home.tagline'),
    lang: i18n.profile.tag,
    dir: 'ltr',
    start_url: START_URL,
    scope: START_URL,
    display: 'standalone',
    // Écran de démarrage : fond de page du thème ; barre du système : couleur d'action.
    background_color: light.surface,
    theme_color: light.primary,
    icons: PWA_ICON_NAMES.filter((n) => PWA_ICONS[n].purpose !== 'apple').map((n) => ({
      src: iconUrl(n, brand),
      sizes: `${PWA_ICONS[n].size}x${PWA_ICONS[n].size}`,
      type: 'image/png',
      purpose: PWA_ICONS[n].purpose,
    })),
  };
}
