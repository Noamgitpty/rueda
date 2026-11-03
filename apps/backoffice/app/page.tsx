import { getRequestI18n } from '../i18n.ts';
import { HomeContent } from './home-content.tsx';

// Page d'accueil minimale du back-office : textes du catalogue i18n (US-014).
export default async function BackofficeHomePage() {
  return <HomeContent i18n={await getRequestI18n()} />;
}
