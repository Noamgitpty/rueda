import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Banner, Button, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../../account/api-client.ts';
import { hostAccountsOf, vehiclesOf } from '../../../../account/host-listings.ts';
import { hostTripsOf, TRIP_TABS, tripFilterQuery } from '../../../../account/host-trips.ts';
import { clientContext } from '../../../../account/request.ts';
import { getRequestI18n } from '../../../../i18n.ts';
import accountStyles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';
import styles from '../host.module.css';
import { TripCard } from './trip-card.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.a05.heading'), robots: { index: false, follow: false } };
}

const orgOf = (q: Readonly<Record<string, string | string[] | undefined>>): string | undefined =>
  typeof q['org'] === 'string' ? q['org'] : undefined;

/**
 * A05 — réservations de l'hôte (US-219 ; 16 HDB-002 ; 10b §3.8 UX-39, UX-43, UX-44) : onglets À
 * venir / En cours / Terminées / Annulées, filtres par auto et par dates (dates locales du trip),
 * cartes des trips (voyageur minimisé, statut du paiement, gains estimés relus de l'API). Le
 * serveur lit l'API avec la session de l'hôte ; un compte d'un autre hôte n'est jamais lisible
 * (404). États : sans session, sans compte d'hôte, vide, filtres invalides, erreur, chargement
 * (`loading.tsx`). Lecture seule : le mode `REQUEST` (accepter, refuser) n'est pas livré (ADR-128).
 */
export default async function HostTripsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, query] = await Promise.all([getRequestI18n(), searchParams]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a
          className={styles['link']}
          href={orgOf(query) === undefined ? '/host' : `/host?org=${orgOf(query)}`}
        >
          {t('web.calendar.back')}
        </a>
        <h1 className={accountStyles['h1']}>{t('web.a05.heading')}</h1>
        <p className={accountStyles['muted']}>{t('web.a05.intro')}</p>
      </header>
      {body}
    </main>
  );
  const error = shell(
    <ErrorState
      i18n={i18n}
      message={t('web.a05.loadError')}
      action={<ButtonLink href="/host/trips">{t('web.a05.retry')}</ButtonLink>}
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
  if (accounts.length === 0) {
    return shell(
      <EmptyState icon="car" title={t('web.host.noAccount')} body={t('web.host.noAccount.body')} />,
    );
  }
  const account = accounts.find((a) => a.orgId === orgOf(query)) ?? accounts[0];
  if (account === undefined) return error;
  const { tab, params } = tripFilterQuery(query);
  const base = `/host/accounts/${account.orgId}`;
  const [tripsReply, vehReply] = await Promise.all([
    callApi('GET', `${base}/trips?${params.toString()}`, ctx),
    callApi('GET', `${base}/vehicles`, ctx),
  ]);
  const vehicles = vehiclesOf(vehReply) ?? [];
  // période inversée (ou autre filtre refusé par l'API) : message, sans liste
  const invalid = tripsReply.status === 400;
  const read = invalid ? null : hostTripsOf(tripsReply);
  if (!invalid && read === null) return error;
  const linkFor = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) p.set(k, v);
    p.set('org', account.orgId);
    return `/host/trips?${p.toString()}`;
  };
  return shell(
    <>
      <nav aria-label={t('web.a05.tabs')}>
        <ul className={styles['accounts']}>
          {TRIP_TABS.map((x) => (
            <li key={x}>
              <a
                className={styles['account']}
                href={linkFor({ tab: x })}
                aria-current={x === tab ? 'page' : undefined}
              >
                {t(`web.a05.tab.${x}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <form
        method="get"
        action="/host/trips"
        className={styles['filters']}
        aria-labelledby="a05-filters"
      >
        <h2 id="a05-filters" className={accountStyles['h2']}>
          {t('web.a05.filter.title')}
        </h2>
        <input type="hidden" name="org" value={account.orgId} />
        <input type="hidden" name="tab" value={tab} />
        <label className={accountStyles['field']}>
          <span className={accountStyles['label']}>{t('web.a05.filter.vehicle')}</span>
          <select
            id="a05-vehicle"
            name="vehicleId"
            className={styles['select']}
            defaultValue={params.get('vehicleId') ?? ''}
          >
            <option value="">{t('web.a05.filter.allVehicles')}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {[v.makeText, v.modelText].filter(Boolean).join(' ')} {v.year} · {v.plate}
              </option>
            ))}
          </select>
        </label>
        <label className={accountStyles['field']}>
          <span className={accountStyles['label']}>{t('web.a05.filter.from')}</span>
          <input
            id="a05-from"
            type="date"
            name="from"
            className={styles['select']}
            defaultValue={params.get('from') ?? ''}
          />
        </label>
        <label className={accountStyles['field']}>
          <span className={accountStyles['label']}>{t('web.a05.filter.to')}</span>
          <input
            id="a05-to"
            type="date"
            name="to"
            className={styles['select']}
            defaultValue={params.get('to') ?? ''}
          />
        </label>
        <Button type="submit" block>
          {t('web.a05.filter.apply')}
        </Button>
      </form>
      {invalid && (
        <Banner tone="warning" live="polite">
          {t('web.a05.filter.invalid')}
        </Banner>
      )}
      {read !== null && read.trips.length === 0 && (
        <EmptyState icon="car" title={t('web.a05.empty')} />
      )}
      {read !== null && read.trips.length > 0 && (
        <ul className={styles['rows']} aria-label={t(`web.a05.tab.${tab}`)}>
          {read.trips.map((trip) => (
            <li key={trip.tripId}>
              <TripCard
                i18n={i18n}
                trip={trip}
                market={read.market}
                href={`/host/trips/${trip.tripId}?org=${account.orgId}`}
              />
            </li>
          ))}
        </ul>
      )}
      <p className={styles['hint']}>{t('web.a05.earnings.note')}</p>
      <p className={styles['hint']}>{t('web.a05.privacy')}</p>
    </>,
  );
}
