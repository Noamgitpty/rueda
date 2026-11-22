import type { Metadata } from 'next';
import { doneOf } from '../../../../../account/trip-incidental.ts';
import { getRequestI18n } from '../../../../../i18n.ts';
import { IncidentalScreen } from '../../../_incidental/incidental-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.incidental.title.GUEST'), robots: { index: false, follow: false } };
}

/**
 * S12 · frais annexes — le voyageur paie ou conteste avec preuves les frais demandés par l'hôte
 * avant l'échéance (US-706, ADR-197 ; 16 CLM-021 ; 19 US-706 critère 1).
 */
export default async function GuestIncidentalPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  return <IncidentalScreen role="GUEST" tripId={tripId} org={null} done={doneOf(query['done'])} />;
}
