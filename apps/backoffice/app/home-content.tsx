import type { Translator } from '@rueda/i18n';
import { BRAND_NAME } from '../brand.ts';

// Accueil du back-office interne, sans accès à la requête : rendu testable dans chaque locale.
// Authentification staff + TOTP : stories IAM. Aucun style codé en dur (US-030).
export function HomeContent({ i18n }: { readonly i18n: Translator }) {
  return (
    <main>
      <h1>{i18n.t('backoffice.home.heading', { brand: BRAND_NAME })}</h1>
      <p>{i18n.t('backoffice.home.intro')}</p>
    </main>
  );
}
