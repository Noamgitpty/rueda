import type { Metadata } from 'next';
import { ButtonLink, CarCard, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../account/api-client.ts';
import { clientContext } from '../../../account/request.ts';
import {
  listingHref,
  searchApiPath,
  searchAreasOf,
  searchErrorKey,
  searchInputOf,
  searchResultsOf,
} from '../../../account/search.ts';
import type { SearchResultView } from '../../../account/search.ts';
import { getRequestI18n } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import { ResultsMap } from '../_search/results-map.tsx';
import { SearchForm } from '../_search/search-form.tsx';
import styles from '../_search/search.module.css';

/** Montant d'une annonce dans sa devise (exposant fourni par l'API, aucune constante). */
const amountOf = (r: SearchResultView, amountMinor: bigint) => ({
  amountMinor,
  currency: r.currency,
  exponent: r.currencyExponent,
});

const titleOf = (r: SearchResultView): string => `${r.makeName} ${r.modelName} ${r.year}`;

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.search.results.title'), robots: { index: false, follow: false } };
}

/**
 * Résultats de la recherche, S02 (US-201, US-203 ; 16 SRC-001, SRC-008, SRC-011, SRC-042). Le
 * formulaire de S01 envoie ici, en GET, le lieu et les heures LOCALES du lieu ; la page valide la
 * forme (fin ≤ début ⇒ `SEARCH_DATES_INVALID`), appelle l'API puis montre les annonces
 * disponibles en LISTE de cartes (UX-65 : voiture, zone approximative seulement, note ou badge
 * « Nuevo », total TTC du séjour et prix par jour, caution de la plateforme ou mention générique)
 * et sur une CARTE de marqueurs de prix ; liste et carte viennent du même tableau : mêmes
 * annonces, mêmes totaux (19 US-203 critère 1). Aucun montant n'est calculé ici : le total vient
 * du devis provisoire de l'API (PRC), seulement formaté. Période affichée dans le fuseau du
 * véhicule, lien vers la fiche avec les dates reprises. États : refus (message du code, formulaire
 * repris), aucun résultat, API injoignable ; chargement : `loading.tsx`.
 */
export default async function SearchPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, query] = await Promise.all([getRequestI18n(), searchParams]);
  const t = i18n.t.bind(i18n);
  const ctx = { ...(await clientContext()), sessionToken: null };
  const parsed = searchInputOf(query);
  const defaults = parsed.ok ? parsed.input : null;
  const [areasReply, reply] = await Promise.all([
    callApi(
      'GET',
      defaults === null ? '/search/areas' : `/search/areas?country=${defaults.country}`,
      ctx,
    ),
    parsed.ok ? callApi('GET', searchApiPath(parsed.input), ctx) : Promise.resolve(null),
  ]);
  const areas = searchAreasOf(areasReply) ?? [];
  const results = reply === null ? null : searchResultsOf(reply);
  const error = !parsed.ok
    ? t(searchErrorKey(parsed.code))
    : results === null && reply !== null && reply.status !== 'unavailable' && reply.status < 500
      ? t(searchErrorKey(reply))
      : null;
  const unavailable = parsed.ok && results === null && error === null;
  return (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <h1 className={accountStyles['h1']}>{t('web.search.results.title')}</h1>
      <SearchForm i18n={i18n} areas={areas} defaults={defaults} error={error} idPrefix="s02" />
      {unavailable && (
        <ErrorState
          i18n={i18n}
          message={t('common.search.unavailable')}
          action={<ButtonLink href="/">{t('web.host.retry')}</ButtonLink>}
        />
      )}
      {defaults !== null && results !== null && results.length === 0 && (
        <EmptyState
          icon="car"
          headingLevel={2}
          title={t('web.search.results.none')}
          body={t('web.search.results.none.body')}
        />
      )}
      {defaults !== null && results !== null && results.length > 0 && (
        <section aria-labelledby="s02-results" className={accountStyles['stack']}>
          <div className={accountStyles['stackTight']}>
            <h2 id="s02-results" className={accountStyles['h2']}>
              {t('web.search.results.title')}
            </h2>
            <p className={styles['count']} data-testid="search-count">
              {t('web.search.results.count', { count: results.length })}
            </p>
            {results[0] !== undefined && (
              <p className={styles['meta']}>
                {t('web.search.result.period', {
                  from: i18n.dateTime(results[0].startAt, results[0].timezone),
                  to: i18n.dateTime(results[0].endAt, results[0].timezone),
                })}{' '}
                <span className={styles['muted']}>
                  {t('web.search.result.timezone', { city: results[0].city })}
                </span>
              </p>
            )}
          </div>
          <ResultsMap
            i18n={i18n}
            id="s02-map"
            results={results.map((r) => ({
              id: r.id,
              title: titleOf(r),
              total: i18n.money(amountOf(r, r.totalMinor)),
              href: listingHref(r.id, defaults),
              point: r.point,
            }))}
          />
          <ul className={styles['cards']} aria-label={t('web.search.results.title')}>
            {results.map((r) => (
              <li key={r.id} data-testid="search-card" data-listing={r.id}>
                <CarCard
                  i18n={i18n}
                  href={listingHref(r.id, defaults)}
                  title={titleOf(r)}
                  rating={
                    r.rating === null || r.rating.averageX100 === null
                      ? undefined
                      : r.rating.averageX100 / 100
                  }
                  trips={r.rating?.tripCount ?? 0}
                  place={r.areaLabel === null ? r.city : `${r.areaLabel}, ${r.city}`}
                  total={amountOf(r, r.totalMinor)}
                  perDay={amountOf(r, r.dailyPriceMinor)}
                  days={r.billableDays}
                  note={
                    r.depositAmountMinor === null
                      ? t('web.search.deposit.maybe')
                      : t('web.search.deposit.amount', {
                          amount: i18n.money(amountOf(r, r.depositAmountMinor)),
                        })
                  }
                />
              </li>
            ))}
          </ul>
          <p className={styles['muted']}>{t('web.listing.meet.approx')}</p>
        </section>
      )}
    </main>
  );
}
