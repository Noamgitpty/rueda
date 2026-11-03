import type { Translator } from '@rueda/i18n';
import { BRAND_NAME } from '../brand.ts';
import styles from './home.module.css';

// Contenu de l'accueil, sans accès à la requête : rendu testable dans chaque locale.
// Aucun style codé en dur : classes de `home.module.css`, qui ne lit que des jetons (US-030).
export function HomeContent({ i18n }: { readonly i18n: Translator }) {
  return (
    <main className={styles['main']}>
      <h1 className={styles['title']}>{BRAND_NAME}</h1>
      <p className={styles['tagline']}>{i18n.t('web.home.tagline')}</p>
    </main>
  );
}
