import type { Metadata } from 'next';
import { getRequestI18n } from '../../../../../i18n.ts';
import { ThreadScreen } from '../../../_messages/thread-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s16.heading'), robots: { index: false, follow: false } };
}

/**
 * S16 — messages du trip, côté voyageur (US-525, ADR-181 ; 10b S16) : écran commun
 * `_messages/thread-screen.tsx`, retour au détail du trip (S09).
 */
export default async function GuestTripMessagesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  return <ThreadScreen scope="guest" tripId={tripId} back={`/trips/${tripId}`} query={query} />;
}
