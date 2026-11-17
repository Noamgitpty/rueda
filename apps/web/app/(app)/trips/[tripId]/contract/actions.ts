'use server';
/**
 * Action serveur de la signature du contrat par le voyageur (S09, US-211 partie 211b, ADR-149 ;
 * 16 BKG-019 bêta SIMPLIFIÉ « case + horodatage serveur ») : `POST /trips/{id}/contract/sign` avec
 * la case cochée, le document et l'EMPREINTE du document affiché (champs cachés que la base
 * revérifie : empreinte différente ⇒ `CONTRACT_HASH_MISMATCH`, rien n'est signé). Succès : retour à
 * l'écran signé (`?signed=1`). Formulaire sans JavaScript ; jamais de donnée personnelle dans une
 * URL.
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../../../account/api-client.ts';
import { messageKeyOf } from '../../../../../account/host-listings.ts';
import { clientContext } from '../../../../../account/request.ts';
import { UUID } from '../../../../../account/trip-contract.ts';
import type { FormErrors } from '../../../_account/errors.ts';
import { SIGN_ACCEPT_ID, SIGN_FORM_ID } from './ids.ts';

export interface SignFormState {
  readonly errors: FormErrors;
}

const field = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};

export async function signContractAction(
  _prev: SignFormState,
  form: FormData,
): Promise<SignFormState> {
  const tripId = field(form, 'trip', 36);
  const documentId = field(form, 'document', 36);
  const sha256 = field(form, 'sha256', 64);
  if (!UUID.test(tripId) || !UUID.test(documentId) || !/^[0-9a-f]{64}$/.test(sha256)) {
    return { errors: [{ fieldId: SIGN_FORM_ID, key: 'common.contract.notFound' }] };
  }
  if (form.get('accepted') !== 'on') {
    return { errors: [{ fieldId: SIGN_ACCEPT_ID, key: 'web.s09.contract.sign.required' }] };
  }
  const reply = await callApi('POST', `/trips/${tripId}/contract/sign`, await clientContext(), {
    accepted: true,
    documentId,
    sha256,
  });
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status !== 200) {
    const key =
      reply.status === 'unavailable'
        ? 'common.contract.unavailable'
        : (messageKeyOf(reply) ?? 'common.error.server');
    return { errors: [{ fieldId: SIGN_FORM_ID, key }] };
  }
  redirect(`/trips/${tripId}/contract?signed=1`);
}
