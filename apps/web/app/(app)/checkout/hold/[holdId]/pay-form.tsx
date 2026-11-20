'use client';
/**
 * Bouton de paiement du hold (US-223 partie 223b, ADR-142) : S05 « Pagar {amount} » (10b S05,
 * N-170 : le libellé dit qu'on paie) et S06 « Pagar de nuevo » après un refus. Le formulaire ne
 * porte que l'identifiant du hold : le montant affiché vient de l'API, rien n'est envoyé d'autre.
 * Pendant l'envoi : `aria-busy` et second clic ignoré (un seul ordre par hold, jugé aussi par la
 * base). Sans JavaScript : envoi natif, même action serveur. Un refus s'affiche au-dessus du bouton
 * (`role="alert"`).
 *
 * US-703 (ADR-189 n° 15 ; 10b UX-30, 16 PAY-015 ; DEC-FONDATEUR-22) : consentement MIT sous la
 * forme du pays rendue par l'API. `NOTICE` (défaut, comme Turo) : mention explicite et lisible
 * juste au-dessus du bouton (`web.s05.mitConsentNotice`, « En payant, j'autorise… ») ; payer vaut
 * consentement, enregistré par la base avec la version du texte. `CHECKBOX` : case séparée, NON
 * pré-cochée, obligatoire et annoncée comme telle (`web.s05.mitConsentRequiredHint`). La langue du
 * texte affiché part avec le formulaire ; l'API refuse sans consentement (`MIT_CONSENT_REQUIRED`).
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ButtonLink, Checkbox } from '@rueda/ui';
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
  /** Forme du consentement MIT du pays (API) ; inconnue : la case, la forme la plus explicite. */
  readonly mitConsentMode: 'NOTICE' | 'CHECKBOX' | null;
}

export function PayForm({ localeTag, holdId, label, testId, mitConsentMode }: PayFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const [state, action, pending] = useActionState(payHoldAction, INITIAL);
  return (
    <form action={action} className={accountStyles['stack']} data-testid={testId}>
      <input type="hidden" name="holdId" value={holdId} />
      <input type="hidden" name="locale" value={localeTag} />
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
      {mitConsentMode === 'NOTICE' ? (
        <>
          <input type="hidden" name="mitConsent" value="on" />
          <p className={accountStyles['text']} data-testid={`${testId}-mit-notice`}>
            {i18n.t('web.s05.mitConsentNotice')}
          </p>
        </>
      ) : (
        <Checkbox
          id={`${testId}-mit-consent`}
          name="mitConsent"
          required
          aria-required="true"
          label={i18n.t('web.s05.mitConsent')}
          hint={i18n.t('web.s05.mitConsentRequiredHint')}
          data-testid={`${testId}-mit-consent`}
        />
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
