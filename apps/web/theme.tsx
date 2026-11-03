/**
 * Thème de la requête (US-030) : jetons de design compilés en variables CSS par `@rueda/design-tokens`.
 * Lu à chaque rendu côté serveur (pas de `NEXT_PUBLIC_`) : changer la palette active s'applique au
 * rechargement, sans reconstruire. Les pages passent par `getRequestBrand()` (`brand-source.ts`,
 * US-048) : version publiée par `GET /brand` (US-034) si l'API est configurée, ce thème sinon.
 */
import { getActiveTheme } from '@rueda/design-tokens';
import type { ActiveTheme } from '@rueda/design-tokens';

export function getRequestTheme(): ActiveTheme {
  return getActiveTheme(process.env);
}

/**
 * Feuille du thème, à placer dans `<head>`. Le contenu est généré à partir de valeurs validées
 * (aucun `<`, `;` ni accolade possible dans une valeur), d'où l'injection brute, sans échappement
 * HTML qui casserait les sélecteurs `[data-theme="dark"]`.
 */
export function ThemeStyle({ active }: { readonly active: ActiveTheme }) {
  return (
    <style
      id="rueda-theme"
      data-theme-id={active.theme.id}
      data-theme-version={active.theme.version}
      dangerouslySetInnerHTML={{ __html: active.css }}
    />
  );
}
