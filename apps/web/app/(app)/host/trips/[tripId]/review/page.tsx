import type { Metadata } from 'next';
import { getRequestI18n } from '../../../../../../i18n.ts';
import { ReviewScreen } from '../../../../_reviews/review-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.review.heading.host'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A12 — avis de l'hôte sur le voyageur (US-317, ADR-190 ; 10b A12) : écran commun
 * `_reviews/review-screen.tsx` ; seul le titulaire du compte d'hôte note (un co-hôte reçoit le même
 * message qu'un trip inconnu). Retour au détail du trip de l'hôte (A05), compte d'hôte gardé dans
 * la requête (`?org=`) quand il est bien formé.
 */
export default async function HostTripReviewPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const org = typeof query['org'] === 'string' && UUID.test(query['org']) ? query['org'] : null;
  const back = org === null ? `/host/trips/${tripId}` : `/host/trips/${tripId}?org=${org}`;
  return <ReviewScreen scope="host" tripId={tripId} back={back} org={org} query={query} />;
}
