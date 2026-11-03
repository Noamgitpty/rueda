import { getRequestI18n } from '../i18n.ts';
import { HomeContent } from './home-content.tsx';

// Page d'accueil minimale : textes du catalogue i18n (US-014), dans la locale de la requête.
export default async function HomePage() {
  return <HomeContent i18n={await getRequestI18n()} />;
}
