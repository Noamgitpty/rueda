import type { Metadata } from 'next';
import { getRequestI18n } from '../../../../../../i18n.ts';
import { HandoverScreen } from '../../../../_handover/handover-screen.tsx';

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
 * S09 · check-in / check-out — la part du voyageur à la remise et au retour, en personne (US-315,
 * ADR-183 ; 10b S09, UX-41, UX-42 ; 16 TRP-002, TRP-033) : ses photos, ses relevés et sa
 * validation ; le contrôle du permis est fait par l'hôte (statut seulement).
 */
export default async function GuestHandoverPage({
  params,
}: {
  readonly params: Promise<{ readonly tripId: string; readonly direction: string }>;
}) {
  const { tripId, direction } = await params;
  return <HandoverScreen role="GUEST" tripId={tripId} direction={direction} org={null} />;
}
