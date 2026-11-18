import type { Metadata } from 'next';
import { ButtonLink, EmptyState } from '@rueda/ui';
import { clientContext } from '../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../i18n.ts';
import accountStyles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';
import styles from '../host.module.css';
import { ConstanciaSearchForm } from './search-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.constancia.search.title'), robots: { index: false, follow: false } };
}

/**
 * Recherche de constancia par l'hôte (US-212, ADR-162 ; 19 US-212 critère 1 « recherche par
 * plaque et date possible pour l'hôte » ; 16 LEG-026 parcours EC-48) : plaque et date de
 * l'infraction ; la base ne rend que les trips du compte d'hôte de la session.
 */
export default async function HostConstanciaSearchPage() {
  const [i18n, localeTag, ctx] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    clientContext(),
  ]);
  const t = i18n.t.bind(i18n);
  return (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href="/host/trips">
          {t('web.legal.backHost')}
        </a>
        <h1 className={accountStyles['h1']} id="constancia-search-title">
          {t('web.constancia.search.title')}
        </h1>
      </header>
      {ctx.sessionToken === null ? (
        <EmptyState
          icon="car"
          headingLevel={2}
          title={t('web.host.loginRequired')}
          action={<ButtonLink href="/login">{t('web.host.login')}</ButtonLink>}
        />
      ) : (
        <>
          <p className={accountStyles['text']}>{t('web.constancia.search.lead')}</p>
          <ConstanciaSearchForm localeTag={localeTag} />
        </>
      )}
    </main>
  );
}
