import type { Metadata } from 'next';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import styles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import { LoginForm } from './login-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s15.loginTitle'), robots: { index: false, follow: false } };
}

/** Connexion (S15, US-102 ; maquette US-033 « Ya tengo cuenta »). */
export default async function LoginPage() {
  const [i18n, tag] = await Promise.all([getRequestI18n(), getRequestLocaleTag()]);
  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['content']}>
      <h1 className={styles['h1']}>{i18n.t('web.s15.loginTitle')}</h1>
      <LoginForm localeTag={tag} />
    </main>
  );
}
