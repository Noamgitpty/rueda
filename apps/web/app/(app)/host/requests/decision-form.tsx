'use client';
/**
 * Confirmation d'une décision de l'hôte (A05 ; US-223 partie 223d, ADR-152 ; 10b A05, UX-52 :
 * verbe d'action complet « Aceptar la solicitud » / « Rechazar la solicitud »). Deuxième étape
 * explicite : la page a déjà dit la conséquence (montant débité au voyageur, ou aucun débit et
 * dates libérées). Le formulaire ne porte que le compte et la demande ; aucun montant. Pendant
 * l'envoi : `aria-busy` et second clic ignoré (une seule décision, jugée aussi par la base). Sans
 * JavaScript : envoi natif, même action serveur. Un refus s'affiche au-dessus du bouton
 * (`role="alert"`).
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../../locale-config.ts';
import accountStyles from '../../_account/account.module.css';
import { acceptRequestAction, declineRequestAction } from './actions.ts';
import type { RequestDecisionState } from './actions.ts';

const INITIAL: RequestDecisionState = { error: null };

export interface DecisionFormProps {
  readonly localeTag: string;
  readonly orgId: string;
  readonly holdId: string;
  readonly verb: 'accept' | 'decline';
}

export function DecisionForm({ localeTag, orgId, holdId, verb }: DecisionFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const [state, action, pending] = useActionState(
    verb === 'accept' ? acceptRequestAction : declineRequestAction,
    INITIAL,
  );
  return (
    <form action={action} className={accountStyles['stack']} data-testid={`a05-${verb}`}>
      <input type="hidden" name="org" value={orgId} />
      <input type="hidden" name="hold" value={holdId} />
      {state.error !== null && (
        <Banner tone="danger" live="assertive">
          {i18n.t(state.error)}
        </Banner>
      )}
      <Button
        type="submit"
        block
        variant={verb === 'accept' ? 'primary' : 'secondary'}
        loading={pending}
        data-testid={`a05-${verb}-submit`}
        onClick={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        {i18n.t(verb === 'accept' ? 'web.a05.accept' : 'web.a05.decline')}
      </Button>
    </form>
  );
}
