import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Banner, Button, ButtonLink } from '@rueda/ui';
import { callApi } from '../../../account/api-client.ts';
import { clientContext } from '../../../account/request.ts';
import { getRequestI18n } from '../../../i18n.ts';
import styles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s15.verifyTitle'), robots: { index: false, follow: false } };
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Vérifie le lien (POST, corps JSON) ; jamais au simple chargement de la page. */
async function verify(form: FormData): Promise<void> {
  'use server';
  const token = form.get('token');
  if (typeof token !== 'string' || !TOKEN.test(token)) redirect('/verify-email?result=expired');
  const reply = await callApi('POST', '/auth/verify-email', await clientContext(), { token });
  redirect(`/verify-email?result=${reply.status === 200 ? 'ok' : 'expired'}`);
}

/**
 * Lien de vérification de l'e-mail (US-102, 16 ACC-001). Un clic est demandé avant de consommer le
 * lien : un scanner de messagerie qui suit le lien ne vérifie rien. Le jeton n'est jamais journalisé
 * ni réécrit dans une URL après l'envoi (résultat seul).
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, query] = await Promise.all([getRequestI18n(), searchParams]);
  const t = i18n.t.bind(i18n);
  const token = typeof query['token'] === 'string' ? query['token'] : '';
  const result = query['result'];
  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['content']}>
      <h1 className={styles['h1']}>{t('web.s15.verifyTitle')}</h1>
      {result === 'ok' ? (
        <>
          <Banner tone="success" live="polite">
            {t('common.auth.emailVerified')}
          </Banner>
          <ButtonLink href="/login" block>
            {t('web.s15.loginTitle')}
          </ButtonLink>
        </>
      ) : result === 'expired' || !TOKEN.test(token) ? (
        <Banner tone="danger" live="polite">
          {t('common.auth.linkExpired')}
        </Banner>
      ) : (
        <form className={styles['stack']} action={verify}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" block>
            {t('web.s15.verifyCta')}
          </Button>
        </form>
      )}
    </main>
  );
}
