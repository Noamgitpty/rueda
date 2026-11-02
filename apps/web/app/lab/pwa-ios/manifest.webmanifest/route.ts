import { isPwaIosLabEnabled, labNotFound } from '../lab-flag';
import { buildLabManifest } from '../manifest-data';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  if (!isPwaIosLabEnabled()) return labNotFound();
  return new Response(JSON.stringify(buildLabManifest()), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Robots-Tag': 'noindex',
    },
  });
}
