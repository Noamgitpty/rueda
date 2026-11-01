import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LAB_BASE_PATH, isPwaIosLabEnabled } from './lab-flag';
import { LabClient } from './lab-client';

// Évalué à chaque requête : le drapeau est lu au démarrage du serveur, pas au build.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  if (!isPwaIosLabEnabled()) return {};
  return {
    title: 'Lab PWA iOS (US-026)',
    robots: { index: false, follow: false },
    manifest: `${LAB_BASE_PATH}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: 'Lab PWA', statusBarStyle: 'default' },
    icons: { apple: `${LAB_BASE_PATH}/icons/180` },
  };
}

/** Laboratoire jetable US-026 : coupé par `WEB_LAB_PWA_IOS_ENABLED` (désactivé par défaut). */
export default function PwaIosLabPage() {
  if (!isPwaIosLabEnabled()) notFound();
  return <LabClient />;
}
