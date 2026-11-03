import type { Translator } from '@rueda/i18n';
import { BRAND_NAME } from '../brand.ts';

// Contenu de l'accueil, sans accès à la requête : rendu testable dans chaque locale.
// Aucun style codé en dur : les jetons de design arrivent avec US-030.
export function HomeContent({ i18n }: { readonly i18n: Translator }) {
  return (
    <main>
      <h1>{BRAND_NAME}</h1>
      <p>{i18n.t('web.home.tagline')}</p>
    </main>
  );
}
