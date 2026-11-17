'use client';
/**
 * Bouton de paiement du hold (US-223 partie 223b, ADR-142) : S05 « Pagar {amount} » (10b S05,
 * N-170 : le libellé dit qu'on paie) et S06 « Pagar de nuevo » après un refus. Le formulaire ne
 * porte que l'identifiant du hold : le montant affiché vient de l'API, rien n'est envoyé d'autre.
 * Pendant l'envoi : `aria-busy` et second clic ignoré (un seul ordre par hold, jugé aussi par la
 * base). Sans JavaScript : envoi natif, même action serveur. Un refus s'affiche au-dessus du bouton
 * (`role="alert"`).
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ButtonLink } from '@rueda/ui';
import { IDENTITY_HREF, IDENTITY_REFUSAL_KEYS } from '../../../../../account/checkout.ts';
import { LOCALE_CONFIG } from '../../../../../locale-config.ts';
import accountStyles from '../../../_account/account.module.css';
import { payHoldAction } from '../../payment-actions.ts';
import type { PaymentFormState } from '../../payment-actions.ts';

const INITIAL: PaymentFormState = { error: null };

export interface PayFormProps {
  readonly localeTag: string;
  readonly holdId: string;
  /** Libellé déjà traduit et formaté (montant rendu par l'API). */
  readonly label: string;
  readonly testId: string;
}

export function PayForm({ localeTag, holdId, label, testId }: PayFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const [state, action, pending] = useActionState(payHoldAction, INITIAL);
  return (
    <form action={action} className={accountStyles['stack']} data-testid={testId}>
      <input type="hidden" name="holdId" value={holdId} />
      {state.error !== null && (
        <Banner tone="danger" live="assertive">
          {i18n.t(state.error)}
        </Banner>
      )}
      {/* refus du conducteur relu au paiement, levé depuis S04 (UXQ-12, US-209c) */}
      {state.error !== null && IDENTITY_REFUSAL_KEYS.has(state.error) && (
        <ButtonLink
          variant="secondary"
          href={IDENTITY_HREF}
          data-testid={`${testId}-identity-link`}
        >
          {i18n.t('web.s05.kyc.link')}
        </ButtonLink>
      )}
      <Button
        type="submit"
        block
        loading={pending}
        data-testid={`${testId}-submit`}
        onClick={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        {label}
      </Button>
    </form>
  );
}
