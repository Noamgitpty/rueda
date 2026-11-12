import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import type { MessageKey } from '@rueda/i18n';
import { callApi } from '../../../account/api-client.ts';
import {
  formatPhotoMax,
  hostAccountsOf,
  inputFromMinor,
  listingsOf,
  locationsOf,
  vehiclesOf,
} from '../../../account/host-listings.ts';
import type { ListingView, VehicleView } from '../../../account/host-listings.ts';
import { hostTermsOf } from '../../../account/host-terms.ts';
import {
  regulatoryNoticesOf,
  regulatoryNoticesPath,
  regulatoryNoticesUnavailable,
} from '../../../account/regulatory-notices.ts';
import { clientContext } from '../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { RegulatoryNotices } from '../_account/regulatory-notices.tsx';
import { MAIN_ID } from '../_shell/main-id.ts';
import {
  HostTermsForm,
  ListingForms,
  LocationForm,
  NewListingForm,
  VehicleForm,
} from './host-forms.tsx';
import styles from './host.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.host.title'), robots: { index: false, follow: false } };
}

const TONE: Readonly<Record<string, BadgeTone>> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  LISTED: 'success',
  REJECTED: 'danger',
  BLOCKED_ELIGIBILITY: 'danger',
  RESTRICTED: 'danger',
};
const STATUSES = new Set([
  'DRAFT',
  'BLOCKED_ELIGIBILITY',
  'PENDING_REVIEW',
  'LISTED',
  'REJECTED',
  'SNOOZED',
  'UNLISTED',
  'RESTRICTED',
  'REMOVED_BY_PLATFORM',
  'DELETED',
]);

const carLabel = (v: VehicleView): string =>
  `${[v.makeText, v.modelText].filter(Boolean).join(' ')} ${v.year} · ${v.plate}`;

/** Nom du pays dans la langue de la vue (`Intl.DisplayNames`), sinon son code. */
function countryName(tag: string, code: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * A10 — espace de l'hôte (US-115 ; 10b §4.1, maquette US-033 : « Publicar tu auto ») : lieux de
 * remise, autos, annonces (brouillon, prix, photos, soumission) ; CGU de l'hôte (US-126 : version,
 * date, brouillon, acceptation de la version affichée avant la soumission). Le serveur lit l'API avec la
 * session de l'hôte ; un compte d'un autre hôte n'est jamais lisible (404 de l'API). États :
 * sans session, sans compte d'hôte, vide, erreur (API injoignable), chargement (`loading.tsx`) ;
 * hors connexion : bandeau de la coquille et écran `/offline` du service worker.
 */
