import { isPwaIosLabEnabled, labNotFound } from '../../lab-flag';
import { getActiveTheme, hexToRgb } from '@rueda/design-tokens';
import { LAB_ICON_SIZES, solidPng } from '../../png';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ size: string }> },
): Promise<Response> {
  if (!isPwaIosLabEnabled()) return labNotFound();
  const size = Number((await context.params).size);
  if (!(LAB_ICON_SIZES as readonly number[]).includes(size)) return labNotFound();
  // Icône unie dans la couleur d'action du thème : suffit au test d'installation (la vraie : US-048).
  const { r, g, b } = hexToRgb(getActiveTheme(process.env).theme.colors.light.primary);
  const png = solidPng(size, [r, g, b]);
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' },
  });
}
