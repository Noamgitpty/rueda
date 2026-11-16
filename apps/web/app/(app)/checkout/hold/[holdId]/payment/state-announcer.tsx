'use client';
/**
 * S06 (US-223 partie 223b ; revue ux de #193, n° 1) : annonce fiable du passage à un autre état
 * du paiement. La région vive (`role="status"`, `aria-live="polite"`) existe dès le premier rendu
 * et reste la même d'une relecture à l'autre (même place dans l'arbre) : seul son texte change, ce
 * que les lecteurs d'écran annoncent toujours. À chaque changement d'état (jamais au premier
 * affichage), le focus passe au titre de l'écran.
 */
import { useEffect, useRef, useState } from 'react';
import styles from './payment.module.css';

export const S06_TITLE_ID = 's06-title';

export interface StateAnnouncerProps {
  readonly state: string;
  /** Texte annoncé, déjà traduit (titre et message de l'état). */
  readonly message: string;
}

export function StateAnnouncer({ state, message }: StateAnnouncerProps) {
  const previous = useRef(state);
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    if (previous.current === state) return;
    previous.current = state;
    setAnnounced(message);
    document.getElementById(S06_TITLE_ID)?.focus();
  }, [state, message]);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={styles['srOnly']}
      data-testid="s06-live"
    >
      {announced}
    </div>
  );
}
