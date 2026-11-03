import { getRequestI18n } from '../i18n.ts';
import { ConsoleClient } from './console/console-client.tsx';
import { HomeContent } from './home-content.tsx';

// Back-office interne : en-tête (US-014) et console protégée par TOTP (US-012).
export default async function BackofficeHomePage() {
  const i18n = await getRequestI18n();
  return (
    <HomeContent i18n={i18n}>
      <ConsoleClient localeTag={i18n.profile.tag} />
    </HomeContent>
  );
}
