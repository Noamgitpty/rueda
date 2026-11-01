import { BRAND_NAME, HOME_TAGLINE } from '../brand';

// Page d'accueil minimale (US-001). Textes provisoires : le catalogue i18n arrive avec US-014.
export default function HomePage() {
  return (
    <main>
      <h1>{BRAND_NAME}</h1>
      <p>{HOME_TAGLINE}</p>
    </main>
  );
}
