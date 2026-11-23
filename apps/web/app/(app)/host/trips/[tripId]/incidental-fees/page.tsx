import type { Metadata } from 'next';
import { doneOf, UUID } from '../../../../../../account/trip-incidental.ts';
import { getRequestI18n } from '../../../../../../i18n.ts';
import { IncidentalScreen } from '../../../../_incidental/incidental-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.incidental.title.HOST'), robots: { index: false, follow: false } };
}

/**
 * A04 · frais annexes — l'hôte demande des frais avec justificatif après le retour (US-706,
 * ADR-197 ; 16 CLM-021 ; 19 US-706 critères 1 et 2).
 */
export default async function HostIncidentalPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const org = typeof query['org'] === 'string' && UUID.test(query['org']) ? query['org'] : null;
  return <IncidentalScreen role="HOST" tripId={tripId} org={org} done={doneOf(query['done'])} />;
}
