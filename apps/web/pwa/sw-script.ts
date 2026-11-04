/**
 * Service worker minimal de l'application (US-048, 19 « notes techniques »), servi par
 * `app/sw.js/route.ts` avec la portée `/`.
 *
 * - **Pages : réseau seulement.** Aucune page n'est mise en cache (elles peuvent porter des données
 *   personnelles) ; si le réseau manque, l'écran « Sin conexión » (`/offline`) est rendu à la place,
 *   avec reprise. Le contenu critique mis en cache après confirmation (10b UX-06) et la file d'envoi
 *   des photos hors ligne viennent avec les lots 3 et 5 (US-524), par `device/OfflineQueue`.
 * - **Ressources de build** (`/_next/static/`, nommées par empreinte) : cache d'abord.
 * - L'écran hors ligne et ses ressources sont pré-chargés à l'installation, puis rechargés quand la
 *   langue de la page change (message `shell-locale`), pour rester dans la langue de l'utilisateur.
 * - La version (marque et coquille) est écrite dans le script : une nouvelle marque publiée change
 *   les octets du script, donc le navigateur installe la nouvelle version et purge l'ancien cache.
 */
export const SW_PATH = '/sw.js';
export const OFFLINE_PATH = '/offline';
export const SHELL_CACHE_PREFIX = 'shell-';
/** Version de la logique du service worker : à incrémenter quand ce script change de sens. */
export const SHELL_SW_VERSION = 1;

export function shellCacheName(brandVersion: string): string {
  return `${SHELL_CACHE_PREFIX}${SHELL_SW_VERSION}-${brandVersion}`;
}

export function buildShellServiceWorker(brandVersion: string): string {
  return `// Service worker de la coquille (US-048). Généré : ne pas modifier à la main.
const CACHE = ${JSON.stringify(shellCacheName(brandVersion))};
const PREFIX = ${JSON.stringify(SHELL_CACHE_PREFIX)};
const OFFLINE = ${JSON.stringify(OFFLINE_PATH)};
const LANG_KEY = '/__shell/offline-lang';
const STATIC_ASSET = /["'](\\/_next\\/static\\/[^"'?#\\s]+)["']/g;

// Pré-charge l'écran hors ligne et les fichiers qu'il cite. Au mieux : un échec ne doit jamais
// faire échouer l'installation (le navigateur supprimerait l'enregistrement).
async function cacheOffline(lang) {
  const cache = await caches.open(CACHE);
  const response = await fetch(OFFLINE, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  const html = await response.clone().text();
  await cache.put(OFFLINE, response);
  await cache.put(LANG_KEY, new Response(lang || ''));
  const assets = new Set();
  for (const match of html.matchAll(STATIC_ASSET)) assets.add(match[1]);
  await Promise.all(
    [...assets].map((url) =>
      cache.match(url).then((hit) => hit || cache.add(url)).catch(() => undefined),
    ),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheOffline('').catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'shell-locale' || typeof data.lang !== 'string') return;
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.match(LANG_KEY))
      .then((hit) => (hit ? hit.text() : ''))
      .then((cached) => (cached === data.lang ? undefined : cacheOffline(data.lang)))
      .catch(() => undefined),
  );
});

async function offlineResponse() {
  const hit = await caches.match(OFFLINE, { ignoreVary: true });
  return hit || new Response('', { status: 503, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => offlineResponse()));
    return;
  }
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
            }
            return response;
          }),
      ),
    );
  }
});
`;
}
