import type { Metadata } from 'next';
import { UUID } from '../../../../../../../account/trip-handover.ts';
import { getRequestI18n } from '../../../../../../../i18n.ts';
import { HandoverScreen } from '../../../../../_handover/handover-screen.tsx';

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly direction: string }>;
}): Promise<Metadata> {
  const [i18n, { direction }] = await Promise.all([getRequestI18n(), params]);
  return {
    title: i18n.t(
      direction === 'checkout' ? 'web.handover.title.checkout' : 'web.handover.title.checkin',
    ),
    robots: { index: false, follow: false },
  };
}

/**
 * A03 / A04 — remise (`checkin`) et retour (`checkout`) de la voiture par l'hôte, en personne, au
 * lieu de remise convenu (US-315, ADR-183 ; 10b A03, A04, UX-41, UX-42 ; 16 TRP-002, VER-015,
 * TRP-033).
 */
export default async function HostHandoverPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string; readonly direction: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ tripId, direction }, query] = await Promise.all([params, searchParams]);
  const org = typeof query['org'] === 'string' && UUID.test(query['org']) ? query['org'] : null;
  return <HandoverScreen role="HOST" tripId={tripId} direction={direction} org={org} />;
}
