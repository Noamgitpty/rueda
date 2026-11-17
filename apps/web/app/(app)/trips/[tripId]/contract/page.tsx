import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi, codeOf } from '../../../../../account/api-client.ts';
import { clientContext } from '../../../../../account/request.ts';
import { tripContractOf, UUID } from '../../../../../account/trip-contract.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { ContractView } from '../../../_contract/contract-view.tsx';
import contractStyles from '../../../_contract/contract.module.css';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import styles from '../../../host/host.module.css';
import { SignForm } from './sign-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s09.contract.title'), robots: { index: false, follow: false } };
}

const VERSION = /^[1-9][0-9]{0,3}$/;

/**
 * S09 · contrat — contrat de location du voyageur (US-211 partie 211b, ADR-149 ; 16 BKG-018,
 * BKG-019 ; 10b S09 « documents, contrat », UX-51) : relation entre particuliers rappelée (la
 * plateforme n'est qu'intermédiaire), bandeau BROUILLON tant que l'avocat n'a pas validé le
 * gabarit (GL-23), résumé en tête, PDF, texte complet accessible (équivalent HTML), puis la
 * signature (case + bouton, heure du serveur, empreinte du document affiché) ou l'état signé
 * (heure à l'heure locale du trip, sceau). Une version plus ancienne reste consultable
 * (`?version=n`) et n'est plus signable. Un trip d'une autre personne, ou inconnu, rend le même
 * message (404 de l'API, rien n'est révélé).
 */
export default async function TripContractPage({
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
  if (ctx.sessionToken === null) redirect('/login');
  const version =
    typeof query['version'] === 'string' && VERSION.test(query['version'])
      ? query['version']
      : null;
  const self = `/trips/${tripId}/contract`;
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']} data-testid="s09-contract-title">
          {t('web.s09.contract.title')}
        </h1>
      </header>
      {body}
    </main>
  );
  const notFound = shell(
    <EmptyState icon="car" headingLevel={2} title={t('common.contract.notFound')} />,
  );
  if (!UUID.test(tripId)) return notFound;
  const reply = await callApi(
    'GET',
    `/trips/${tripId}/contract${version === null ? '' : `?version=${version}`}`,
    ctx,
  );
  if (reply.status === 401) redirect('/login');
  const code = codeOf(reply);
  if (code === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return notFound;
  if (code === 'CONTRACT_NOT_GENERATED') {
    return shell(
      <EmptyState
        icon="car"
        headingLevel={2}
        title={t('common.contract.notGenerated')}
        action={<ButtonLink href={self}>{t('web.contract.retry')}</ButtonLink>}
      />,
    );
  }
  const contract = tripContractOf(reply);
  if (contract === null || contract.viewerRole !== 'GUEST') {
    return shell(
      <ErrorState
        i18n={i18n}
        message={t('web.contract.loadError')}
        action={<ButtonLink href={self}>{t('web.contract.retry')}</ButtonLink>}
      />,
    );
  }
  const signedAt =
    contract.signature === null
      ? null
      : i18n.dateTime(contract.signature.signedAt, contract.summary.timezone);
  const pdfHref = `${self}/pdf${version === null ? '' : `?version=${version}`}`;
  return shell(
    <>
      <p className={accountStyles['text']}>{t('web.s09.contract.lead')}</p>
      {contract.draft && (
        <Banner tone="warning" live="off">
          {t('web.contract.draft')}
        </Banner>
      )}
      {query['signed'] === '1' && contract.signature !== null && (
        <Banner tone="success" live="polite">
          {t('web.s09.contract.signed')}
        </Banner>
      )}
      {contract.signature !== null && signedAt !== null && (
        <section className={styles['card']} data-testid="s09-contract-signed">
          <p className={styles['strong']}>{t('web.contract.signedOn', { date: signedAt })}</p>
          <p className={contractStyles['hash']}>
            {t('web.contract.seal', { seal: contract.signature.sealSha256 })}
          </p>
        </section>
      )}
      <ContractView
        i18n={i18n}
        localeTag={localeTag}
        contract={contract}
        pdfHref={pdfHref}
        latestHref={self}
      />
      {contract.signable && contract.parts !== null && (
        <section className={styles['section']} aria-labelledby="s09-contract-sign-title">
          <h2 id="s09-contract-sign-title" className={accountStyles['h2']}>
            {t('web.s09.contract.sign.title')}
          </h2>
          <SignForm
            localeTag={localeTag}
            tripId={contract.tripId}
            documentId={contract.documentId}
            sha256={contract.sha256}
          />
        </section>
      )}
      {contract.parts === null && (
        <p className={accountStyles['text']}>{t('common.contract.textErased')}</p>
      )}
    </>,
  );
}
