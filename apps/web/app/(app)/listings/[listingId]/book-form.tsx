'use client';
/**
 * Barre d'action de S03 (10b S03 `web.s03.cta` « Reservar » avec le total ; US-208) : envoie
 * l'annonce et les instants du créneau CONTRÔLÉ par l'API (jamais un montant) ; l'action serveur
 * fige le devis et ouvre S05. Sans JavaScript : envoi natif du formulaire. Bouton occupé pendant
 * l'envoi (`aria-busy`) ; un second clic pendant l'envoi est ignoré (un seul devis).
 */
import { useActionState } from 'react';
import type { MouseEvent } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../../locale-config.ts';
import { startCheckoutAction } from '../../checkout/actions.ts';
import type { CheckoutFormState } from '../../checkout/actions.ts';

export interface BookFormProps {
  readonly localeTag: string;
  readonly listingId: string;
  readonly startAt: string;
  readonly endAt: string;
  /** Libellé déjà composé avec le total (« Reservar · US$ 128.40 »). */
  readonly label: string;
}

const INITIAL: CheckoutFormState = { errors: [] };

export function BookForm({ localeTag, listingId, startAt, endAt, label }: BookFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const [state, action, pending] = useActionState(startCheckoutAction, INITIAL);
  const error = state.errors[0];
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (pending) event.preventDefault();
  };
  return (
    <form action={action} data-testid="s03-book">
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="startAt" value={startAt} />
      <input type="hidden" name="endAt" value={endAt} />
      {error !== undefined && (
        <Banner tone="danger" live="assertive">
          {i18n.t(error.key)}
        </Banner>
      )}
      <Button type="submit" block loading={pending} onClick={onClick}>
        {label}
      </Button>
    </form>
  );
}
