'use server';
/**
 * Action serveur de l'incident déclaré par le voyageur (US-318, ADR-198 ; 16 CLM-002 ; S17) :
 * `POST /trips/{id}/incidents` avec le dossier de la demande d'aide, deux réponses fermées (tiers
 * impliqué, police prévenue) et l'identifiant de la requête (champ caché posé par le serveur :
 * rejeu sans double incident). Aucun texte libre, aucune heure : l'heure du serveur fait foi, les
 * photos sont celles de la série `incident`. Jamais de donnée personnelle dans une URL.
 */
import { redirect } from 'next/navigation';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../../../account/api-client.ts';
import { messageKeyOf } from '../../../../../account/host-listings.ts';
import { clientContext } from '../../../../../account/request.ts';
import { incidentReportedOf, UUID } from '../../../../../account/trip-claims.ts';
import type { IncidentReported } from '../../../../../account/trip-claims.ts';
import type { FormError, FormErrors } from '../../../_account/errors.ts';
import { INCIDENT_FORM_ID, INCIDENT_POLICE_ID, INCIDENT_THIRD_PARTY_ID } from './ids.ts';

export interface IncidentState {
  readonly errors: FormErrors;
  readonly sent?: IncidentReported;
  /** Réponses rendues après un refus (le formulaire est réinitialisé par React après l'action). */
  readonly values?: { readonly thirdParty: string; readonly police: string };
}

const field = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, 40) : '';
};

const yesNo = (v: string): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null);

export async function reportIncidentAction(
  _prev: IncidentState,
  form: FormData,
): Promise<IncidentState> {
  const tripId = field(form, 'trip');
  const caseId = field(form, 'case');
  const requestId = field(form, 'request');
  const values = { thirdParty: field(form, 'thirdParty'), police: field(form, 'police') };
  const thirdParty = yesNo(values.thirdParty);
  const policeReport = yesNo(values.police);
  const fail = (fieldId: string, key: MessageKey): IncidentState => ({
    errors: [{ fieldId, key }],
    values,
  });
  if (!UUID.test(tripId) || !UUID.test(caseId) || !UUID.test(requestId)) {
    return fail(INCIDENT_FORM_ID, 'common.tripClaims.notFound');
  }
  const errors: FormError[] = [];
  if (thirdParty === null) {
    errors.push({ fieldId: INCIDENT_THIRD_PARTY_ID, key: 'web.incident.answerRequired' });
  }
  if (policeReport === null) {
    errors.push({ fieldId: INCIDENT_POLICE_ID, key: 'web.incident.answerRequired' });
  }
  if (errors.length > 0) return { errors, values };
  const reply = await callApi('POST', `/trips/${tripId}/incidents`, await clientContext(), {
    requestId,
    caseId,
    thirdParty,
    policeReport,
  });
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 201) {
    const sent = incidentReportedOf(reply);
    return sent === null ? fail(INCIDENT_FORM_ID, 'common.error.server') : { errors: [], sent };
  }
  return fail(
    INCIDENT_FORM_ID,
    reply.status === 'unavailable'
      ? 'common.tripClaims.unavailable'
      : (messageKeyOf(reply) ?? 'common.error.server'),
  );
}
