/**
 * Photos d'annonce servies par le site (US-204 ; 16 LST-002) : la CSP du site n'admet que ses
 * propres images (`img-src 'self'`, `security-headers.ts`), le navigateur ne parle qu'au site. Le
 * serveur du site relaie donc l'objet du bucket public PUBLIC_LISTING (C0, métadonnées retirées au
 * dépôt, US-115) depuis `WEB_MEDIA_URL`.
 *
 * - `WEB_MEDIA_URL` (http(s), sans identifiants) : base publique du bucket ; absente ou invalide :
 *   404 (fail-closed ; en production tant qu'US-003 n'a pas livré le stockage, aucune photo n'est
 *   d'ailleurs déposée). La galerie montre alors sa vignette de remplacement.
 * - Clé fermée `listing/<uuid>/<uuid>` : aucun autre chemin n'est relayé (pas de mandataire
 *   ouvert) ; aucune redirection suivie, délai de 5 s, 10 Mio au plus, type réel limité à JPEG,
 *   PNG et WebP (les seuls acceptés au dépôt) ; rien d'autre de la réponse amont n'est recopié.
 */
export const MEDIA_URL_VAR = 'WEB_MEDIA_URL';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Env = Readonly<Record<string, string | undefined>>;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** Base publique du bucket, ou `undefined` (absente, invalide, avec identifiants). */
export function mediaUrl(env: Env = process.env): URL | undefined {
  const raw = env[MEDIA_URL_VAR];
  if (raw === undefined || raw === '') return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username !== '' || url.password !== '') return undefined;
    return url;
  } catch {
    return undefined;
  }
}

const notFound = (): Response =>
  new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** Relais d'une photo d'annonce ; tout écart : 404, sans détail. */
export async function relayListingPhoto(
  listingId: string,
  photoId: string,
  options: { env?: Env; fetcher?: Fetcher } = {},
): Promise<Response> {
  if (!UUID.test(listingId) || !UUID.test(photoId)) return notFound();
  const base = mediaUrl(options.env);
  if (base === undefined) return notFound();
  const target = new URL(
    `listing/${listingId}/${photoId}`,
    base.href.endsWith('/') ? base : `${base.href}/`,
  );
  try {
    const upstream = await (options.fetcher ?? fetch)(target.href, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const type = (upstream.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (!upstream.ok || type === undefined || !TYPES.has(type)) return notFound();
    const body = new Uint8Array(await upstream.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return notFound();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(body.byteLength),
        // objet en création seule (jamais écrasé, US-115) : cache public court
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return notFound();
  }
}
