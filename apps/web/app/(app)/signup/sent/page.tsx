import type { Metadata } from 'next';
import { Banner, ButtonLink } from '@rueda/ui';
import { getRequestI18n } from '../../../../i18n.ts';
import styles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s15.sent.title'), robots: { index: false, follow: false } };
}

/**
 * Après l'inscription (US-102, 16 ACC-001) : MÊME écran que l'email soit libre ou déjà pris
 * (anti-énumération) ; l'e-mail reçu dit la suite (lien de vérification ou « compte existant »).
 */
export default async function SignupSentPage() {
  const i18n = await getRequestI18n();
  const t = i18n.t.bind(i18n);
  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['content']}>
      <h1 className={styles['h1']}>{t('web.s15.sent.title')}</h1>
      <Banner tone="success" live="polite">
        {t('common.auth.signupAccepted')}
      </Banner>
      <p className={styles['text']}>{t('web.s15.sent.body')}</p>
      <p className={styles['muted']}>{t('web.s15.sent.spam')}</p>
      <ButtonLink variant="secondary" href="/login" block>
        {t('web.s15.login')}
      </ButtonLink>
    </main>
  );
}
