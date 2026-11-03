import type { LocaleConfig } from './locale-profile.ts';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_S, isSupportedLocale } from './negotiate.ts';

/**
 * Traitement d'un choix explicite de locale (10b UX-11), sans dépendance à un framework :
 * `POST` d'un formulaire avec le champ `locale`. La valeur est validée contre la configuration,
 * mémorisée dans un cookie `HttpOnly; SameSite=Lax`, puis on renvoie vers l'accueil (303,
 * `Location` relatif : aucune URL absolue reconstruite depuis l'hôte de la requête).
 * Valeur absente ou non déclarée → 400, aucun cookie.
 */
export async function localeChoiceResponse(
  request: Request,
  config: LocaleConfig,
): Promise<Response> {
  let requested: unknown;
  try {
    requested = (await request.formData()).get('locale');
  } catch {
    requested = undefined;
  }
  if (typeof requested !== 'string' || !isSupportedLocale(requested, config)) {
    return new Response(null, { status: 400 });
  }
  const attributes = [
    `${LOCALE_COOKIE}=${requested}`,
    'Path=/',
    `Max-Age=${LOCALE_COOKIE_MAX_AGE_S}`,
    'SameSite=Lax',
    'HttpOnly',
  ];
  if (new URL(request.url).protocol === 'https:') attributes.push('Secure');
  return new Response(null, {
    status: 303,
    headers: { location: '/', 'set-cookie': attributes.join('; ') },
  });
}
