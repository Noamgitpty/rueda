import { ButtonLink, EmptyState } from '@rueda/ui';
import { callApi } from '../../account/api-client.ts';
import { clientContext, journeyCountry } from '../../account/request.ts';
import { searchAreasOf } from '../../account/search.ts';
import { getRequestContent } from '../../content-source.ts';
import { getRequestI18n } from '../../i18n.ts';
import { HomeContent } from '../home-content.tsx';
import { SearchForm } from './_search/search-form.tsx';
import styles from './_search/search.module.css';

// Accueil (S01, version coquille US-048) : textes du catalogue i18n, dans la locale de la requête,
// remplacés par les blocs éditables publiés dans cette langue (US-121, sans déploiement).
// Recherche (US-201) : zones déclarées par les hôtes des annonces cherchables, du pays du parcours
// (`?country=` ou région de la locale), sinon de tous les pays ; zones non chargées : réessayer
// (10b S01) ; aucune zone : état vide (aucune annonce publiée, interrupteurs fermés).
export default async function HomePage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, query] = await Promise.all([getRequestI18n(), searchParams]);
  const t = i18n.t.bind(i18n);
  const country = journeyCountry(query['country'], i18n.profile.tag);
  const reply = await callApi(
    'GET',
    country === null ? '/search/areas' : `/search/areas?country=${country}`,
    { ...(await clientContext()), sessionToken: null },
  );
  const areas = searchAreasOf(reply);
  const search =
    areas === null ? (
      <div className={styles['form']}>
        <p className={styles['error']} role="alert">
          {t('web.search.areasError')}
        </p>
        <ButtonLink href="/" variant="secondary">
          {t('web.host.retry')}
        </ButtonLink>
      </div>
    ) : areas.length === 0 ? (
      <div className={styles['form']}>
        <EmptyState
          icon="car"
          headingLevel={2}
          title={t('web.search.noAreas.title')}
          body={t('web.search.noAreas.body')}
        />
      </div>
    ) : (
      <SearchForm i18n={i18n} areas={areas} />
    );
  return <HomeContent i18n={i18n} content={await getRequestContent(i18n)} search={search} />;
}
