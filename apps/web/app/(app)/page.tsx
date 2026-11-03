import { getRequestI18n } from '../../i18n.ts';
import { HomeContent } from '../home-content.tsx';

// Accueil (S01, version coquille US-048) : textes du catalogue i18n, dans la locale de la requête.
export default async function HomePage() {
  return <HomeContent i18n={await getRequestI18n()} />;
}
