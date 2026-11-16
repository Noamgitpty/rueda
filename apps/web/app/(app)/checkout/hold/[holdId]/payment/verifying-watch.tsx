'use client';
/**
 * S06, attente de la preuve (US-223 partie 223b ; 10b UX-27, règle 4) : relit l'état du paiement
 * toutes les 5 s (rendu serveur, `router.refresh`) tant que la page est ouverte ; au-delà de 2 min
 * d'attente sur cette page, « Seguimos esperando la confirmación de tu banco » ; au-delà de 10 min,
 * la sortie vers le support avec le numéro de réservation. Durées comptées par la page (aucune
 * horloge du voyageur ni de l'API lue) ; sans JavaScript, le lien « Actualizar el estado » relit la
 * page. Rien n'est jamais déclaré « confirmé » ici : seul le serveur change d'état.
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
  readonly reference: string;
}

export function VerifyingWatch({
  slow,
  supportTitle,
  supportBody,
  reference,
}: VerifyingWatchProps) {
  const router = useRouter();
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setTicks((n) => n + 1);
      router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);
  const waited = ticks * REFRESH_MS;
  return (
    <>
      {waited >= SLOW_AFTER_MS && (
        <p className={accountStyles['text']} role="status">
          {slow}
        </p>
      )}
      {waited >= SUPPORT_AFTER_MS && (
        <section className={accountStyles['stackTight']} aria-labelledby="s06-support-late">
          <h2 id="s06-support-late" className={accountStyles['h2']}>
            {supportTitle}
          </h2>
          <p className={accountStyles['text']}>{reference}</p>
          <p className={accountStyles['text']}>{supportBody}</p>
        </section>
      )}
    </>
  );
}
