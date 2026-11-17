import { clientContext } from '../../../../../../account/request.ts';
import { relayContractPdf } from '../../../../../../account/trip-contract.ts';

// Lu à chaque requête : session du visiteur, jamais de cache.
export const dynamic = 'force-dynamic';

/**
 * PDF du contrat de location d'un trip (US-211 partie 211b) relayé depuis l'API avec la session du
 * visiteur : voyageur ou hôte du trip ; toute autre personne reçoit 404 (rien n'est révélé).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tripId: string }> },
): Promise<Response> {
  const { tripId } = await params;
  const version = new URL(request.url).searchParams.get('version');
  return relayContractPdf(tripId, version, await clientContext());
}
