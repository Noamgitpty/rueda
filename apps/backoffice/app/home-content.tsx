import type { ReactNode } from 'react';
import type { Translator } from '@rueda/i18n';
import { BRAND_NAME } from '../brand.ts';
import styles from './home.module.css';

// Accueil du back-office interne, sans accès à la requête : rendu testable dans chaque locale.
// La console (authentification forte du staff, US-012) est passée en enfant. Aucun style codé en
// dur (US-030) : mise en page par les jetons.
export function HomeContent({
  i18n,
  children,
}: {
  readonly i18n: Translator;
  readonly children?: ReactNode;
}) {
  return (
    <main className={styles['main']}>
      <h1 className={styles['title']}>
        {i18n.t('backoffice.home.heading', { brand: BRAND_NAME })}
      </h1>
      <p className={styles['intro']}>{i18n.t('backoffice.home.intro')}</p>
      {children}
    </main>
  );
}
