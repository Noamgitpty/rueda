import { BRAND_NAME } from '../brand';

// Page d'accueil minimale du back-office interne (US-001). Authentification staff + TOTP : stories IAM.
export default function BackofficeHomePage() {
  return (
    <main>
      <h1>{BRAND_NAME} — back-office</h1>
      <p>Consola interna.</p>
    </main>
  );
}
