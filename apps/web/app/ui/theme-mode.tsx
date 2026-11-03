'use client';

import { useEffect } from 'react';
import type { CatalogTheme } from './catalog-options.ts';

/**
 * Applique le mode clair ou sombre choisi dans la vitrine en posant `data-theme` sur `<html>`
 * (sélecteurs générés par `@rueda/design-tokens`), puis rétablit la valeur d'origine en quittant
 * la page. `auto` : préférence de l'appareil, ou mode imposé par la configuration du thème.
 */
export function ThemeMode({ mode }: { readonly mode: CatalogTheme }) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    if (mode !== 'auto') root.setAttribute('data-theme', mode);
    return () => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    };
  }, [mode]);
  return null;
}
