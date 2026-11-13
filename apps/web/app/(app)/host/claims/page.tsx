import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import { callApi } from '../../../../account/api-client.ts';
import { formatPhotoMax, hostAccountsOf } from '../../../../account/host-listings.ts';
import { clientContext } from '../../../../account/request.ts';
import { claimsOf, eligibilityOf } from '../../../../account/vehicle-documents.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../i18n.ts';
import accountStyles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';
import styles from '../host.module.css';
import { ClaimForm } from './claim-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.vehicleDocs.claims.title'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TONE: Readonly<Record<string, BadgeTone>> = {
  OPEN: 'warning',
  UPHELD: 'success',
  DISMISSED: 'danger',
};

/**
 * Contestation d'une plaque ou d'un VIN déjà enregistrés par un autre compte (US-124, BOARD N-61) :
 * formulaire (plaque, VIN facultatif, titre du demandeur) et contestations du compte (statut
 * seulement : rien du compte en cause n'est montré). Dépôt fermé tant que l'antivirus, le coffre et
 * le stockage ne sont pas branchés : annoncé d'emblée. États : sans session, sans compte, erreur.
 */
export default async function HostClaimsPage({
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
  const org = typeof query['org'] === 'string' && UUID.test(query['org']) ? query['org'] : null;
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={org === null ? '/host' : `/host?org=${org}`}>
          {t('web.vehicleDocs.back')}
        </a>
        <h1 className={accountStyles['h1']}>{t('web.vehicleDocs.claims.title')}</h1>
        <p className={accountStyles['muted']}>{t('web.vehicleDocs.claims.intro')}</p>
      </header>
      {body}
    </main>
  );
  const error = shell(
    <ErrorState
      i18n={i18n}
      message={t('web.host.error')}
      action={<ButtonLink href="/host">{t('web.host.retry')}</ButtonLink>}
    />,
  );
  const login = shell(
    <EmptyState
      icon="car"
      title={t('web.host.loginRequired')}
      action={<ButtonLink href="/login">{t('web.host.login')}</ButtonLink>}
    />,
  );
  if (ctx.sessionToken === null) return login;
  const session = await callApi('GET', '/auth/session', ctx);
  if (session.status === 401) return login;
  const accounts = hostAccountsOf(session);
  if (accounts === null) return error;
  const account = accounts.find((a) => a.orgId === org) ?? accounts[0];
  if (account === undefined) {
    return shell(<EmptyState icon="car" title={t('web.host.noAccount')} />);
  }
  const base = `/host/accounts/${account.orgId}`;
  const [claimsReply, eligReply] = await Promise.all([
    callApi('GET', `${base}/vehicle-claims`, ctx),
    callApi('GET', `${base}/vehicle-eligibility`, ctx),
  ]);
  const claims = claimsOf(claimsReply);
  const state = eligibilityOf(eligReply);
  if (claims === null || state === null) return error;
  return shell(
    <>
      {query['saved'] === '1' && (
        <Banner tone="success" live="polite" icon="check">
          {t('web.host.saved')}
        </Banner>
      )}
      {claims.length > 0 && (
        <section className={styles['section']} aria-labelledby="a10c-mine">
          <h2 id="a10c-mine" className={accountStyles['h2']}>
            {t('web.vehicleDocs.claims.mine')}
          </h2>
          <ul className={styles['rows']}>
            {claims.map((c) => (
              <li key={c.claimId} className={styles['card']}>
                <div className={styles['between']}>
                  <span className={styles['strong']}>{c.plate}</span>
                  <Badge tone={TONE[c.status] ?? 'neutral'}>
                    {t(`web.vehicleDocs.claims.status.${c.status}`)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={styles['section']} aria-labelledby="a10c-new">
        <h2 id="a10c-new" className={accountStyles['h2']}>
          {t('web.vehicleDocs.claims.open')}
        </h2>
        {state.uploads.open ? (
          <ClaimForm
            localeTag={tag}
            orgId={account.orgId}
            maxLabel={formatPhotoMax(state.uploads.maxBytes, tag)}
          />
        ) : (
          <p className={accountStyles['muted']} role="status">
            {t('common.vehicleDocs.uploadUnavailable')}
          </p>
        )}
      </section>
    </>,
  );
}
