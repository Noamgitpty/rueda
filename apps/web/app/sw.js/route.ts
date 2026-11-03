import { getRequestBrand } from '../../brand-source.ts';
import { buildShellServiceWorker } from '../../pwa/sw-script.ts';

export const dynamic = 'force-dynamic';

/** Service worker de la coquille (US-048), portée `/`. Toujours revalidé (`no-cache`). */
export async function GET(): Promise<Response> {
  const brand = await getRequestBrand();
  return new Response(buildShellServiceWorker(brand.version), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
