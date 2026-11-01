/**
 * Service worker minimal du laboratoire (US-026), servi par `sw.js/route.ts`. Portée limitée à
 * `/lab/pwa-ios` : il ne contrôle aucune autre page. Il met en cache la page et les ressources
 * `/_next/static/` pour tester la réouverture hors ligne, et journalise l'événement `sync`
 * (synchronisation en arrière-plan, absente d'iOS à ce jour : c'est un point du test).
 */
import { LAB_BASE_PATH } from './lab-flag';

export const LAB_CACHE_NAME = 'rueda-lab-pwa-ios-v1';

export function buildServiceWorkerScript(): string {
  return `// Service worker du laboratoire US-026 : prototype jetable.
const CACHE = ${JSON.stringify(LAB_CACHE_NAME)};
const SHELL = ${JSON.stringify(LAB_BASE_PATH)};

// Pré-cache au mieux : un échec ici ne doit jamais faire échouer l'installation (sinon le
// navigateur supprime l'enregistrement). La page est de toute façon remise en cache à la visite.
self.addEventListener('install', (event) => {
  event.waitUntil(
    fetch(SHELL, { cache: 'no-store' })
      .then((r) => (r.ok ? caches.open(CACHE).then((c) => c.put(SHELL, r)) : undefined))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Next ajoute « Vary: rsc, … » : on range par URL et on relit avec ignoreVary.
const MATCH = { ignoreVary: true, ignoreSearch: false };

function remember(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches
      .open(CACHE)
      .then((c) => c.put(new Request(request.url), copy))
      .catch(() => undefined);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((r) => remember(request, r))
        .catch(() =>
          caches.match(request.url, MATCH).then((hit) => hit || caches.match(SHELL, MATCH)),
        ),
    );
    return;
  }
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches
        .match(request.url, MATCH)
        .then((hit) => hit || fetch(request).then((r) => remember(request, r))),
    );
  }
});

self.addEventListener('sync', (event) => {
  event.waitUntil(
    self.clients.matchAll().then((clients) => {
      for (const c of clients) c.postMessage({ type: 'lab-sync', tag: event.tag, at: new Date().toISOString() });
    }),
  );
});
`;
}
