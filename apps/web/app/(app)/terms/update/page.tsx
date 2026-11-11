import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Badge, Banner } from '@rueda/ui';
import { callApi, codeOf, documentsOf } from '../../../../account/api-client.ts';
import { clientContext, journeyCountry } from '../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../i18n.ts';
import styles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';
import { AcceptForm } from './accept-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s15.reaccept.title'), robots: { index: false, follow: false } };
}

/**
 * Documents mis à jour (US-102, critère 3) : après une version MAJEURE des CGU ou de la
 * confidentialité, le voyageur reconnecté lit et accepte la nouvelle version avant toute
 * réservation (l'API refuse sinon : `TermsGuard`, 409 `TERMS_REACCEPT_REQUIRED`).
 */
export default async function TermsUpdatePage() {
  const [i18n, tag, ctx] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    clientContext(),
  ]);
  const t = i18n.t.bind(i18n);
  const consents = await callApi('GET', '/legal/consents', ctx);
  if (consents.status === 401) redirect('/login');
  if (consents.status === 200 && codeOf(consents) === 'TERMS_CURRENT') redirect('/login/done');
  const country = journeyCountry(undefined, tag);
  const params = new URLSearchParams({ locale: tag, ...(country !== null ? { country } : {}) });
  const documents = documentsOf(await callApi('GET', `/legal/documents?${params.toString()}`, ctx));
  const tos = documents?.find((d) => d.kind === 'TOS_GUEST');
  const privacy = documents?.find((d) => d.kind === 'PRIVACY');
  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['content']}>
      <header className={styles['stackTight']}>
        <h1 className={styles['h1']}>{t('web.s15.reaccept.title')}</h1>
        <p className={styles['muted']}>{t('web.s15.reaccept.intro')}</p>
      </header>
      {consents.status !== 200 || tos === undefined || privacy === undefined ? (
        <Banner tone="danger" live="polite">
          {t('common.legal.unavailable')}
        </Banner>
      ) : (
        <>
          {(tos.draft || privacy.draft) && <Banner tone="warning">{t('web.legal.draft')}</Banner>}
          <ul className={styles['links']}>
            {[tos, privacy].map((d) => (
              <li key={d.kind}>
                <a
                  className={styles['link']}
                  href={`/legal/${d.kind}?${params.toString()}`}
                  target="_blank"
                  rel="noopener"
                >
                  {d.title}
                </a>{' '}
                <Badge>{t('web.legal.version', { version: String(d.version) })}</Badge>
              </li>
            ))}
          </ul>
          <AcceptForm
            localeTag={tag}
            versions={{ TOS_GUEST: tos.version, PRIVACY: privacy.version }}
          />
        </>
      )}
    </main>
  );
}
