'use server';
/**
 * Action serveur du no-show (US-307, ADR-191 ; 16 TRP-015) : `reportNoShowAction` déclare l'autre
 * partie absente (`POST /trips/{id}/no-show`, `{ requestId }`). L'identifiant de la demande est
 * posé au rendu du formulaire : un double clic ou une reprise réseau envoie le même, la base rend
 * la même demande (aucune déclaration ne se rejoue). Entrées revérifiées ici puis par l'API et la
 * base ; aucune heure ni aucun montant envoyés. Aucune donnée personnelle dans une URL ni un journal.
 */
import { redirect } from 'next/navigation';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../account/api-client.ts';
import { clientContext } from '../../../account/request.ts';
import { noShowFailureKey, noShowHref, UUID } from '../../../account/trip-no-show.ts';

export interface NoShowFormState {
  readonly key: MessageKey | null;
}

export async function reportNoShowAction(
  _prev: NoShowFormState,
  form: FormData,
): Promise<NoShowFormState> {
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === 'string' ? v.trim().slice(0, 40).toLowerCase() : '';
  };
  const tripId = field('trip');
  const requestId = field('requestId');
  const role = field('role') === 'host' ? 'HOST' : 'GUEST';
  const org = field('org');
  if (!UUID.test(tripId) || !UUID.test(requestId)) return { key: 'common.noShow.notFound' };
  if (field('confirm') !== 'yes') return { key: 'web.noShow.confirmRequired' };
  const reply = await callApi('POST', `/trips/${tripId}/no-show`, await clientContext(), {
    requestId,
  });
  if (reply.status !== 200) {
    if (reply.status === 401) redirect('/login');
    if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
    return { key: noShowFailureKey(reply) };
  }
  redirect(noShowHref(role, tripId, org));
}
