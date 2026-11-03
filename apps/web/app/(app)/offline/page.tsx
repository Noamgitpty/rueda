import type { Metadata } from 'next';
import { getRequestI18n } from '../../../i18n.ts';
import { OfflineContent } from './offline-content.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.offline.title'), robots: { index: false, follow: false } };
}

/**
 * Écran « Sin conexión » (US-048, 10b §4.1). Pré-chargé par le service worker et rendu à la place
 * de toute page demandée sans réseau ; la reprise recharge l'adresse demandée.
 */
export default async function OfflinePage() {
  return <OfflineContent i18n={await getRequestI18n()} />;
}
