import { relayListingPhoto } from '../../../../../account/listing-media.ts';

// Lu à chaque requête : la base du bucket vient de l'environnement (WEB_MEDIA_URL).
export const dynamic = 'force-dynamic';

/** Photo d'annonce relayée depuis le bucket public (US-204, `account/listing-media.ts`). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ listingId: string; photoId: string }> },
): Promise<Response> {
  const { listingId, photoId } = await params;
  return relayListingPhoto(listingId, photoId);
}
