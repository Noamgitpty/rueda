import { Badge } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import type { Translator } from '@rueda/i18n';
import { guestCarLabel, guestTripHref, guestTripReference } from '../../../account/guest-trips.ts';
import type { GuestTripTab, GuestTripView } from '../../../account/guest-trips.ts';
import accountStyles from '../_account/account.module.css';
import styles from '../host/host.module.css';

export const TAB_TONE: Readonly<Record<GuestTripTab, BadgeTone>> = {
  REQUESTED: 'warning',
  UPCOMING: 'success',
  IN_PROGRESS: 'warning',
  DONE: 'neutral',
  CANCELLED: 'danger',
};

/** Titre de section (S08) et badge de chaque élément : clés de 10b §4.3 et compléments. */
export const TAB_KEYS = {
  REQUESTED: 'web.s08.section.REQUESTED',
  UPCOMING: 'web.s08.section.UPCOMING',
  IN_PROGRESS: 'web.s08.section.IN_PROGRESS',
  DONE: 'web.s08.section.DONE',
  CANCELLED: 'web.s08.section.CANCELLED',
} as const satisfies Readonly<Record<GuestTripTab, string>>;

/**
 * Carte d'un trip ou d'une demande du voyageur (S08, US-214 ; 10b S08 « statut, voiture, hôte,
 * action principale ») : référence, auto (sans plaque), dates dans le fuseau du trip, hôte en prénom
 * et initiale, heure limite de réponse d'une demande, lien vers le détail (S09) ou vers la demande.
 * Jetons de thème seulement ; aucune action d'écriture.
 */
export function GuestTripCard({
  i18n,
  trip,
  headingLevel = 3,
  link = true,
}: {
  readonly i18n: Translator;
  readonly trip: GuestTripView;
  readonly headingLevel?: 2 | 3;
  readonly link?: boolean;
}) {
  const t = i18n.t.bind(i18n);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const headingId = `trip-${trip.id}`;
  const ref = guestTripReference(trip);
  const isRequest = trip.kind === 'REQUEST';
  return (
    <article className={styles['card']} aria-labelledby={headingId} data-testid="s08-trip">
      <div className={styles['between']}>
        <H id={headingId} className={styles['strong']}>
          {isRequest ? t('web.s08.request') : t('web.s08.reference', { ref })}
        </H>
        <Badge tone={TAB_TONE[trip.tab]}>{t(TAB_KEYS[trip.tab])}</Badge>
      </div>
      <p className={accountStyles['text']}>{guestCarLabel(trip)}</p>
      <p className={accountStyles['text']}>
        {t('web.s08.dates', {
          start: i18n.dateTime(trip.startsAt, trip.timezone),
          end: i18n.dateTime(trip.endsAt, trip.timezone),
        })}
      </p>
      <p className={accountStyles['text']}>
        {t('web.s08.host', { name: trip.hostName ?? t('web.s08.hostHidden') })}
      </p>
      {/* demande acceptée, capture en vol : l'hôte a répondu, le paiement se confirme */}
      {trip.kind === 'REQUEST' && trip.status === 'PAYMENT_IN_FLIGHT' && (
        <p className={styles['hint']}>{t('web.s08.requestAccepted')}</p>
      )}
      {trip.kind === 'REQUEST' &&
        trip.status !== 'PAYMENT_IN_FLIGHT' &&
        trip.respondBy !== null && (
          <p className={styles['hint']}>
            {t('web.s08.respondBy', { date: i18n.dateTime(trip.respondBy, trip.timezone) })}
          </p>
        )}
      {link && (
        <a
          className={styles['link']}
          href={guestTripHref(trip)}
          aria-label={`${isRequest ? t('web.s08.openRequest') : t('web.s08.openTrip')} · ${ref}`}
        >
          {isRequest ? t('web.s08.openRequest') : t('web.s08.openTrip')}
        </a>
      )}
    </article>
  );
}
