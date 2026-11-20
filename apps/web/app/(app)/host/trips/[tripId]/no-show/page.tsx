import type { Metadata } from 'next';
import { UUID } from '../../../../../../account/trip-no-show.ts';
import { getRequestI18n } from '../../../../../../i18n.ts';
import { NoShowScreen } from '../../../../_no-show/no-show-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.noShow.title.HOST'), robots: { index: false, follow: false } };
}

/**
 * A05 · no-show — l'hôte déclare que le voyageur ne s'est pas présenté au lieu de remise (US-307,
 * ADR-191 ; 16 TRP-015 ; 19 US-307 critères 1 et 2).
 */
export default async function HostNoShowPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ tripId }, query] = await Promise.all([params, searchParams]);
  const org = typeof query['org'] === 'string' && UUID.test(query['org']) ? query['org'] : null;
  return <NoShowScreen role="HOST" tripId={tripId} org={org} />;
}
