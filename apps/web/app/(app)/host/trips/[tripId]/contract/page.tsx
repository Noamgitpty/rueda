import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi, codeOf } from '../../../../../../account/api-client.ts';
import { clientContext } from '../../../../../../account/request.ts';
import { tripContractOf, UUID } from '../../../../../../account/trip-contract.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../../i18n.ts';
import accountStyles from '../../../../_account/account.module.css';
import { ContractView } from '../../../../_contract/contract-view.tsx';
import contractStyles from '../../../../_contract/contract.module.css';
import { MAIN_ID } from '../../../../_shell/main-id.ts';
import styles from '../../../host.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.a03.contract.title'), robots: { index: false, follow: false } };
}

const VERSION = /^[1-9][0-9]{0,3}$/;

/**
 * A03 · contrat — le contrat du trip vu par l'hôte (US-211 partie 211b, ADR-149 ; 16 BKG-018 ;
 * 10b A03 « étape bloquante expliquée ») : lecture seule ; état de la signature du voyageur (sans
 * elle, la remise est refusée : `CONTRACT_NOT_SIGNED`), résumé, PDF et texte complet. Le voyageur y
 * figure par son prénom et l'initiale de son nom (L2-PM-35). Un trip d'un autre hôte, ou inconnu,
 * rend le même message (404 de l'API, rien n'est révélé).
 */
export default async function HostTripContractPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, localeTag, { tripId }, query] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    params,
    searchParams,
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  const org = typeof query['org'] === 'string' && UUID.test(query['org']) ? query['org'] : null;
  const version =
    typeof query['version'] === 'string' && VERSION.test(query['version'])
      ? query['version']
      : null;
  const orgQuery = org === null ? '' : `?org=${org}`;
  const back = `/host/trips/${tripId}${orgQuery}`;
  const self = `/host/trips/${tripId}/contract${orgQuery}`;
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={UUID.test(tripId) ? back : '/host/trips'}>
          {t('web.a03.contract.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="a03-contract-title">
          {t('web.a03.contract.title')}
        </h1>
      </header>
      {body}
    </main>
  );
  if (ctx.sessionToken === null) {
    return shell(
      <EmptyState
        icon="car"
        headingLevel={2}
        title={t('web.host.loginRequired')}
        action={<ButtonLink href="/login">{t('web.host.login')}</ButtonLink>}
      />,
    );
  }
  const notFound = shell(
    <EmptyState icon="car" headingLevel={2} title={t('common.contract.notFound')} />,
  );
  if (!UUID.test(tripId)) return notFound;
  const reply = await callApi(
    'GET',
    `/trips/${tripId}/contract${version === null ? '' : `?version=${version}`}`,
    ctx,
  );
  const code = codeOf(reply);
  if (reply.status === 404 || reply.status === 401) return notFound;
  if (code === 'CONTRACT_NOT_GENERATED') {
    return shell(
      <EmptyState icon="car" headingLevel={2} title={t('common.contract.notGenerated')} />,
    );
  }
  const contract = tripContractOf(reply);
  if (contract === null || contract.viewerRole !== 'HOST') {
    return shell(
      <ErrorState
        i18n={i18n}
        message={t('web.contract.loadError')}
        action={<ButtonLink href={self}>{t('web.contract.retry')}</ButtonLink>}
      />,
    );
  }
  const pdf = `/trips/${tripId}/contract/pdf${version === null ? '' : `?version=${version}`}`;
  return shell(
    <>
      <p className={accountStyles['text']}>{t('web.a03.contract.lead')}</p>
      {contract.draft && (
        <Banner tone="warning" live="off">
          {t('web.contract.draft')}
        </Banner>
      )}
      <section
        className={styles['card']}
        data-testid="a03-contract-state"
        data-signed={contract.signature !== null}
      >
        <p className={styles['strong']}>
          {t(contract.signature === null ? 'web.a03.contract.unsigned' : 'web.a03.contract.signed')}
        </p>
        {contract.signature !== null && (
          <>
            <p className={accountStyles['text']}>
              {t('web.contract.signedOn', {
                date: i18n.dateTime(contract.signature.signedAt, contract.summary.timezone),
              })}
            </p>
            <p className={contractStyles['hash']}>
              {t('web.contract.seal', { seal: contract.signature.sealSha256 })}
            </p>
          </>
        )}
      </section>
      <ContractView
        i18n={i18n}
        localeTag={localeTag}
        contract={contract}
        pdfHref={pdf}
        latestHref={self}
      />
      {contract.parts === null && (
        <p className={accountStyles['text']}>{t('common.contract.textErased')}</p>
      )}
    </>,
  );
}
