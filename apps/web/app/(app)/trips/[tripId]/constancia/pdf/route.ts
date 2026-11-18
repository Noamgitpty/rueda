import { clientContext } from '../../../../../../account/request.ts';
import { relayConstanciaPdf } from '../../../../../../account/trip-constancia.ts';

// Lu à chaque requête : session du visiteur, jamais de cache.
export const dynamic = 'force-dynamic';

/**
 * PDF de la constancia d'arrendamiento d'un trip (US-212) relayé depuis l'API avec la session du
 * visiteur : voyageur ou hôte du trip ; toute autre personne reçoit 404 (rien n'est révélé).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string }> },
): Promise<Response> {
  const { tripId } = await params;
  return relayConstanciaPdf(tripId, await clientContext());
}