export default async function HostPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, tag, query] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    searchParams,
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  const header = (
    <header className={accountStyles['stackTight']}>
      <h1 className={accountStyles['h1']}>{t('web.host.title')}</h1>
      <p className={accountStyles['muted']}>{t('web.host.intro')}</p>
    </header>
  );
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      {header}
      {body}
    </main>
  );
  const error = shell(
    <ErrorState
      i18n={i18n}
      message={t('web.host.error')}
      action={<ButtonLink href="/host">{t('web.host.retry')}</ButtonLink>}
    />,
  );
  if (ctx.sessionToken === null) {
    return shell(
      <EmptyState
        icon="car"
        title={t('web.host.loginRequired')}
        action={<ButtonLink href="/login">{t('web.host.login')}</ButtonLink>}
      />,
    );
  }
  const session = await callApi('GET', '/auth/session', ctx);
  if (session.status === 401) {
    return shell(
      <EmptyState
        icon="car"
        title={t('web.host.loginRequired')}
        action={<ButtonLink href="/login">{t('web.host.login')}</ButtonLink>}
      />,
    );
  }
  const accounts = hostAccountsOf(session);
  if (accounts === null) return error;
  if (accounts.length === 0) {
    return shell(
      <EmptyState icon="car" title={t('web.host.noAccount')} body={t('web.host.noAccount.body')} />,
    );
  }
  const wanted = typeof query['org'] === 'string' ? query['org'] : undefined;
  const account = accounts.find((a) => a.orgId === wanted) ?? accounts[0];
  if (account === undefined) return error;
  const base = `/host/accounts/${account.orgId}`;
  const [locReply, vehReply, lstReply, termsReply, noticeReply] = await Promise.all([
    callApi('GET', `${base}/locations`, ctx),
    callApi('GET', `${base}/vehicles`, ctx),
    callApi('GET', `${base}/listings`, ctx),
    callApi('GET', `${base}/terms?${new URLSearchParams({ locale: tag }).toString()}`, ctx),
    // US-125 : limite légale connue du pays du compte (route publique, sans session)
    callApi('GET', regulatoryNoticesPath(account.country, 'HOST'), { ...ctx, sessionToken: null }),
  ]);
  // CGU de l'hôte (US-126) : illisibles ⇒ « indisponibles », jamais une acceptation présumée
  const terms = hostTermsOf(termsReply);
  const notices = regulatoryNoticesOf(noticeReply, account.country, 'HOST');
  const locations = locationsOf(locReply);
  const vehicles = vehiclesOf(vehReply);
  const listed = listingsOf(lstReply);
  if (locations === null || vehicles === null || listed === null) return error;
  const { listings, market, photoUploads } = listed;
  const number = i18n.profile.number;
  const photos = { ...photoUploads, maxLabel: formatPhotoMax(photoUploads.maxBytes, tag) };
  const free = vehicles.filter((v) => v.listingId === null);
  const statusOf = (l: ListingView): string =>
    STATUSES.has(l.status) ? t(`web.host.status.${l.status}` as MessageKey) : l.status;
  return shell(
    <>
      {/* compte affiché : pays et devise ; un hôte dans plusieurs pays change de compte ici */}
      <p className={accountStyles['text']}>
        {t('web.host.account.market', {
          country: countryName(tag, account.country),
          currency: market.currency,
        })}
      </p>
      {accounts.length > 1 && (
        <nav aria-labelledby="a10-accounts">
          <h2 id="a10-accounts" className={accountStyles['h2']}>
            {t('web.host.account.switch')}
          </h2>
          <ul className={styles['accounts']}>
            {accounts.map((a) => (
              <li key={a.orgId}>
                <a
                  className={styles['account']}
                  href={`/host?org=${a.orgId}`}
                  aria-current={a.orgId === account.orgId ? 'page' : undefined}
                >
                  {countryName(tag, a.country)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <RegulatoryNotices
        i18n={i18n}
        notices={notices}
        headingId="a10-notices"
        unavailable={regulatoryNoticesUnavailable(noticeReply)}
      />
      <section className={styles['section']} aria-labelledby="a10-terms">
        <h2 id="a10-terms" className={accountStyles['h2']}>
          {t('web.host.terms.title')}
        </h2>
        <p className={accountStyles['muted']}>{t('web.host.terms.intro')}</p>
        {terms === null ? (
          <Banner tone="danger">{t('common.legal.unavailable')}</Banner>
        ) : (
          <>
            {terms.draft && <Banner tone="warning">{t('web.legal.draft')}</Banner>}
            <p className={accountStyles['text']}>
              <a
                className={styles['link']}
                href={`/legal/TOS_HOST?${new URLSearchParams({ country: account.country, from: 'host' }).toString()}`}
                target="_blank"
                rel="noopener"
              >
                {t('web.host.terms.read')}
              </a>{' '}
              <Badge>
                {t('web.host.terms.version', {
                  version: String(terms.version),
                  date: i18n.date(terms.validFrom, terms.timeZone),
                })}
              </Badge>
            </p>
            {terms.acceptedVersion !== null && terms.acceptedAt !== null && (
              <p className={accountStyles['text']}>
                {t('web.host.terms.accepted', {
                  version: String(terms.acceptedVersion),
                  date: i18n.date(terms.acceptedAt, terms.timeZone),
                })}
              </p>
            )}
            {terms.reacceptRequired && (
              <>
                <Banner tone="warning">
                  {terms.acceptedVersion === null
                    ? t('web.host.terms.required')
                    : t('web.host.terms.reaccept')}
                </Banner>
                <HostTermsForm localeTag={tag} orgId={account.orgId} version={terms.version} />
              </>
            )}
          </>
        )}
      </section>
      {query['saved'] === '1' && (
        <Banner tone="success" live="polite" icon="check">
          {t('web.host.saved')}
        </Banner>
      )}
      {listings.length === 0 && (
        <EmptyState icon="car" title={t('web.host.empty')} body={t('web.host.empty.body')} />
      )}

      <section className={styles['section']} aria-labelledby="a10-places">
        <h2 id="a10-places" className={accountStyles['h2']}>
          {t('web.host.places.title')}
        </h2>
        {locations.length === 0 ? (
          <p className={accountStyles['muted']}>{t('web.host.places.empty')}</p>
        ) : (
          <ul className={styles['rows']}>
            {locations.map((l) => (
              <li key={l.id} className={styles['card']}>
                <span className={styles['strong']}>{l.label}</span>
                <span>
                  {l.addressLine} · {l.city}
                  {l.areaLabel !== null ? ` · ${l.areaLabel}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <LocationForm localeTag={tag} orgId={account.orgId} />
      </section>

      <section className={styles['section']} aria-labelledby="a10-cars">
        <h2 id="a10-cars" className={accountStyles['h2']}>
          {t('web.host.cars.title')}
        </h2>
        {vehicles.length > 0 && (
          <ul className={styles['rows']}>
            {vehicles.map((v) => (
              <li key={v.id} className={styles['card']}>
                <span className={styles['strong']}>{carLabel(v)}</span>
                {/* A06 : calendrier, blocages et préavis du véhicule (US-119) */}
                <a
                  className={styles['link']}
                  href={`/host/vehicles/${v.id}?org=${account.orgId}`}
                  aria-label={`${t('web.calendar.open')} · ${carLabel(v)}`}
                >
                  {t('web.calendar.open')}
                </a>
              </li>
            ))}
          </ul>
        )}
        {locations.length === 0 ? (
          <p className={accountStyles['muted']}>{t('web.host.cars.needPlace')}</p>
        ) : (
          <VehicleForm
            localeTag={tag}
            orgId={account.orgId}
            locations={locations.map((l) => ({ id: l.id, label: l.label }))}
          />
        )}
      </section>

      <section className={styles['section']} aria-labelledby="a10-listings">
        <h2 id="a10-listings" className={accountStyles['h2']}>
          {t('web.host.listings.title')}
        </h2>
        {listings.map((l) => {
          const car = vehicles.find((v) => v.id === l.vehicleId);
          const editable = ['DRAFT', 'REJECTED', 'BLOCKED_ELIGIBILITY'].includes(l.status);
          return (
            <article key={l.id} className={styles['card']} aria-labelledby={`a10-l-${l.id}`}>
              <div className={styles['between']}>
                <h3 id={`a10-l-${l.id}`} className={styles['strong']}>
                  {car === undefined ? l.id.slice(0, 8) : carLabel(car)}
                </h3>
                <Badge tone={TONE[l.status] ?? 'neutral'}>{statusOf(l)}</Badge>
              </div>
              <p className={accountStyles['text']}>
                {t('web.listing.perDay', {
                  amount: i18n.money({
                    amountMinor: l.dailyPriceMinor,
                    currency: market.currency,
                    exponent: market.currencyExponent,
                  }),
                })}
                {' · '}
                {l.mileageMode === 'INCLUDED' && l.includedKmPerDay !== null
                  ? t('web.host.listing.kmPerDay', { count: l.includedKmPerDay })
                  : t('web.host.listing.unlimited')}
                {' · '}
                {t('web.host.listing.photos', { count: l.photos })}
              </p>
              {l.status === 'LISTED' && (
                <a className={styles['link']} href={`/listings/${l.id}`}>
                  {t('web.host.listing.view')}
                </a>
              )}
              <ListingForms
                localeTag={tag}
                orgId={account.orgId}
                listingId={l.id}
                currency={market.currency}
                editable={editable}
                draft={l.status === 'DRAFT'}
                photos={photos}
                defaults={{
                  price: inputFromMinor(l.dailyPriceMinor, market.currencyExponent, number),
                  km:
                    l.mileageMode === 'INCLUDED' && l.includedKmPerDay !== null
                      ? String(l.includedKmPerDay)
                      : '',
                  // prix du km relu de l'API : un changement de prix ne le remet jamais à 0
                  extraKm:
                    l.mileageMode === 'INCLUDED' && l.extraKmPriceMinor !== null
                      ? inputFromMinor(l.extraKmPriceMinor, market.currencyExponent, number)
                      : '',
                }}
              />
            </article>
          );
        })}
        {free.length === 0 ? (
          vehicles.length === 0 && (
            <p className={accountStyles['muted']}>{t('web.host.listings.needCar')}</p>
          )
        ) : (
          <NewListingForm
            localeTag={tag}
            orgId={account.orgId}
            vehicles={free.map((v) => ({ id: v.id, label: carLabel(v) }))}
            currency={market.currency}
          />
        )}
      </section>
    </>,
  );
}
