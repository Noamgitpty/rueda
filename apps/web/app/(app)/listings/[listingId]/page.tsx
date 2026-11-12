import type { Metadata } from 'next';
import { Badge, ButtonLink, CarIllustration, EmptyState, ErrorState, Icon } from '@rueda/ui';
import type { MessageKey } from '@rueda/i18n';
import { callApi } from '../../../../account/api-client.ts';
import { publicListingOf } from '../../../../account/host-listings.ts';
import {
  regulatoryNoticesOf,
  regulatoryNoticesPath,
  regulatoryNoticesUnavailable,
} from '../../../../account/regulatory-notices.ts';
import { clientContext } from '../../../../account/request.ts';
import { getRequestI18n } from '../../../../i18n.ts';
import accountStyles from '../../_account/account.module.css';
import { RegulatoryNotices } from '../../_account/regulatory-notices.tsx';
import { MAIN_ID } from '../../_shell/main-id.ts';
import styles from '../../host/host.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.listing.meet.title'), robots: { index: false, follow: false } };
}

const TRANSMISSIONS = new Set(['MANUAL', 'AUTOMATIC']);
const FUELS = new Set(['GASOLINE', 'DIESEL', 'HYBRID', 'EV']);

/**
 * S03 — fiche publique d'une annonce publiée (US-115 critère 4 ; 10b §4.1, maquette US-033) : prix
 * par jour, l'essentiel du véhicule, distance incluse, mode de réservation, et SEULEMENT la zone
 * approximative du lieu de remise (ville, zone saisie) ; l'adresse exacte n'apparaît qu'après la
 * confirmation (US-514). L'API ne sert d'ailleurs que des colonnes C0. États : annonce introuvable
 * ou non publiée (404), erreur (API injoignable), chargement (`loading.tsx`) ; hors connexion :
 * coquille et écran `/offline`.
 */
export default async function ListingPage({
  params,
}: {
  readonly params: Promise<{ readonly listingId: string }>;
}) {
  const [i18n, { listingId }] = await Promise.all([getRequestI18n(), params]);
  const t = i18n.t.bind(i18n);
  const reply = /^[0-9a-f-]{36}$/.test(listingId)
    ? await callApi('GET', `/listings/${listingId}`, {
        ...(await clientContext()),
        sessionToken: null,
      })
    : ({ status: 404, json: null, session: null } as const);
  const listing = publicListingOf(reply);
  if (listing === null) {
    return (
      <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
        {reply.status === 404 ? (
          <EmptyState
            icon="car"
            headingLevel={2}
            title={t('web.listing.notFound')}
            body={t('web.listing.notFound.body')}
            action={<ButtonLink href="/">{t('web.listing.search')}</ButtonLink>}
          />
        ) : (
          <ErrorState
            i18n={i18n}
            message={t('web.listing.error')}
            action={<ButtonLink href={`/listings/${listingId}`}>{t('web.host.retry')}</ButtonLink>}
          />
        )}
      </main>
    );
  }
  const title = `${listing.makeName} ${listing.modelName} ${listing.year}`;
  // US-125 : limite légale connue du pays de l'annonce, pour le voyageur
  const noticeReply = await callApi('GET', regulatoryNoticesPath(listing.country, 'GUEST'), {
    ...(await clientContext()),
    sessionToken: null,
  });
  const notices = regulatoryNoticesOf(noticeReply, listing.country, 'GUEST');
  return (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <div className={styles['media']}>
        <CarIllustration />
      </div>
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']}>{title}</h1>
        <p className={styles['price']}>
          {t('web.listing.perDay', {
            amount: i18n.money({
              amountMinor: listing.dailyPriceMinor,
              currency: listing.currency,
              exponent: listing.currencyExponent,
            }),
          })}
        </p>
        <div>
          <Badge tone={listing.instantBook ? 'success' : 'neutral'}>
            {t(listing.instantBook ? 'web.listing.instant' : 'web.listing.request')}
          </Badge>
        </div>
      </header>

      <RegulatoryNotices
        i18n={i18n}
        notices={notices}
        headingId="s03-notices"
        unavailable={regulatoryNoticesUnavailable(noticeReply)}
      />

      <section className={styles['section']} aria-labelledby="s03-features">
        <h2 id="s03-features" className={accountStyles['h2']}>
          {t('web.listing.features')}
        </h2>
        <ul className={styles['list']}>
          <li>{t('web.listing.seats', { count: listing.seats })}</li>
          {TRANSMISSIONS.has(listing.transmission) && (
            <li>{t(`web.host.car.transmission.${listing.transmission}` as MessageKey)}</li>
          )}
          {FUELS.has(listing.fuelType) && (
            <li>{t(`web.host.car.fuel.${listing.fuelType}` as MessageKey)}</li>
          )}
          <li>
            {listing.mileageMode === 'INCLUDED' && listing.includedKmPerDay !== null
              ? t('web.host.listing.kmPerDay', { count: listing.includedKmPerDay })
              : t('web.host.listing.unlimited')}
          </li>
        </ul>
      </section>

      <section className={styles['section']} aria-labelledby="s03-meet">
        <h2 id="s03-meet" className={accountStyles['h2']}>
          {t('web.listing.meet.title')}
        </h2>
        <p className={styles['between']}>
          <span className={styles['strong']}>
            <Icon name="pin" />{' '}
            {listing.areaLabel === null ? listing.city : `${listing.areaLabel}, ${listing.city}`}
          </span>
        </p>
        <p className={accountStyles['muted']}>{t('web.listing.meet.approx')}</p>
        {/* nom affiché de l'hôte : premier mot du prénom légal, jamais le nom complet (N-37) */}
        {listing.hostFirstName !== null && (
          <p className={accountStyles['text']}>
            {t('web.listing.hostName', { name: listing.hostFirstName })}
          </p>
        )}
      </section>
    </main>
  );
}
