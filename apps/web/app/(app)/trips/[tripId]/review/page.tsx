import type { Metadata } from 'next';
import { getRequestI18n } from '../../../../../i18n.ts';
import { ReviewScreen } from '../../../_reviews/review-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.review.heading.guest'), robots: { index: false, follow: false } };
}

/**
 * S13 — avis du voyageur sur la voiture et l'hôte (US-317, ADR-190 ; 10b S13) : écran commun
 * `_reviews/review-screen.tsx`, retour au détail du trip (S09).
 */
export default async function GuestTripReviewPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  return (
    <ReviewScreen
      scope="guest"
      tripId={tripId}
      back={`/trips/${tripId}`}
      org={null}
      query={query}
    />
  );
}
