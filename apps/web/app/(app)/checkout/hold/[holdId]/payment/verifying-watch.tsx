'use client';
/**
 * S06, attente de la preuve (US-223 partie 223b ; 10b UX-27, règle 4) : relit l'état du paiement
 * toutes les 5 s (rendu serveur, `router.refresh`, une seule lecture de l'API) tant que la page est
 * visible ; au-delà de 2 min d'attente sur cette page, « Seguimos esperando la confirmación de tu
 * banco » ; au-delà de 10 min, la sortie vers le support, et la relecture automatique s'arrête (le
 * lien « Actualizar el estado » reste). Durées mesurées en temps réel depuis l'arrivée sur la page
 * (`Date.now()`), jamais en nombre de tics : un onglet en arrière-plan ralentit les minuteries
 * sans fausser les seuils. Rien n'est jamais déclaré « confirmé » ici : seul le serveur change
 * d'état.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import accountStyles from '../../../../_account/account.module.css';

export const REFRESH_MS = 5_000;
/** 10b UX-27 : 2 min ⇒ texte d'attente lente ; 10 min ⇒ sortie vers le support. */
export const SLOW_AFTER_MS = 2 * 60_000;
export const SUPPORT_AFTER_MS = 10 * 60_000;

export interface VerifyingWatchProps {
  readonly slow: string;
  readonly supportTitle: string;
  readonly supportBody: string;
}

export function VerifyingWatch({ slow, supportTitle, supportBody }: VerifyingWatchProps) {
  const router = useRouter();
  const [waited, setWaited] = useState(0);
  // minuterie armée (après l'hydratation) : repère des e2e avant d'avancer l'horloge
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const started = Date.now();
    setArmed(true);
    const id = setInterval(() => {
      const elapsed = Date.now() - started;
      setWaited(elapsed);
      // relecture plafonnée à 10 min, et seulement si la page est visible
      if (elapsed >= SUPPORT_AFTER_MS) clearInterval(id);
      else if (document.visibilityState === 'visible') router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);
  return (
    <>
      <span hidden data-testid="s06-watch" data-armed={armed ? 'true' : 'false'} />
      {waited >= SLOW_AFTER_MS && (
        <p className={accountStyles['text']} data-testid="s06-slow">
          {slow}
        </p>
      )}
      {waited >= SUPPORT_AFTER_MS && (
        <section
          className={accountStyles['stackTight']}
          aria-labelledby="s06-support-late"
          data-testid="s06-support-late"
        >
          <h2 id="s06-support-late" className={accountStyles['h2']}>
            {supportTitle}
          </h2>
          <p className={accountStyles['text']}>{supportBody}</p>
        </section>
      )}
    </>
  );
}
