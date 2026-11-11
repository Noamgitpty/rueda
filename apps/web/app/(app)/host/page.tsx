import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import type { MessageKey, Translator } from '@rueda/i18n';
import { callApi } from '../../../account/api-client.ts';
import {
  hostAccountsOf,
  listingsOf,
  locationsOf,
  vehiclesOf,
} from '../../../account/host-listings.ts';
import type { ListingView, VehicleView } from '../../../account/host-listings.ts';
import { clientContext } from '../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import { ListingForms, LocationForm, NewListingForm, VehicleForm } from './host-forms.tsx';
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

/** Unités mineures → saisie dans la langue de la vue (sans symbole, sans flottant). */
function inputOf(i18n: Translator, minor: bigint, exponent: number): string {
  const digits = minor.toString().padStart(exponent + 1, '0');
  const cut = digits.length - exponent;
  return exponent === 0
    ? digits
    : `${digits.slice(0, cut)}${i18n.profile.number.decimal}${digits.slice(cut)}`;
}

/**
 * A10 — espace de l'hôte (US-115 ; 10b §4.1, maquette US-033 : « Publicar tu auto ») : lieux de
 * remise, autos, annonces (brouillon, prix, photos, soumission). Le serveur lit l'API avec la
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
  const [locReply, vehReply, lstReply] = await Promise.all([
    callApi('GET', `${base}/locations`, ctx),
    callApi('GET', `${base}/vehicles`, ctx),
    callApi('GET', `${base}/listings`, ctx),
  ]);
  const locations = locationsOf(locReply);
  const vehicles = vehiclesOf(vehReply);
  const listed = listingsOf(lstReply);
  if (locations === null || vehicles === null || listed === null) return error;
  const { listings, market } = listed;
  const free = vehicles.filter((v) => v.listingId === null);
  const statusOf = (l: ListingView): string =>
    STATUSES.has(l.status) ? t(`web.host.status.${l.status}` as MessageKey) : l.status;
  return shell(
    <>
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
                exponent={market.currencyExponent}
                editable={editable}
                defaults={{
                  price: inputOf(i18n, l.dailyPriceMinor, market.currencyExponent),
                  km:
                    l.mileageMode === 'INCLUDED' && l.includedKmPerDay !== null
                      ? String(l.includedKmPerDay)
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
            exponent={market.currencyExponent}
          />
        )}
      </section>
    </>,
  );
}
