import type { Metadata } from 'next';
import { Banner } from '@rueda/ui';
import { callApi } from '../../../account/api-client.ts';
import { helpCountriesOf } from '../../../account/help.ts';
import { clientContext, journeyCountry } from '../../../account/request.ts';
import { getRequestBrand } from '../../../brand-source.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { HelpNumbers } from '../_help/help-numbers.tsx';
import { MAIN_ID } from '../_shell/main-id.ts';
import styles from '../host/host.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.help.title') };
}

/**
 * S17 — Aide et urgence (US-310, ADR-182 ; 10b S17 ; 16 SUP-004 ; 08 BR-PROT-05), ouverte depuis
 * l'en-tête de chaque écran (UX-05, WCAG 3.2.6). Numéros du pays lus de `GET /help` (configuration
 * pays de l'API, ADR-174) : pays du lien (`?country=XX`), sinon celui de la locale (`es-PY` → PY),
 * sinon chaque pays configuré. Rendu serveur : les numéros sont dans la page. L'API injoignable :
 * le message renvoie aux services d'urgence locaux, sans numéro deviné. Aucune session exigée.
 */
export default async function HelpPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, tag, brand, query] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    getRequestBrand(),
    searchParams,
  ]);
  const t = i18n.t.bind(i18n);
  const reply = await callApi('GET', '/help', await clientContext());
  const all = helpCountriesOf(reply);
  const wanted = journeyCountry(query['country'], tag);
  const shown =
    all === null
      ? null
      : all.some((c) => c.country === wanted)
        ? all.filter((c) => c.country === wanted)
        : all;
  return (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']} data-testid="s17-title">
          {t('web.help.title')}
        </h1>
        <p className={accountStyles['muted']}>{t('web.help.lead')}</p>
      </header>

      {shown === null ? (
        <Banner tone="danger" live="assertive">
          <span data-testid="s17-unavailable">{t('web.help.unavailable')}</span>
        </Banner>
      ) : (
        shown.map((c) => (
          <HelpNumbers
            key={c.country}
            i18n={i18n}
            help={c}
            brand={brand.name}
            idPrefix={`s17-${c.country.toLowerCase()}`}
            countryHeading={shown.length > 1}
          />
        ))
      )}

      <section className={styles['section']} aria-labelledby="s17-trips">
        <h2 id="s17-trips" className={accountStyles['h2']}>
          {t('web.help.trip.section')}
        </h2>
        <p className={accountStyles['text']}>{t('web.help.trips.lead')}</p>
        <a className={styles['link']} href="/trips" data-testid="s17-trips">
          {t('web.help.trips.link')}
        </a>
      </section>

      <section className={styles['section']} aria-labelledby="s17-faq">
        <h2 id="s17-faq" className={accountStyles['h2']}>
          {t('web.help.faq.title')}
        </h2>
        <details>
          <summary className={styles['strong']}>{t('web.help.faq.accident.q')}</summary>
          <p className={accountStyles['text']}>{t('web.help.faq.accident.a')}</p>
        </details>
        <details>
          <summary className={styles['strong']}>{t('web.help.faq.privacy.q')}</summary>
          <p className={accountStyles['text']}>
            {t('web.help.faq.privacy.a', { brand: brand.name })}
          </p>
        </details>
      </section>
    </main>
  );
}
