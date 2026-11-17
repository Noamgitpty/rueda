import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../../../account/api-client.ts';
import { hostAccountsOf } from '../../../../../account/host-listings.ts';
import { hostTripOf } from '../../../../../account/host-trips.ts';
import { clientContext } from '../../../../../account/request.ts';
import { getRequestI18n } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import styles from '../../host.module.css';
import { TripCard } from '../trip-card.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.a05.heading'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A05 — détail d'un trip de l'hôte (US-219 ; 19 US-219 critère 2 ; 16 HDB-002 ; 10b UX-43) : ce que
 * l'hôte voit du voyageur (prénom, âge, note, vérification ; jamais le permis ni une pièce), dates
 * dans le fuseau du trip, lieu de remise, paiement, gains estimés. Un trip d'un autre hôte, ou
 * inconnu, rend le même message (404 de l'API, rien n'est révélé). Lecture seule.
 */
export default async function HostTripPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, { tripId }, query] = await Promise.all([getRequestI18n(), params, searchParams]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  const org = typeof query['org'] === 'string' ? query['org'] : undefined;
  const back = org === undefined ? '/host/trips' : `/host/trips?org=${org}`;
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={back}>
          {t('web.a05.back')}
        </a>
        <h1 className={accountStyles['h1']}>{t('web.a05.heading')}</h1>
      </header>
      {body}
    </main>
  );
  const login = shell(
    <EmptyState
      icon="car"
      title={t('web.host.loginRequired')}
      action={<ButtonLink href="/login">{t('web.host.login')}</ButtonLink>}
    />,
  );
  const error = shell(
    <ErrorState
      i18n={i18n}
      message={t('web.a05.loadError')}
      action={<ButtonLink href={back}>{t('web.a05.retry')}</ButtonLink>}
    />,
  );
  const notFound = shell(<EmptyState icon="car" title={t('common.hostTrips.notFound')} />);
  if (ctx.sessionToken === null) return login;
  const session = await callApi('GET', '/auth/session', ctx);
  if (session.status === 401) return login;
  const accounts = hostAccountsOf(session);
  if (accounts === null) return error;
  const account = accounts.find((a) => a.orgId === org) ?? accounts[0];
  if (account === undefined || !UUID.test(tripId)) return notFound;
  const reply = await callApi('GET', `/host/accounts/${account.orgId}/trips/${tripId}`, ctx);
  if (reply.status === 404) return notFound;
  const read = hostTripOf(reply);
  if (read === null) return error;
  return shell(
    <>
      <TripCard i18n={i18n} trip={read.trip} market={read.market} href={null} headingLevel={2} />
      {/* contrat du trip et état de la signature du voyageur (A03 · contrat, US-211 partie 211b) */}
      <a
        className={styles['link']}
        href={`/host/trips/${tripId}/contract?org=${account.orgId}`}
        data-testid="a05-contract"
      >
        {t('web.a05.contract')}
      </a>
      <p className={styles['hint']}>{t('web.a05.earnings.note')}</p>
      <p className={styles['hint']}>{t('web.a05.privacy')}</p>
    </>,
  );
}
