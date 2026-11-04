import { getRequestBrand } from '../../brand-source.ts';
import { getRequestI18n } from '../../i18n.ts';
import { buildWebManifest } from '../../pwa/manifest.ts';

// Lu à chaque requête : marque publiée (US-034) et langue de l'utilisateur (US-014).
export const dynamic = 'force-dynamic';

/** Manifeste de l'application installable (US-048). */
export async function GET(): Promise<Response> {
  const [brand, i18n] = await Promise.all([getRequestBrand(), getRequestI18n()]);
  return new Response(JSON.stringify(buildWebManifest(brand, i18n)), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-cache',
      Vary: 'Cookie, Accept-Language',
    },
  });
}
