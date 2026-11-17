'use client';
/**
 * S06 (US-223 partie 223b ; revue ux de #193, n° 1) : annonce fiable du passage à un autre état
 * du paiement. La région vive (`role="status"`, `aria-live="polite"`) existe dès le premier rendu
 * et reste la même d'une relecture à l'autre (même place dans l'arbre) : seul son texte change, ce
 * que les lecteurs d'écran annoncent toujours. À chaque changement d'état (jamais au premier
 * affichage), le focus passe au titre de l'écran. Repris par S05 pour la revue d'une réservation
 * signalée (US-209 partie 209c : « en revue » → « approuvée »).
 */
import { useEffect, useRef, useState } from 'react';
import styles from './payment.module.css';

export const S06_TITLE_ID = 's06-title';

export interface StateAnnouncerProps {
  readonly state: string;
  /** Texte annoncé, déjà traduit (titre et message de l'état). */
  readonly message: string;
  /** Élément qui reçoit le focus au changement d'état (S06 : son titre ; S05 : la revue, US-209c). */
  readonly focusId?: string;
  readonly testId?: string;
}

export function StateAnnouncer({
  state,
  message,
  focusId = S06_TITLE_ID,
  testId = 's06-live',
}: StateAnnouncerProps) {
  const previous = useRef(state);
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    if (previous.current === state) return;
    previous.current = state;
    setAnnounced(message);
    document.getElementById(focusId)?.focus();
  }, [state, message, focusId]);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={styles['srOnly']}
      data-testid={testId}
    >
      {announced}
    </div>
  );
}
