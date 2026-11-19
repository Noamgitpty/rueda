'use server';
/**
 * Décisions de l'hôte sur une demande de réservation (A05 ; US-223 partie 223d, ADR-152 ; routes de
 * 223c, ADR-146 §5 à §7 et §10 ; 10b A05 `web.a05.accept` / `web.a05.decline`). Le site appelle
 * l'API CÔTÉ SERVEUR avec la session de l'hôte ; le compte et la demande viennent de champs cachés
 * que l'API revérifie toujours (compte d'un autre hôte, demande inconnue ou d'un autre compte ⇒ 404
 * `REQUEST_NOT_FOUND`, même réponse). Aucun montant ni aucune jambe n'est envoyé : la base capture
 * le montant du devis engagé.
 *
 * - succès ⇒ retour à A05, l'issue (`CAPTURING|ACCEPTED|DECLINED`) dans un cookie httpOnly d'une
 *   minute, jamais dans l'URL (BOARD N-286, US-223 ADR-175) ;
 * - refus ⇒ message du code sur l'écran de la demande (`common.request.*`), la demande n'est
 *   jamais dite traitée ; code inconnu ou API injoignable ⇒ message générique ;
 * - session absente ⇒ connexion ; CGU de la plateforme à réaccepter (garde de l'API) ⇒
 *   réacceptation ; CGU de l'HÔTE à réaccepter (refus de la base) ⇒ message dédié.
 * Formulaire sans JavaScript ; jamais de donnée personnelle dans une URL ni dans un journal.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../../account/api-client.ts';
import { messageKeyOf } from '../../../../account/host-listings.ts';
import {
  DECISION_COOKIE,
  DECISION_COOKIE_MAX_AGE_S,
  decisionCookieValue,
  decisionOf,
  requestErrorKey,
} from '../../../../account/host-requests.ts';
import { clientContext } from '../../../../account/request.ts';

export interface RequestDecisionState {
  readonly error: MessageKey | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const idOf = (form: FormData, name: string): string | null => {
  const v = form.get(name);
  return typeof v === 'string' && UUID.test(v) ? v : null;
};

async function decide(verb: 'accept' | 'decline', form: FormData): Promise<RequestDecisionState> {
  const orgId = idOf(form, 'org');
  const holdId = idOf(form, 'hold');
  if (orgId === null || holdId === null) return { error: 'common.request.notFound' };
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const reply = await callApi('POST', `/host/accounts/${orgId}/requests/${holdId}/${verb}`, ctx);
  if (reply.status === 401) redirect('/login');
  const decision = decisionOf(reply, holdId);
  if (decision !== null) {
    // BOARD N-286 : l'issue de l'API voyage dans un cookie httpOnly, jamais dans l'URL
    const value = decisionCookieValue(holdId, decision);
    if (value !== null) {
      (await cookies()).set(DECISION_COOKIE, value, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/host/trips',
        maxAge: DECISION_COOKIE_MAX_AGE_S,
      });
    }
    redirect(`/host/trips?org=${orgId}`);
  }
  // CGU de la plateforme (garde de l'API) ≠ CGU de l'hôte (refus de la base, message dédié)
  if (
    codeOf(reply) === 'TERMS_REACCEPT_REQUIRED' &&
    messageKeyOf(reply) !== 'common.request.hostTermsRequired'
  ) {
    redirect('/terms/update');
  }
  return { error: requestErrorKey(reply) };
}

export async function acceptRequestAction(
  _prev: RequestDecisionState,
  form: FormData,
): Promise<RequestDecisionState> {
  return decide('accept', form);
}

export async function declineRequestAction(
  _prev: RequestDecisionState,
  form: FormData,
): Promise<RequestDecisionState> {
  return decide('decline', form);
}
