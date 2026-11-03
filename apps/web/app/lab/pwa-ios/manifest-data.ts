import { embeddedBrand } from '../../../brand-source.ts';
import { LAB_BASE_PATH } from './lab-flag';
import { LAB_ICON_SIZES } from './png';

/**
 * Manifeste du laboratoire seulement (le manifeste de l'application, généré depuis le thème
 * publié, est US-048). Aucune couleur : `theme_color` et `background_color` viendront des jetons.
 */
export function buildLabManifest(): Record<string, unknown> {
  return {
    name: `${embeddedBrand().name} lab PWA iOS`,
    short_name: 'Lab PWA',
    id: LAB_BASE_PATH,
    start_url: LAB_BASE_PATH,
    scope: LAB_BASE_PATH,
    display: 'standalone',
    icons: LAB_ICON_SIZES.map((size) => ({
      src: `${LAB_BASE_PATH}/icons/${size}`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any',
    })),
  };
}
