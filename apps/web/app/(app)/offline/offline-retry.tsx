'use client';

import { useEffect } from 'react';
import { ButtonLink } from '@rueda/ui';
import { OFFLINE_PATH } from '../../../pwa/sw-script.ts';

/** Adresse à recharger : la page demandée, ou l'accueil si l'on est sur `/offline` même. */
export function retryTarget(pathname: string, search: string): string {
  return pathname === OFFLINE_PATH ? '/' : `${pathname}${search}`;
}

/**
 * Reprise : un lien (fonctionne sans JavaScript : `href=""` recharge l'adresse affichée) et, avec
 * JavaScript, rechargement automatique dès le retour du réseau.
 */
export function OfflineRetry({ label }: { readonly label: string }) {
  useEffect(() => {
    const reload = () => window.location.assign(retryTarget(location.pathname, location.search));
    window.addEventListener('online', reload);
    return () => window.removeEventListener('online', reload);
  }, []);
  return (
    <ButtonLink
      href=""
      onClick={(event) => {
        event.preventDefault();
        window.location.assign(retryTarget(location.pathname, location.search));
      }}
    >
      {label}
    </ButtonLink>
  );
}
