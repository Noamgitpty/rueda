import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi, codeOf } from '../../../account/api-client.ts';
import { GUEST_TRIP_TABS, guestTripsOf } from '../../../account/guest-trips.ts';
import { clientContext } from '../../../account/request.ts';
import { getRequestI18n } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import styles from '../host/host.module.css';
import { GuestTripCard, TAB_KEYS } from './guest-trip-card.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s08.heading'), robots: { index: false, follow: false } };
}

/**
 * S08 — « Mis viajes » du voyageur (US-214, ADR-160 ; 16 BKG-027 ; 10b S08 : onglets, statut,
 * voiture, hôte, action principale ; vide « Aún no tienes viajes » (`web.s08.empty` de 10b, clé `web.s08.none` : la clé de 10b est tenue par le prototype) + bouton de recherche). Sections dans
 * l'ordre de l'API : demandes en attente de l'hôte, à venir, en cours, passés, annulés (seules les
 * sections non vides sont montrées, PROPOSÉ comme Turo). Le serveur lit l'API avec la session du
 * voyageur : la liste ne contient que SES trips (jugés en base). Lecture seule ; états : sans
 * session (connexion), vide, erreur, chargement (`loading.tsx`).
 */
export default async function GuestTripsPage() {
  const i18n = await getRequestI18n();
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']} data-testid="s08-title">
          {t('web.s08.heading')}
        </h1>
      </header>
      {body}
    </main>
  );
  const reply = await callApi('GET', '/trips', ctx);
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  const trips = guestTripsOf(reply);
  if (trips === null) {
    return shell(
      <ErrorState
        i18n={i18n}
        message={t('web.s08.loadError')}
        action={<ButtonLink href="/trips">{t('web.contract.retry')}</ButtonLink>}
      />,
    );
  }
  if (trips.length === 0) {
    return shell(
      <EmptyState
        icon="car"
        headingLevel={2}
        title={t('web.s08.none')}
        action={<ButtonLink href="/search">{t('web.s08.emptyCta')}</ButtonLink>}
      />,
    );
  }
  return shell(
    <>
      {GUEST_TRIP_TABS.map((tab) => {
        const shown = trips.filter((x) => x.tab === tab);
        if (shown.length === 0) return null;
        const headingId = `s08-${tab.toLowerCase()}`;
        return (
          <section
            key={tab}
            className={styles['section']}
            aria-labelledby={headingId}
            data-testid={headingId}
          >
            <h2 id={headingId} className={accountStyles['h2']}>
              {t(TAB_KEYS[tab])}
            </h2>
            <ul className={styles['rows']}>
              {shown.map((trip) => (
                <li key={trip.id}>
                  <GuestTripCard i18n={i18n} trip={trip} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className={styles['hint']}>{t('web.s09.changes')}</p>
    </>,
  );
}
