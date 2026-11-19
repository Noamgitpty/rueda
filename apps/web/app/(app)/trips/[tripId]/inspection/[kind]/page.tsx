import type { Metadata } from 'next';
import { getRequestI18n } from '../../../../../../i18n.ts';
import { InspectionScreen } from '../../../../_inspection/inspection-screen.tsx';

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly kind: string }>;
}): Promise<Metadata> {
  const [i18n, { kind }] = await Promise.all([getRequestI18n(), params]);
  return {
    title: i18n.t(
      kind === 'checkout' ? 'web.inspection.title.checkout' : 'web.inspection.title.checkin',
    ),
    robots: { index: false, follow: false },
  };
}

/**
 * S09 · check-in / check-out — photos de l'état du véhicule prises par le voyageur (US-303,
 * ADR-179 ; 10b S09 ; 16 TRP-004) : sa propre série, au départ (`checkin`) et au retour
 * (`checkout`) ; la série de l'hôte ne remplace pas la sienne.
 */
export default async function GuestInspectionPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string; readonly kind: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ tripId, kind }, query] = await Promise.all([params, searchParams]);
  return (
    <InspectionScreen
      role="GUEST"
      tripId={tripId}
      kind={kind}
      org={null}
      done={query['done'] === '1'}
    />
  );
}
