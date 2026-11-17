'use client';
/**
 * S05 d'un hold en revue (US-209 partie 209c, ADR-144 ; 10b S05, UX-35) : relit l'écran toutes les
 * 30 s (rendu serveur, `router.refresh`) tant que la page est visible, jusqu'à l'heure de réponse
 * promise (échéance du hold de revue, lue dans l'API) puis une relecture de plus : approuvée ⇒
 * « Pagar » apparaît ; refusée ou échue ⇒ l'écran ouvre S06. Aucune décision n'est jamais déduite
 * ici : seul le serveur change d'état. Le voyageur n'est pas encore averti autrement (préalable
 * GL-17) : la relecture lui évite de devoir recharger la page.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export const REVIEW_REFRESH_MS = 30_000;

export interface ReviewWatchProps {
  /** Échéance du hold de revue (ISO), rendue par l'API. */
  readonly until: string;
}

export function ReviewWatch({ until }: ReviewWatchProps) {
  const router = useRouter();
  // minuterie armée (après l'hydratation) : repère des e2e avant d'avancer l'horloge
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const end = Date.parse(until);
    setArmed(true);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
      // une relecture après l'échéance (hold libéré ⇒ S06), puis plus rien
      if (!Number.isFinite(end) || Date.now() > end) clearInterval(id);
    }, REVIEW_REFRESH_MS);
    return () => clearInterval(id);
  }, [router, until]);
  return <span hidden data-testid="s05-review-watch" data-armed={armed ? 'true' : 'false'} />;
}
