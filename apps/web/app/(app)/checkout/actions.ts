'use server';
/**
 * Actions serveur du checkout en une page (S03 « Reservar » → S05 ; US-208, partie 208b ;
 * ADR-133, ADR-134). Le site appelle l'API CÔTÉ SERVEUR (`account/api-client.ts`) ; l'annonce,
 * la période et le devis viennent de champs cachés que l'API revérifie toujours (devis d'un autre
 * voyageur : 404). Le site n'envoie JAMAIS de montant (L2-PM-03). Formulaires sans JavaScript.
 *
 * - `startCheckoutAction` (S03) : `POST /checkout/quotes` puis S05 du devis figé.
 * - `renewQuoteAction` (S05, devis expiré) et `placeHoldAction` sur `QUOTE_EXPIRED` : la réponse
 *   409 ne porte AUCUN devis de remplacement (contrat de l'API) ; le site redemande un devis pour
 *   la même annonce et la même période, puis rouvre S05 sur le NOUVEAU devis avec
 *   `?renewed=1` : le nouveau total est affiché et les cases sont à cocher de nouveau avant toute
 *   pose (revue ux / qa / architecture de 208a).
 * - `placeHoldAction` (S05) : contrôles de forme (nom, case manuelle, chaque document coché), puis
 *   `POST /checkout/quotes/{id}/hold` ; succès : confirmation du hold. Aucun paiement (US-223).
 *
 * Session absente ou expirée ⇒ connexion ; CGU à réaccepter (`TERMS_REACCEPT_REQUIRED`, TermsGuard)
 * ⇒ écran de réacceptation. Jamais de donnée personnelle dans une URL ni dans un journal.
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../account/api-client.ts';
import type { ApiResult } from '../../../account/api-client.ts';
import {
  checkoutErrorKey,
  checkoutHoldOf,
  checkoutInputErrors,
  checkoutInputOf,
  checkoutQuoteOf,
  holdRequestOf,
  isUuid,
  S05_FIELD,
} from '../../../account/checkout.ts';
import type { CheckoutFieldError } from '../../../account/checkout.ts';
import { clientContext } from '../../../account/request.ts';

export interface CheckoutFormState {
  readonly errors: readonly CheckoutFieldError[];
  /** Saisie renvoyée après un refus (React réinitialise le formulaire, rien n'est perdu). */
  readonly values?: Readonly<Record<string, string>>;
}

/** Instant UTC du créneau, au pas de 30 min (même règle que l'API). */
const SLOT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:[03]0:00(\.000)?Z$/;

const hidden = (form: FormData, name: string, max = 40): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.slice(0, max) : '';
};

/** Refus communs : session absente ou expirée ⇒ connexion ; CGU à réaccepter ⇒ réacceptation. */
function guardReply(reply: ApiResult): void {
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
}

/** Nouveau devis figé pour une annonce et une période ; S05 du devis, ou l'erreur à afficher. */
async function freezeAndOpen(
  listingId: string,
  startAt: string,
  endAt: string,
  renewed: boolean,
): Promise<CheckoutFormState> {
  const reply = await callApi('POST', '/checkout/quotes', await clientContext(), {
    listingId,
    startAt,
    endAt,
  });
  guardReply(reply);
  const quote = checkoutQuoteOf(reply);
  if (quote === null) {
    return { errors: [{ fieldId: S05_FIELD.form, key: checkoutErrorKey(reply) }] };
  }
  redirect(`/checkout/${quote.quoteId}${renewed ? '?renewed=1' : ''}`);
}

/** S03 « Reservar » : devis figé des dates contrôlées de la fiche, puis S05. */
export async function startCheckoutAction(
  _prev: CheckoutFormState,
  form: FormData,
): Promise<CheckoutFormState> {
  const listingId = hidden(form, 'listingId');
  const startAt = hidden(form, 'startAt');
  const endAt = hidden(form, 'endAt');
  if (!isUuid(listingId) || !SLOT_INSTANT.test(startAt) || !SLOT_INSTANT.test(endAt)) {
    return { errors: [{ fieldId: S05_FIELD.form, key: 'common.quote.datesInvalid' }] };
  }
  // session absente : la connexion d'abord (aucun devis figé pour un inconnu)
  if ((await clientContext()).sessionToken === null) redirect('/login');
  return freezeAndOpen(listingId, startAt, endAt, false);
}

/** Relit le devis du voyageur (annonce et période) pour en redemander un. */
async function renewFrom(quoteId: string): Promise<CheckoutFormState> {
  const reply = await callApi('GET', `/checkout/quotes/${quoteId}`, await clientContext());
  guardReply(reply);
  const old = checkoutQuoteOf(reply);
  if (old === null) {
    return { errors: [{ fieldId: S05_FIELD.form, key: checkoutErrorKey(reply) }] };
  }
  return freezeAndOpen(old.listingId, old.startAt, old.endAt, true);
}

/** S05, devis expiré : nouveau devis pour la même annonce et la même période. */
export async function renewQuoteAction(
  _prev: CheckoutFormState,
  form: FormData,
): Promise<CheckoutFormState> {
  const quoteId = hidden(form, 'quoteId');
  if (!isUuid(quoteId)) {
    return { errors: [{ fieldId: S05_FIELD.form, key: 'common.quote.notFound' }] };
  }
  return renewFrom(quoteId);
}

/** Saisie texte renvoyée après un refus (jamais les champs cachés). */
function keep(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v !== 'string' || k.startsWith('$') || k === 'quoteId' || k.startsWith('version.')) {
      continue;
    }
    values[k] = v.slice(0, 100);
  }
  return values;
}

/** S05 : contrôles de forme, puis pose du hold CHECKOUT ; succès : confirmation. */
export async function placeHoldAction(
  _prev: CheckoutFormState,
  form: FormData,
): Promise<CheckoutFormState> {
  const quoteId = hidden(form, 'quoteId');
  if (!isUuid(quoteId)) {
    return { errors: [{ fieldId: S05_FIELD.form, key: 'common.quote.notFound' }] };
  }
  const input = checkoutInputOf(form);
  const errors = checkoutInputErrors(input, form.get('manualRequired') === '1');
  if (errors.length > 0) return { errors, values: keep(form) };
  const reply = await callApi(
    'POST',
    `/checkout/quotes/${quoteId}/hold`,
    await clientContext(),
    holdRequestOf(input),
  );
  guardReply(reply);
  const hold = checkoutHoldOf(reply);
  if (hold !== null) redirect(`/checkout/hold/${hold.holdId}`);
  const code = codeOf(reply);
  // prix expiré : nouveau devis affiché, cases à cocher de nouveau (aucun hold posé)
  if (code === 'QUOTE_EXPIRED') return renewFrom(quoteId);
  // documents changés : S05 relu avec les versions en vigueur, cases à cocher de nouveau
  if (code === 'TERMS_VERSION_CHANGED') redirect(`/checkout/${quoteId}?terms=changed`);
  const fieldId =
    code === 'DRIVER_MUST_BE_ACCOUNT_HOLDER'
      ? S05_FIELD.firstName
      : code === 'MANUAL_TRANSMISSION_NOT_CONFIRMED'
        ? S05_FIELD.manual
        : S05_FIELD.form;
  return { errors: [{ fieldId, key: checkoutErrorKey(reply) }], values: keep(form) };
}
