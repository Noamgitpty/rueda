import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Badge, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi, codeOf } from '../../../../account/api-client.ts';
import { guestTripOf, hasRefund } from '../../../../account/guest-trips.ts';
import type { ContractState } from '../../../../account/guest-trips.ts';
import { clientContext } from '../../../../account/request.ts';
import { UUID } from '../../../../account/trip-contract.ts';
import { getRequestI18n } from '../../../../i18n.ts';
import accountStyles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';
import styles from '../../host/host.module.css';
import { GuestTripCard } from '../guest-trip-card.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s09.heading'), robots: { index: false, follow: false } };
}

const CONTRACT_KEYS = {
  NONE: 'web.s09.documents.contract.NONE',
  TO_SIGN: 'web.s09.documents.contract.TO_SIGN',
  SIGNED: 'web.s09.documents.contract.SIGNED',
} as const satisfies Readonly<Record<ContractState, string>>;

const PAYMENT_KEYS = {
  CONFIRMED: 'web.s09.payment.CONFIRMED',
  REFUNDED_PARTIAL: 'web.s09.payment.REFUNDED_PARTIAL',
  REFUNDED: 'web.s09.payment.REFUNDED',
} as const;

/**
 * S09 — détail du trip du voyageur (US-214, ADR-160 ; 19 US-214 ; 16 BKG-027 ; 10b S09 « tout ce
 * qu'il faut le jour J ») : horaires dans le fuseau du trip, lieu de remise (adresse exacte d'un
 * trip à venir ou en cours seulement), hôte en prénom et initiale, total payé (devis figé relu de
 * l'API, jamais recalculé ; PYG sans décimale), documents (contrat S09 · contrat d'US-211 ;
 * constancia d'US-212 liée dès que le contrat existe, reçu d'US-217 annoncé « bientôt »), lien vers le remboursement (S10) d'un
 * trip annulé ou remboursé. Lecture seule : toute modification passe par le support en bêta
 * (08 BR-MOD-01). Un trip d'une autre personne, ou inconnu, rend le même message (404 de l'API).
 * Check-in, retard, refus, urgence et messages (10b S09) : lot 3.
 */
export default async function GuestTripPage({
  params,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
}) {
  const [i18n, { tripId }] = await Promise.all([getRequestI18n(), params]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const self = `/trips/${tripId}`;
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href="/trips">
          {t('web.s09.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="s09-title">
          {t('web.s09.heading')}
        </h1>
      </header>
      {body}
    </main>
  );
  const notFound = shell(
    <EmptyState icon="car" headingLevel={2} title={t('common.trips.notFound')} />,
  );
  if (!UUID.test(tripId)) return notFound;
  const reply = await callApi('GET', `/trips/${tripId}`, ctx);
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return notFound;
  const trip = guestTripOf(reply, tripId);
  if (trip === null) {
    return shell(
      <ErrorState
        i18n={i18n}
        message={t('web.s09.loadError')}
        action={<ButtonLink href={self}>{t('web.contract.retry')}</ButtonLink>}
      />,
    );
  }
  const total =
    trip.totalMinor === null
      ? null
      : i18n.money({
          amountMinor: trip.totalMinor,
          currency: trip.currency,
          exponent: trip.currencyExponent,
        });
  const contract = trip.contract ?? 'NONE';
  // trip annulé ou terminé sans signature : rien à signer (jamais une invitation trompeuse)
  const unsigned = contract !== 'SIGNED' && (trip.tab === 'CANCELLED' || trip.tab === 'DONE');
  return shell(
    <>
      <GuestTripCard i18n={i18n} trip={trip} headingLevel={2} link={false} />

      <p className={styles['hint']}>{t('web.s09.localTime')}</p>
      <p className={styles['hint']}>{t('web.s09.host.lead')}</p>

      <section className={styles['section']} aria-labelledby="s09-place" data-testid="s09-place">
        <h2 id="s09-place" className={accountStyles['h2']}>
          {t('web.s09.place.title')}
        </h2>
        {trip.handover.place !== null && <p className={styles['strong']}>{trip.handover.place}</p>}
        {trip.handover.address !== null && (
          <p className={accountStyles['text']} data-testid="s09-address">
            {[trip.handover.address, trip.handover.city].filter(Boolean).join(', ')}
          </p>
        )}
        {trip.handover.address === null && (
          <p className={styles['hint']}>{t('web.s09.place.hidden')}</p>
        )}
      </section>

      <section className={styles['section']} aria-labelledby="s09-payment">
        <h2 id="s09-payment" className={accountStyles['h2']}>
          {t('web.s09.payment.title')}
        </h2>
        {total !== null && (
          <div className={styles['between']}>
            <span>{t('web.s09.payment.total')}</span>
            <span className={styles['strong']} data-testid="s09-total">
              {total}
            </span>
          </div>
        )}
        {trip.paymentStatus !== null && (
          <div>
            <Badge tone={trip.paymentStatus === 'CONFIRMED' ? 'success' : 'neutral'}>
              {t(PAYMENT_KEYS[trip.paymentStatus])}
            </Badge>
          </div>
        )}
        {hasRefund(trip) && (
          <a className={styles['link']} href={`/trips/${trip.id}/refund`} data-testid="s09-refund">
            {t('web.s09.refund.link')}
          </a>
        )}
      </section>

      <section
        className={styles['section']}
        aria-labelledby="s09-documents"
        data-testid="s09-documents"
      >
        <h2 id="s09-documents" className={accountStyles['h2']}>
          {t('web.s09.documents.title')}
        </h2>
        <ul className={styles['rows']}>
          <li className={styles['card']}>
            <div className={styles['between']}>
              <span className={styles['strong']}>{t('web.s09.documents.contract')}</span>
              <Badge tone={contract === 'SIGNED' ? 'success' : unsigned ? 'neutral' : 'warning'}>
                {unsigned ? t('web.s09.documents.contract.UNSIGNED') : t(CONTRACT_KEYS[contract])}
              </Badge>
            </div>
            {contract !== 'NONE' && !unsigned && (
              <a
                className={styles['link']}
                href={`/trips/${trip.id}/contract`}
                data-testid="s09-contract"
              >
                {t('web.s09.documents.open')}
              </a>
            )}
          </li>
          {/* constancia d'arrendamiento (US-212) : tirée du contrat figé ; aucune pour un trip annulé */}
          {trip.tab !== 'CANCELLED' && (
            <li className={styles['card']}>
              <div className={styles['between']}>
                <span className={styles['strong']}>{t('web.s09.documents.constancia')}</span>
                {contract === 'NONE' && (
                  <Badge tone="neutral">{t('web.s09.documents.contract.NONE')}</Badge>
                )}
              </div>
              {contract !== 'NONE' && (
                <a
                  className={styles['link']}
                  href={`/trips/${trip.id}/constancia`}
                  data-testid="s09-constancia"
                >
                  {t('web.contract.constancia')}
                </a>
              )}
            </li>
          )}
          <li className={styles['card']}>
            <div className={styles['between']}>
              <span className={styles['strong']}>{t('web.s09.documents.receipt')}</span>
              <Badge tone="neutral">{t('web.s09.documents.soon')}</Badge>
            </div>
          </li>
        </ul>
      </section>

      <p className={styles['hint']} data-testid="s09-changes">
        {t('web.s09.changes')}
      </p>
    </>,
  );
}
