/**
 * Thème de la requête (US-030) : jetons de design compilés en variables CSS par `@rueda/tokens`.
 * Lu à chaque rendu côté serveur (pas de `NEXT_PUBLIC_`) : changer la palette active s'applique au
 * rechargement, sans reconstruire ; la version publiée en base viendra avec US-034.
 */
import { getActiveTheme } from '@rueda/tokens';
import type { ActiveTheme } from '@rueda/tokens';

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
