import type { Metadata } from 'next';
import { UUID } from '../../../../../../../account/trip-inspection.ts';
import { getRequestI18n } from '../../../../../../../i18n.ts';
import { InspectionScreen } from '../../../../../_inspection/inspection-screen.tsx';

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
 * A03 / A04 · photos — photos de l'état du véhicule prises par l'hôte à la remise (`checkin`) et
 * au retour (`checkout`) (US-303, ADR-179 ; 10b A03, A04, UX-41, UX-42 ; 16 TRP-004) ; la série du
 * voyageur ne remplace pas la sienne.
 */
export default async function HostInspectionPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string; readonly kind: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ tripId, kind }, query] = await Promise.all([params, searchParams]);
  const org = typeof query['org'] === 'string' && UUID.test(query['org']) ? query['org'] : null;
  return (
    <InspectionScreen
      role="HOST"
      tripId={tripId}
      kind={kind}
      org={org}
      done={query['done'] === '1'}
    />
  );
}
