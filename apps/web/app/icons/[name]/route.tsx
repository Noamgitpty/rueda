import { ImageResponse } from 'next/og';
import { getRequestBrand } from '../../../brand-source.ts';
import { IconArt, iconSpec } from '../../../pwa/icon.tsx';
import { isPwaIconName } from '../../../pwa/manifest.ts';

// Lu à chaque requête : une marque publiée (US-034) change les icônes sans déploiement.
export const dynamic = 'force-dynamic';

/** Icônes PNG de l'application installable (US-048), dessinées depuis la marque. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await context.params;
  if (!isPwaIconName(name)) return new Response('Not Found', { status: 404 });
  const spec = iconSpec(name, await getRequestBrand());
  return new ImageResponse(<IconArt spec={spec} />, {
    width: spec.size,
    height: spec.size,
    headers: { 'Cache-Control': 'public, max-age=86400' },
  });
}
