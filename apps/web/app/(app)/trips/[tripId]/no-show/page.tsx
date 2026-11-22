import type { Metadata } from 'next';
import { getRequestI18n } from '../../../../../i18n.ts';
import { NoShowScreen } from '../../../_no-show/no-show-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.noShow.title.GUEST'), robots: { index: false, follow: false } };
}

/**
 * S09 · no-show — le voyageur signale que l'hôte ne s'est pas présenté au lieu de remise (US-307,
 * ADR-191 ; 16 TRP-015 ; 19 US-307 critère 4).
 */
export default async function GuestNoShowPage({
  params,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
}) {
  const { tripId } = await params;
  return <NoShowScreen role="GUEST" tripId={tripId} org={null} />;
}
