'use client';

import { useEffect, useState } from 'react';
import { Banner } from '@rueda/ui';
import { SW_PATH } from '../../../pwa/sw-script.ts';
import styles from './shell.module.css';

/** Durée d'affichage de « De nouveau en ligne » (ms) : PROPOSÉ. */
export const RESTORED_NOTICE_MS = 4_000;

type Connection = 'online' | 'offline' | 'restored';

/**
 * Partie vivante de la coquille (US-048) : enregistre le service worker (build de production,
 * contexte sûr) et annonce la perte et le retour du réseau dans une région live polie (10b UX-48),
 * présente dès le premier rendu pour que l'annonce soit lue.
 */
export function ShellRuntime({
  serviceWorker,
  offlineText,
  restoredText,
}: {
  readonly serviceWorker: boolean;
  readonly offlineText: string;
  readonly restoredText: string;
}) {
  const [connection, setConnection] = useState<Connection>('online');

  useEffect(() => {
    if (!serviceWorker || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    const lang = document.documentElement.lang;
    navigator.serviceWorker
      .register(SW_PATH, { scope: '/' })
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => registration.active?.postMessage({ type: 'shell-locale', lang }))
      .catch(() => undefined);
  }, [serviceWorker]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const offline = () => {
      clearTimeout(timer);
      setConnection('offline');
    };
    const online = () => {
      setConnection((previous) => (previous === 'offline' ? 'restored' : previous));
      clearTimeout(timer);
      timer = setTimeout(() => setConnection('online'), RESTORED_NOTICE_MS);
    };
    if (!navigator.onLine) offline();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, []);

  return (
    <div className={styles['status']} role="status" aria-live="polite">
      {connection === 'offline' && (
        <Banner tone="warning" icon="offline">
          {offlineText}
        </Banner>
      )}
      {connection === 'restored' && (
        <Banner tone="success" icon="check">
          {restoredText}
        </Banner>
      )}
    </div>
  );
}
