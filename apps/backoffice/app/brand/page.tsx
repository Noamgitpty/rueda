import { getRequestI18n } from '../../i18n.ts';
import { HomeContent } from '../home-content.tsx';
import { BrandClient } from './brand-client.tsx';

// Écran « Apparence / Marque » (US-120, O02) : réservé au rôle ADMIN, session élevée par TOTP
// (la connexion se fait dans la console, page d'accueil) ; l'API reste seule juge des droits.
export default async function BrandPage() {
  const i18n = await getRequestI18n();
  return (
    <HomeContent i18n={i18n}>
      <BrandClient localeTag={i18n.profile.tag} />
    </HomeContent>
  );
}
