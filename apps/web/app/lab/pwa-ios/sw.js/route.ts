import { LAB_BASE_PATH, isPwaIosLabEnabled, labNotFound } from '../lab-flag';
import { buildServiceWorkerScript } from '../sw-script';

export const dynamic = 'force-dynamic';

// Drapeau coupé : 404, ce qui désinscrit aussi un service worker déjà installé à sa prochaine mise à jour.
export function GET(): Response {
  if (!isPwaIosLabEnabled()) return labNotFound();
  return new Response(buildServiceWorkerScript(), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      // Autorise la portée « /lab/pwa-ios » (sans barre finale), qui inclut la page elle-même.
      'Service-Worker-Allowed': LAB_BASE_PATH,
      'X-Robots-Tag': 'noindex',
    },
  });
}
