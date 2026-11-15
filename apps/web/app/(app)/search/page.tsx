import type { Metadata } from 'next';
import { Badge, ButtonLink, EmptyState, ErrorState, Icon } from '@rueda/ui';
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
import { getRequestI18n } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import { SearchForm } from '../_search/search-form.tsx';
import styles from '../_search/search.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.search.results.title'), robots: { index: false, follow: false } };
}

/**
 * Résultats de la recherche (US-201 ; 16 SRC-001, version simple de S02 : la carte, le total TTC
 * et la caution arrivent avec US-203). Le formulaire de S01 envoie ici, en GET, le lieu et les
 * heures LOCALES du lieu ; la page valide la forme (fin ≤ début ⇒ `SEARCH_DATES_INVALID`,
 * critère 1), appelle l'API puis liste les annonces disponibles : véhicule, zone approximative
 * seulement (jamais l'adresse exacte, critère 4), période affichée dans le fuseau du véhicule
 * (critère 3), lien vers la fiche avec les dates reprises (critère 2). États : refus (message du
 * code, formulaire repris), aucun résultat, API injoignable ; chargement : `loading.tsx`.
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
        <section aria-labelledby="s02-results" className={accountStyles['stackTight']}>
          <h2 id="s02-results" className={accountStyles['h2']}>
            {t('web.search.results.title')}
          </h2>
          <ul className={styles['results']}>
            {results.map((r) => (
              <li key={r.id} className={styles['result']}>
                <h3 id={`s02-result-${r.id}`} className={styles['resultTitle']}>
                  {`${r.makeName} ${r.modelName} ${r.year}`}
                </h3>
                <p className={styles['meta']}>
                  <Icon name="pin" /> {r.areaLabel === null ? r.city : `${r.areaLabel}, ${r.city}`}
                </p>
                <p className={styles['muted']}>{t('web.listing.meet.approx')}</p>
                <p className={styles['meta']}>
                  {t('web.search.result.period', {
                    from: i18n.dateTime(r.startAt, r.timezone),
                    to: i18n.dateTime(r.endAt, r.timezone),
                  })}
                </p>
                <p className={styles['muted']}>
                  {t('web.search.result.timezone', { timezone: r.timezone })}
                </p>
                <p className={styles['meta']}>
                  {t('web.listing.perDay', {
                    amount: i18n.money({
                      amountMinor: r.dailyPriceMinor,
                      currency: r.currency,
                      exponent: r.currencyExponent,
                    }),
                  })}
                </p>
                <div>
                  <Badge tone={r.instantBook ? 'success' : 'neutral'}>
                    {t(r.instantBook ? 'web.listing.instant' : 'web.listing.request')}
                  </Badge>
                </div>
                <a
                  className={styles['link']}
                  href={listingHref(r.id, defaults)}
                  aria-describedby={`s02-result-${r.id}`}
                >
                  {t('web.search.result.open')}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
