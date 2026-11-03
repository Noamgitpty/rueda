import { isPwaIosLabEnabled, labNotFound } from '../../lab-flag';
import { LAB_ICON_SIZES, solidPng } from '../../png';

export const dynamic = 'force-dynamic';

// Gris neutre provisoire : une icône unie suffit au test d'installation ; la vraie vient de la marque.
const PLACEHOLDER_GREY: readonly [number, number, number] = [128, 128, 128];

export async function GET(
  _request: Request,
  context: { params: Promise<{ size: string }> },
): Promise<Response> {
  if (!isPwaIosLabEnabled()) return labNotFound();
  const size = Number((await context.params).size);
  if (!(LAB_ICON_SIZES as readonly number[]).includes(size)) return labNotFound();
  const png = solidPng(size, PLACEHOLDER_GREY);
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' },
  });
}
