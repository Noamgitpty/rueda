/**
 * Contexte de la requête pour les appels à l'API des comptes (US-102), côté serveur seulement :
 * adresse transmise, navigateur, cookie de session ; dépôt du cookie de session émis par l'API.
 */
import { cookies, headers } from 'next/headers';
import { SESSION_COOKIE } from './api-client.ts';
import type { ClientContext } from './api-client.ts';

export async function clientContext(): Promise<ClientContext> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return {
    forwardedFor: h.get('x-forwarded-for'),
    userAgent: h.get('user-agent'),
    sessionToken: c.get(SESSION_COOKIE)?.value ?? null,
  };
}

/** Repose sur le site le cookie de session émis par l'API (mêmes attributs, US-010). */
export async function storeSession(session: { token: string; maxAgeS: number }): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: session.maxAgeS,
  });
}

/**
 * Pays du parcours pour la portée des documents : `country` explicite du lien profond (fiche d'un
 * auto, `^[A-Z]{2}$`), sinon la région de la locale (`es-PY` → `PY`) ; aucun : documents communs.
 * Aucune constante pays : la valeur vient de l'URL ou de la configuration des locales.
 */
export function journeyCountry(explicit: unknown, localeTag: string): string | null {
  if (typeof explicit === 'string' && /^[A-Z]{2}$/.test(explicit)) return explicit;
  const region = /^[a-z]{2}-([A-Z]{2})$/.exec(localeTag)?.[1];
  return region ?? null;
}
