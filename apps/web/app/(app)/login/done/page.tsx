import type { Metadata } from 'next';
import { Banner } from '@rueda/ui';
import { getRequestI18n } from '../../../../i18n.ts';
import styles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s15.loginTitle'), robots: { index: false, follow: false } };
}

/**
 * Connecté, documents à jour (US-102). Point d'extension : le retour automatique à l'écran
 * d'origine (lien profond, 10b N7) arrive avec la réservation (lot 2).
 */
export default async function LoginDonePage() {
  const i18n = await getRequestI18n();
  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['content']}>
      <h1 className={styles['h1']}>{i18n.t('web.s15.loginTitle')}</h1>
      <Banner tone="success" live="polite">
        {i18n.t('web.s15.loggedIn')}
      </Banner>
    </main>
  );
}
