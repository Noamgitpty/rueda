import { getRequestContent } from '../../content-source.ts';
import { getRequestI18n } from '../../i18n.ts';
import { HomeContent } from '../home-content.tsx';

// Accueil (S01, version coquille US-048) : textes du catalogue i18n, dans la locale de la requête,
// remplacés par les blocs éditables publiés dans cette langue (US-121, sans déploiement).
export default async function HomePage() {
  const i18n = await getRequestI18n();
  return <HomeContent i18n={i18n} content={await getRequestContent(i18n)} />;
}
