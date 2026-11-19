'use server';
/**
 * Action serveur de l'envoi d'un message (S16, US-525, ADR-181) : `POST /trips/{id}/messages` avec
 * l'identifiant du message tiré au rendu de la page (champ caché) : un nouvel essai après une
 * erreur garde le MÊME identifiant et le texte saisi (10b S16 « message non envoyé → réessayer,
 * texte conservé »), sans doublon. Succès : retour à l'écran (`?sent=1`, rappels `?n=…` quand la
 * base a masqué des coordonnées ou signalé un paiement hors plateforme). Le chemin de retour est
 * reconstruit à partir de l'identifiant du trip et de la portée (`guest` ou `host`), jamais lu tel
 * quel (aucune redirection ouverte) ; jamais de texte de message dans une URL.
 */
import { redirect } from 'next/navigation';
import { callApi } from '../../../account/api-client.ts';
import { messageKeyOf } from '../../../account/host-listings.ts';
import { clientContext } from '../../../account/request.ts';
import {
  MESSAGE_MAX_CHARS,
  UUID,
  sentNoticesOf,
  threadPath,
} from '../../../account/trip-messages.ts';
import type { FormErrors } from '../_account/errors.ts';
import { MESSAGE_BODY_ID, MESSAGE_FORM_ID } from './ids.ts';

export interface MessageFormState {
  readonly errors: FormErrors;
  /** Texte saisi, gardé pour un nouvel essai. */
  readonly draft: string;
}

const field = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.slice(0, max) : '';
};

export async function postMessageAction(
  _prev: MessageFormState,
  form: FormData,
): Promise<MessageFormState> {
  const tripId = field(form, 'trip', 36);
  const id = field(form, 'id', 36);
  const scope = field(form, 'scope', 5) === 'host' ? 'host' : 'guest';
  // borne grossière : la base juge le texte (1 à 2 000 caractères après les blancs de bord)
  const draft = field(form, 'body', MESSAGE_MAX_CHARS * 2);
  const back = threadPath(scope, tripId);
  if (back === null || !UUID.test(id)) {
    return { draft, errors: [{ fieldId: MESSAGE_FORM_ID, key: 'common.trips.notFound' }] };
  }
  if (draft.trim() === '') {
    return { draft, errors: [{ fieldId: MESSAGE_BODY_ID, key: 'web.s16.form.required' }] };
  }
  const reply = await callApi('POST', `/trips/${tripId}/messages`, await clientContext(), {
    id,
    body: draft,
  });
  if (reply.status === 401) redirect('/login');
  const notices = sentNoticesOf(reply);
  if (notices === null) {
    const key =
      reply.status === 'unavailable'
        ? 'common.messages.unavailable'
        : (messageKeyOf(reply) ?? 'common.messages.unavailable');
    const fieldId = reply.status === 422 ? MESSAGE_BODY_ID : MESSAGE_FORM_ID;
    return { draft, errors: [{ fieldId, key }] };
  }
  redirect(notices.length > 0 ? `${back}?sent=1&n=${notices.join('.')}` : `${back}?sent=1`);
}
