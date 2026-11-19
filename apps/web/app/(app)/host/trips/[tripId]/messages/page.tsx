import type { Metadata } from 'next';
import { getRequestI18n } from '../../../../../../i18n.ts';
import { ThreadScreen } from '../../../../_messages/thread-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s16.heading'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * S16 — messages du trip, côté hôte (titulaire ou co-hôte de portée ; US-525, ADR-181 ; 10b S16) :
 * écran commun `_messages/thread-screen.tsx`, retour au détail du trip de l'hôte (A05), compte
 * d'hôte gardé dans la requête (`?org=`) quand il est bien formé.
 */
export default async function HostTripMessagesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const org = typeof query['org'] === 'string' && UUID.test(query['org']) ? query['org'] : null;
  const back = org === null ? `/host/trips/${tripId}` : `/host/trips/${tripId}?org=${org}`;
  return <ThreadScreen scope="host" tripId={tripId} back={back} query={query} />;
}
