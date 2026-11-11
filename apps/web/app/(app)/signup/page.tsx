import type { Metadata } from 'next';
import { Banner } from '@rueda/ui';
import { callApi, documentsOf } from '../../../account/api-client.ts';
import { clientContext, journeyCountry } from '../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import { MAIN_ID } from '../_shell/main-id.ts';
import styles from '../_account/account.module.css';
import { SignupForm } from './signup-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s15.signup'), robots: { index: false, follow: false } };
}

/**
 * S15 — inscription (US-102 ; 10b §4.1, maquette US-033). Les versions en vigueur des CGU et de la
 * confidentialité sont lues à l'API (`GET /legal/documents`) et renvoyées à l'inscription : le
 * consentement porte la version AFFICHÉE. Sans documents (API injoignable ou aucun en vigueur) :
 * aucun formulaire (fail-closed), un message dans la langue de la vue.
 */
export default async function SignupPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, tag, query] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    searchParams,
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  const fetchDocuments = async (c: string | null) => {
    const params = new URLSearchParams({ locale: tag, ...(c !== null ? { country: c } : {}) });
    return { params, reply: await callApi('GET', `/legal/documents?${params.toString()}`, ctx) };
  };
  let country = journeyCountry(query['country'], tag);
  let { params, reply } = await fetchDocuments(country);
  // pays du lien profond inconnu de l'API (400) : portée de la locale seule, jamais d'échec
  if (reply.status === 400 && typeof query['country'] === 'string') {
    country = journeyCountry(undefined, tag);
    ({ params, reply } = await fetchDocuments(country));
  }
  const documents = documentsOf(reply);
  const tos = documents?.find((d) => d.kind === 'TOS_GUEST');
  const privacy = documents?.find((d) => d.kind === 'PRIVACY');
  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['content']}>
      <header className={styles['stackTight']}>
        <h1 className={styles['h1']}>{t('web.s15.title')}</h1>
        <p className={styles['muted']}>{t('web.s15.intro')}</p>
      </header>
      {tos === undefined || privacy === undefined ? (
        <Banner tone="danger" live="polite">
          {t('common.legal.unavailable')}
        </Banner>
      ) : (
        <SignupForm
          localeTag={tag}
          country={country}
          tosVersion={tos.version}
          privacyVersion={privacy.version}
          draft={tos.draft || privacy.draft}
          termsHref={`/legal/TOS_GUEST?${params.toString()}`}
          privacyHref={`/legal/PRIVACY?${params.toString()}`}
        />
      )}
    </main>
  );
}
