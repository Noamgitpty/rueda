import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { Banner, EmptyState } from '@rueda/ui';
import { callApi } from '../../../../../account/api-client.ts';
import { tripHelpOf } from '../../../../../account/help.ts';
import { clientContext } from '../../../../../account/request.ts';
import { UUID } from '../../../../../account/trip-contract.ts';
import { getRequestBrand } from '../../../../../brand-source.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { HelpNumbers } from '../../../_help/help-numbers.tsx';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import styles from '../../../host/host.module.css';
import { HelpRequestForm } from './help-request-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.help.trip.title'), robots: { index: false, follow: false } };
}

/**
 * Aide d'un trip (S17 depuis S09 et depuis le trip de l'hôte ; US-310, ADR-182 ; 16 SUP-004) : les
 * numéros du pays DU TRIP (urgence, autorité de circulation, assistance de l'assureur, support),
 * puis la demande d'aide à motif fermé, enregistrée côté support. Voyageur et hôte : la base juge
 * la partie (celle de la session) ; un trip d'une autre personne ou inconnu rend le même message.
 * Jamais le téléphone de l'autre partie. Retour : S09 du voyageur, ou trip de l'hôte.
 */
export default async function TripHelpPage({
  params,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
}) {
  const [i18n, tag, brand, { tripId }] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    getRequestBrand(),
    params,
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const shell = (back: string | null, body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        {back !== null && (
          <a className={styles['link']} href={back}>
            {t('web.help.trip.back')}
          </a>
        )}
        <h1 className={accountStyles['h1']} data-testid="s17-trip-title">
          {t('web.help.trip.title')}
        </h1>
      </header>
      {body}
    </main>
  );
  const notFound = shell(
    '/trips',
    <EmptyState icon="car" headingLevel={2} title={t('common.trips.notFound')} />,
  );
  if (!UUID.test(tripId)) return notFound;
  const reply = await callApi('GET', `/trips/${tripId}/help`, ctx);
  if (reply.status === 401) redirect('/login');
  if (reply.status === 404) return notFound;
  const help = tripHelpOf(reply, tripId);
  if (help === null) {
    return shell(
      '/trips',
      <Banner tone="danger" live="assertive">
        <span data-testid="s17-unavailable">{t('web.help.unavailable')}</span>
      </Banner>,
    );
  }
  const back = help.role === 'HOST' ? `/host/trips/${tripId}` : `/trips/${tripId}`;
  return shell(
    back,
    <>
      <HelpNumbers i18n={i18n} help={help.help} brand={brand.name} idPrefix="s17-trip" />
      <section className={styles['section']}>
        <HelpRequestForm
          localeTag={tag}
          tripId={tripId}
          requestId={randomUUID()}
          brand={brand.name}
          role={help.role}
        />
      </section>
    </>,
  );
}
