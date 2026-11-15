import { Badge } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import type { Translator } from '@rueda/i18n';
import { tripCarLabel, tripReference } from '../../../../account/host-trips.ts';
import type { HostTripView, TripMarket, TripTab } from '../../../../account/host-trips.ts';
import accountStyles from '../../_account/account.module.css';
import styles from '../host.module.css';

export const TAB_TONE: Readonly<Record<TripTab, BadgeTone>> = {
  UPCOMING: 'success',
  IN_PROGRESS: 'warning',
  DONE: 'neutral',
  CANCELLED: 'danger',
};

/**
 * Carte d'un trip de l'hôte (A02 prochaines remises et retours, A05 liste et détail ; US-219,
 * 10b UX-39, UX-43, UX-44) : référence, auto, lieu de remise, début et fin dans le fuseau du trip,
 * voyageur minimisé (prénom, âge, note, vérification ; jamais le permis ni une pièce), statut du
 * paiement, gains estimés (jambe HOST relue telle quelle, exposant de la devise du pays). Jetons de
 * thème seulement ; aucune action d'écriture (l'état ne change que par les commandes d'US-207).
 */
export function TripCard({
  i18n,
  trip,
  market,
  href,
  headingLevel = 3,
}: {
  readonly i18n: Translator;
  readonly trip: HostTripView;
  readonly market: TripMarket;
  readonly href: string | null;
  readonly headingLevel?: 2 | 3;
}) {
  const t = i18n.t.bind(i18n);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const headingId = `trip-${trip.tripId}`;
  const g = trip.guest;
  return (
    <article className={styles['card']} aria-labelledby={headingId}>
      <div className={styles['between']}>
        <H id={headingId} className={styles['strong']}>
          {t('web.a05.reference', { ref: tripReference(trip) })}
        </H>
        <Badge tone={TAB_TONE[trip.tab]}>{t(`web.a05.tab.${trip.tab}`)}</Badge>
      </div>
      <p className={accountStyles['text']}>{tripCarLabel(trip)}</p>
      <p className={accountStyles['text']}>
        {t('web.a05.start', { date: i18n.dateTime(trip.startsAt, trip.timezone) })}
        <br />
        {t('web.a05.end', { date: i18n.dateTime(trip.endsAt, trip.timezone) })}
      </p>
      {trip.handoverPlace !== null && (
        <p className={accountStyles['text']}>{t('web.a05.place', { place: trip.handoverPlace })}</p>
      )}
      <section className={styles['guest']} aria-label={t('web.a05.guest.title')}>
        <p className={accountStyles['text']}>
          <span className={styles['strong']}>{g.firstName ?? t('web.a05.guest.hidden')}</span>
          {g.ageYears !== null && <> · {t('web.a05.guest.age', { age: String(g.ageYears) })}</>}
        </p>
        <p className={accountStyles['text']}>
          {g.rating === null
            ? t('web.a05.guest.noRating')
            : t('web.a05.guest.rating', { rating: g.rating })}
        </p>
        <Badge tone={g.verified ? 'success' : 'warning'}>
          {g.verified ? t('web.host.guest.verified') : t('web.a05.guest.unverified')}
        </Badge>
      </section>
      <div className={styles['between']}>
        <Badge tone={trip.paymentStatus === 'CONFIRMED' ? 'success' : 'neutral'}>
          {t(`web.a05.payment.${trip.paymentStatus}`)}
        </Badge>
        {trip.hostEarningsMinor !== null && (
          <span className={styles['strong']}>
            {t('web.a05.earnings', {
              amount: i18n.money({
                amountMinor: trip.hostEarningsMinor,
                currency: trip.currency,
                exponent: market.currencyExponent,
              }),
            })}
          </span>
        )}
      </div>
      {href !== null && (
        <a
          className={styles['link']}
          href={href}
          aria-label={`${t('web.a05.open')} · ${tripReference(trip)}`}
        >
          {t('web.a05.open')}
        </a>
      )}
    </article>
  );
}
