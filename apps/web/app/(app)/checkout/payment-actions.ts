'use server';
/**
 * Action serveur du paiement du hold (S05 « Pagar {amount} », S06 « Pagar de nuevo » ; US-223
 * partie 223b, ADR-142). Le site appelle l'API CÔTÉ SERVEUR (`account/api-client.ts`) avec le seul
 * identifiant du hold (champ caché revérifié par l'API : hold d'un autre voyageur ⇒ 404) et le moyen
 * de paiement ; JAMAIS de montant ni de jambe (L2-PM-03).
 *
 * - 201 : ordre créé ⇒ redirection vers la page hébergée du PSP (adresse https rendue par l'API
 *   seulement) ;
 * - 200 (aucun ordre créé : ordre déjà en cours, hold payé ou terminé), hold échu ou déjà payé ⇒ S06,
 *   dont l'état fait foi (UX-27 : jamais un second ordre pendant qu'un ordre est actif) ;
 * - autre refus ⇒ message du code, sur l'écran qui a envoyé.
 * Session absente ⇒ connexion ; CGU à réaccepter ⇒ réacceptation.
 *
 * US-703 (ADR-189) : la case du consentement MIT (S05, non pré-cochée) part telle quelle
 * (`mitConsent`) avec la langue du texte affiché ; non cochée ⇒ message, aucun appel.
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../account/api-client.ts';
import {
  checkoutPaymentOf,
  PAYMENT_STATE_CODES,
  paymentErrorKey,
  paymentHref,
} from '../../../account/checkout-payment.ts';
import { isUuid } from '../../../account/checkout.ts';
import { clientContext } from '../../../account/request.ts';
import type { MessageKey } from '@rueda/i18n';

export interface PaymentFormState {
  readonly error: MessageKey | null;
}

export async function payHoldAction(
  _prev: PaymentFormState,
  form: FormData,
): Promise<PaymentFormState> {
  const raw = form.get('holdId');
  const holdId = typeof raw === 'string' ? raw.slice(0, 40) : '';
  if (!isUuid(holdId)) return { error: 'common.checkout.holdNotFound' };
  if (form.get('mitConsent') !== 'on') return { error: 'common.payment.mitConsentRequired' };
  const rawLocale = form.get('locale');
  const locale = typeof rawLocale === 'string' ? rawLocale.slice(0, 8) : '';
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const reply = await callApi('POST', `/checkout/holds/${holdId}/payment`, ctx, {
    method: 'CARD',
    mitConsent: true,
    locale,
  });
  if (reply.status === 401) redirect('/login');
  const code = codeOf(reply);
  if (code === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  const payment = checkoutPaymentOf(reply);
  if (payment !== null) {
    // page hébergée du PSP : adresse https rendue par l'API seulement (checkoutPaymentOf)
    if (reply.status === 201 && payment.redirectUrl !== null) redirect(payment.redirectUrl);
    redirect(paymentHref(holdId));
  }
  if (code !== null && PAYMENT_STATE_CODES.includes(code)) redirect(paymentHref(holdId));
  return { error: paymentErrorKey(reply) };
}
