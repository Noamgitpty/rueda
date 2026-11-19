'use server';
/**
 * Action serveur de la demande d'aide du trip (US-310, ADR-182 ; 16 SUP-004) : `POST
 * /trips/{id}/help-requests` avec un motif FERMÉ et l'identifiant de la demande (champ caché,
 * idempotence du rejeu : un double envoi ne crée pas deux demandes). Aucun texte libre, aucun
 * téléphone (minimisation). Le voyageur ou l'hôte est celui de la session, jugé par la base. Jamais
 * de donnée personnelle dans une URL.
 */
import { redirect } from 'next/navigation';
import type { MessageKey } from '@rueda/i18n';
import { callApi } from '../../../../../account/api-client.ts';
import { HELP_TOPICS, helpRequestOf } from '../../../../../account/help.ts';
import { clientContext } from '../../../../../account/request.ts';
import { UUID } from '../../../../../account/trip-contract.ts';
import type { FormErrors } from '../../../_account/errors.ts';
import { HELP_FORM_ID, HELP_TOPIC_ID } from './ids.ts';

export interface HelpRequestState {
  readonly errors: FormErrors;
  readonly sent?: {
    readonly outcome: 'OPENED' | 'DUPLICATE' | 'EXISTS';
    readonly offHours: boolean;
  };
}

const field = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};

export async function requestHelpAction(
  _prev: HelpRequestState,
  form: FormData,
): Promise<HelpRequestState> {
  const tripId = field(form, 'trip', 36);
  const requestId = field(form, 'request', 36);
  const topic = field(form, 'topic', 16);
  const error = (fieldId: string, key: MessageKey): HelpRequestState => ({
    errors: [{ fieldId, key }],
  });
  if (!UUID.test(tripId) || !UUID.test(requestId)) {
    return error(HELP_FORM_ID, 'web.help.request.error');
  }
  if (!(HELP_TOPICS as readonly string[]).includes(topic)) {
    return error(HELP_TOPIC_ID, 'web.help.request.topicRequired');
  }
  const reply = await callApi('POST', `/trips/${tripId}/help-requests`, await clientContext(), {
    requestId,
    topic,
  });
  if (reply.status === 401) redirect('/login');
  if (reply.status === 404) return error(HELP_FORM_ID, 'common.trips.notFound');
  const sent = helpRequestOf(reply);
  if (sent === null) return error(HELP_FORM_ID, 'web.help.request.error');
  return { errors: [], sent };
}
