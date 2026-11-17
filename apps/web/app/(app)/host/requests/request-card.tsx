import { Badge } from '@rueda/ui';
import type { Translator } from '@rueda/i18n';
import { requestReference } from '../../../../account/host-requests.ts';
import type { HostRequestView } from '../../../../account/host-requests.ts';
import accountStyles from '../../_account/account.module.css';
import styles from '../host.module.css';

/**
 * Carte d'une demande de réservation (A05 liste et détail ; US-223 partie 223d, ADR-152 ; 10b A05,
 * UX-44) : numéro (celui que voit le voyageur sur S06), auto, début et fin dans le fuseau du devis,
 * heure limite de réponse POSÉE PAR LA BASE (aucune durée écrite), voyageur minimisé comme les trips
 * (prénom, âge, note, vérification ; jamais le permis ni une pièce), total du voyage et gains estimés
 * (jambe HOST relue telle quelle, exposant de la devise du compte). Jetons de thème seulement.
 */
export function RequestCard({
  i18n,
  request,
  car,
  exponent,
  href,
  headingLevel = 3,
}: {
  readonly i18n: Translator;
  readonly request: HostRequestView;
  /** Libellé de l'auto (véhicules du compte) ; `null` : inconnu. */
  readonly car: string | null;
  readonly exponent: number;
  readonly href: string | null;
  readonly headingLevel?: 2 | 3;
}) {
  const t = i18n.t.bind(i18n);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const headingId = `request-${request.holdId}`;
  const g = request.guest;
  const tz = request.timezone;
  const ref = requestReference(request.holdId);
  const money = (amountMinor: bigint) =>
    i18n.money({ amountMinor, currency: request.currency, exponent });
  return (
    <article className={styles['card']} aria-labelledby={headingId} data-testid="a05-request">
      <div className={styles['between']}>
        <H id={headingId} className={styles['strong']}>
          {t('web.a05.request.heading', { ref })}
        </H>
        <Badge tone={request.status === 'AWAITING_HOST' ? 'warning' : 'success'}>
          {t(
            request.status === 'AWAITING_HOST'
              ? 'web.a05.request.awaiting'
              : 'web.a05.request.capturing',
          )}
        </Badge>
      </div>
      {car !== null && <p className={accountStyles['text']}>{car}</p>}
      <p className={accountStyles['text']}>
        {t('web.a05.start', { date: i18n.dateTime(request.startsAt, tz) })}
        <br />
        {t('web.a05.end', { date: i18n.dateTime(request.endsAt, tz) })}
      </p>
      {request.status === 'AWAITING_HOST' && (
        <p className={styles['strong']} data-testid="a05-request-respond-by">
          {t('web.a05.request.respondBy', { date: i18n.dateTime(request.respondBy, tz) })}
        </p>
      )}
      <section className={styles['guest']} aria-label={t('web.a05.guest.title')}>
        <p className={accountStyles['text']}>
          <span className={styles['strong']}>{g.firstName ?? t('web.a05.guest.hidden')}</span>
          {g.ageYears !== null && <> · {t('web.a05.guest.age', { age: String(g.ageYears) })}</>}
        </p>
        <p className={accountStyles['text']}>
          {g.rating === null
            ? t('web.a05.guest.noRating')
            : t('web.a05.guest.rating', { rating: i18n.number(g.rating, { fractionDigits: 1 }) })}
        </p>
        <Badge tone={g.verified ? 'success' : 'warning'}>
          {g.verified ? t('web.host.guest.verified') : t('web.a05.guest.unverified')}
        </Badge>
      </section>
      <p className={accountStyles['text']}>
        {t('web.a05.request.total', { amount: money(request.totalMinor) })}
      </p>
      {request.hostLegMinor !== null && (
        <p className={styles['strong']}>
          {t('web.a05.earnings', { amount: money(request.hostLegMinor) })}
        </p>
      )}
      {href !== null && (
        <a
          className={styles['link']}
          href={href}
          aria-label={`${t('web.a05.request.open')} · ${ref}`}
        >
          {t('web.a05.request.open')}
        </a>
      )}
    </article>
  );
}
