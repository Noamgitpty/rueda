import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../../../account/api-client.ts';
import { hostAccountsOf } from '../../../../../account/host-listings.ts';
import { hostTripOf } from '../../../../../account/host-trips.ts';
import { clientContext } from '../../../../../account/request.ts';
import { phaseOf, tripRefundsOf } from '../../../../../account/trip-refunds.ts';
import type { HostRefundView, RefundPhase } from '../../../../../account/trip-refunds.ts';
import { getRequestI18n } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { RefundPhaseLines } from '../../../_refund/refund-phase.tsx';
import { REVIEWABLE_TRIP_STATUSES } from '../../../../../account/trip-reviews.ts';
import { incidentalHref, incidentalOffered } from '../../../../../account/trip-incidental.ts';
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
 *
 * US-224 partie 224d (ADR-154 ; 19 US-224 critère 1) : remboursement du voyageur vu par l'hôte,
 * jambe HOST seulement (part retirée de ses gains), état et date d'émission ; aucune donnée du
 * voyageur au-delà de la carte du trip. Section absente si aucun remboursement ; une lecture
 * impossible ne masque pas le reste de la page (message dans la section).
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
  const refundsReply = await callApi('GET', `/trips/${tripId}/refunds`, ctx);
  const refunds = tripRefundsOf(refundsReply);
  const shownRefunds: (HostRefundView & { readonly phase: RefundPhase })[] =
    refunds === null || refunds.viewerRole !== 'HOST'
      ? []
      : refunds.refunds.flatMap((r) => {
          const phase = phaseOf(r.status);
          return phase === null ? [] : [{ ...r, phase }];
        });
  const refundsFailed =
    refundsReply.status !== 404 && (refunds === null || refunds.viewerRole !== 'HOST');
  const hostMoney = (minor: string) =>
    refunds === null
      ? minor
      : i18n.money({
          amountMinor: BigInt(minor),
          currency: refunds.currency,
          exponent: refunds.currencyExponent,
        });
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
      {/* photos de l'état du véhicule (US-303) : à la remise (check-in ouvert) et au retour */}
      {(read.trip.status === 'CHECKIN_OPEN' ||
        read.trip.status === 'IN_PROGRESS' ||
        read.trip.status === 'OVERDUE') && (
        <a
          className={styles['link']}
          href={`/host/trips/${tripId}/inspection/${read.trip.status === 'CHECKIN_OPEN' ? 'checkin' : 'checkout'}?org=${account.orgId}`}
          data-testid="a05-inspection"
        >
          {t(
            read.trip.status === 'CHECKIN_OPEN'
              ? 'web.inspection.link.checkin'
              : 'web.inspection.link.checkout',
          )}
        </a>
      )}
      {/* remise et retour en personne (US-315) : A03 avant le départ, A04 pendant le trip */}
      {(['BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE'] as const).some(
        (s) => s === read.trip.status,
      ) && (
        <a
          className={styles['link']}
          href={`/host/trips/${tripId}/handover/${read.trip.status === 'IN_PROGRESS' || read.trip.status === 'OVERDUE' ? 'checkout' : 'checkin'}?org=${account.orgId}`}
          data-testid="a05-handover"
        >
          {t(
            read.trip.status === 'IN_PROGRESS' || read.trip.status === 'OVERDUE'
              ? 'web.handover.link.checkout'
              : 'web.handover.link.checkin',
          )}
        </a>
      )}
      {/* avis sur le voyageur (US-317, A12) : une fois la voiture rendue (fin effective) */}
      {REVIEWABLE_TRIP_STATUSES.some((s) => s === read.trip.status) && (
        <a
          className={styles['link']}
          href={`/host/trips/${tripId}/review?org=${account.orgId}`}
          data-testid="a05-review"
        >
          {t('web.review.link')}
        </a>
      )}
      {/* frais annexes demandés par l'hôte avec justificatif (US-706, 10b A04) : après le retour */}
      {incidentalOffered(read.trip.status) && (
        <a
          className={styles['link']}
          href={incidentalHref('HOST', tripId, account.orgId)}
          data-testid="a05-incidental"
        >
          {t('web.a04.addFee')}
        </a>
      )}
      {/* sinistres du trip (US-318, A09) : vol présumé, amendes, péages et fourrière, une fois le
          trip en retard ou la voiture rendue */}
      {(
        [
          'OVERDUE',
          'UNRETURNED',
          'VEHICLE_LOST',
          'RETURNED',
          'POST_TRIP',
          'COMPLETED',
          'IN_DISPUTE',
        ] as const
      ).some((s) => s === read.trip.status) && (
        <a
          className={styles['link']}
          href={`/host/trips/${tripId}/claims?org=${account.orgId}`}
          data-testid="a05-claims"
        >
          {t('web.traffic.link')}
        </a>
      )}
      {/* no-show du voyageur déclaré par l'hôte (US-307) : remise ouverte, pas encore commencée */}
      {(read.trip.status === 'CHECKIN_OPEN' || read.trip.status === 'START_WINDOW_EXPIRED') && (
        <a
          className={styles['link']}
          href={`/host/trips/${tripId}/no-show?org=${account.orgId}`}
          data-testid="a05-no-show"
        >
          {t('web.noShow.link.HOST')}
        </a>
      )}
      {(shownRefunds.length > 0 || refundsFailed) && (
        <section className={styles['section']} aria-labelledby="a05-refund-title">
          <h2 id="a05-refund-title" className={accountStyles['h2']}>
            {t('web.a05.refund.title')}
          </h2>
          {refundsFailed ? (
            <p className={styles['hint']}>{t('web.s10.refund.loadError')}</p>
          ) : (
            <>
              <p className={styles['hint']}>{t('web.a05.refund.lead')}</p>
              <ul className={styles['rows']} data-testid="a05-refunds">
                {shownRefunds.map((r) => (
                  <li key={`${r.plannedAt}-${r.hostLegMinor}`} className={styles['card']}>
                    <p className={styles['strong']} data-testid="a05-refund-host-leg">
                      {r.hostLegMinor === '0'
                        ? t('web.a05.refund.noImpact')
                        : t('web.a05.refund.hostLeg', { amount: hostMoney(r.hostLegMinor) })}
                    </p>
                    <RefundPhaseLines
                      i18n={i18n}
                      phase={r.phase}
                      issuedAt={r.issuedAt}
                      timezone={refunds?.timezone ?? 'UTC'}
                      bankDelay={false}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {/* aide et urgence du trip (US-310, S17) : numéros du pays du trip, demande d'aide */}
      <section className={styles['section']} aria-labelledby="a05-help-title">
        <h2 id="a05-help-title" className={accountStyles['h2']}>
          {t('web.help.trip.section')}
        </h2>
        <a className={styles['link']} href={`/trips/${tripId}/help`} data-testid="a05-help">
          {t('web.help.trip.open')}
        </a>
      </section>
      <p className={styles['hint']}>{t('web.a05.earnings.note')}</p>
      <p className={styles['hint']}>{t('web.a05.privacy')}</p>
    </>,
  );
}
