'use server';
/**
 * Actions serveur des frais annexes (US-706, ADR-197 ; 16 CLM-021 ; 10b A04, S12) :
 * - `submitIncidentalAction` (hôte) : `POST /trips/{id}/incidental-fees` avec le type, le montant
 *   converti en unités mineures sans flottant, le motif et les photos choisies du trip ;
 * - `acceptIncidentalAction`, `disputeIncidentalAction` (voyageur), `cancelIncidentalAction`
 *   (hôte) : `POST …/{invoiceId}/accept|dispute|cancel`.
 * L'identifiant de la demande est posé au rendu du formulaire : un double clic ou une reprise réseau
 * envoie le même, la base rend la même demande. Entrées revérifiées ici puis par l'API et la base
 * (liste fermée, pièces, délais, plafonds) ; aucune heure ni aucune jambe envoyée. Aucune donnée
 * personnelle dans une URL ni un journal.
 */
import { redirect } from 'next/navigation';
import { getProfile } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../account/api-client.ts';
import { minorFromInput, priceExample } from '../../../account/host-listings.ts';
import { clientContext } from '../../../account/request.ts';
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  DISPUTE_MAX,
  DISPUTE_MIN,
  EVIDENCE_MAX,
  FEE_TYPES,
  incidentalFailureKey,
  incidentalHref,
  UUID,
} from '../../../account/trip-incidental.ts';
import type { Done, IncidentalRole } from '../../../account/trip-incidental.ts';
import { getRequestLocaleTag } from '../../../i18n.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';

export interface IncidentalFormState {
  readonly key: MessageKey | null;
  readonly values?: Readonly<Record<string, string>>;
  /** Champ en erreur (focus et `aria-invalid`), jamais une valeur. */
  readonly field?: 'amount' | 'description' | 'photos' | 'reason' | null;
}

const short = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, 40).toLowerCase() : '';
};
const text = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.slice(0, max + 1) : '';
};
const files = (form: FormData): string[] =>
  [
    ...new Set(
      form
        .getAll('evidence')
        .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
        .filter((v) => UUID.test(v)),
    ),
  ].slice(0, EVIDENCE_MAX);

async function after(
  reply: Awaited<ReturnType<typeof callApi>>,
  role: IncidentalRole,
  tripId: string,
  org: string | null,
  done: Done,
  values: Readonly<Record<string, string>> = {},
): Promise<IncidentalFormState> {
  if (reply.status !== 200) {
    if (reply.status === 401) redirect('/login');
    if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
    return { key: incidentalFailureKey(reply), values, field: null };
  }
  redirect(incidentalHref(role, tripId, org, done));
}

export async function submitIncidentalAction(
  _prev: IncidentalFormState,
  form: FormData,
): Promise<IncidentalFormState> {
  const tripId = short(form, 'trip');
  const requestId = short(form, 'requestId');
  const orgRaw = short(form, 'org');
  const org = UUID.test(orgRaw) ? orgRaw : null;
  if (!UUID.test(tripId) || !UUID.test(requestId)) return { key: 'common.incidental.notFound' };
  const feeType = short(form, 'feeType').toUpperCase();
  const amountRaw = text(form, 'amount', 40);
  const description = text(form, 'description', DESCRIPTION_MAX).trim();
  const evidence = files(form);
  const values = { feeType, amount: amountRaw.trim(), description };
  const exponentRaw = Number(short(form, 'exponent'));
  const exponent =
    Number.isInteger(exponentRaw) && exponentRaw >= 0 && exponentRaw <= 4 ? exponentRaw : 0;
  const number = getProfile(LOCALE_CONFIG, await getRequestLocaleTag()).number;
  const amountMinor = minorFromInput(amountRaw, exponent, number);
  if (!(FEE_TYPES as readonly string[]).includes(feeType)) {
    return { key: 'common.incidental.typeNotAllowed', values, field: null };
  }
  if (amountMinor === null || amountMinor === '0') {
    return {
      key: 'web.incidental.form.amountInvalid',
      values: { ...values, example: priceExample(exponent, number) },
      field: 'amount',
    };
  }
  if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    return { key: 'web.incidental.form.descriptionInvalid', values, field: 'description' };
  }
  if (evidence.length === 0) {
    return { key: 'web.incidental.form.photoRequired', values, field: 'photos' };
  }
  const reply = await callApi('POST', `/trips/${tripId}/incidental-fees`, await clientContext(), {
    requestId,
    feeType,
    amountMinor,
    description,
    evidenceFileIds: evidence,
  });
  return after(reply, 'HOST', tripId, org, 'submitted', values);
}

async function invoiceAction(
  form: FormData,
  role: IncidentalRole,
  action: 'accept' | 'cancel',
  done: Done,
): Promise<IncidentalFormState> {
  const tripId = short(form, 'trip');
  const invoiceId = short(form, 'invoice');
  const orgRaw = short(form, 'org');
  const org = UUID.test(orgRaw) ? orgRaw : null;
  if (!UUID.test(tripId) || !UUID.test(invoiceId)) return { key: 'common.incidental.notFound' };
  const reply = await callApi(
    'POST',
    `/trips/${tripId}/incidental-fees/${invoiceId}/${action}`,
    await clientContext(),
    {},
  );
  return after(reply, role, tripId, org, done);
}

export async function acceptIncidentalAction(
  _prev: IncidentalFormState,
  form: FormData,
): Promise<IncidentalFormState> {
  return invoiceAction(form, 'GUEST', 'accept', 'accepted');
}

export async function cancelIncidentalAction(
  _prev: IncidentalFormState,
  form: FormData,
): Promise<IncidentalFormState> {
  // demande contestée : l'annulation est définitive (ADR-202) ; rien n'est envoyé sans la
  // confirmation de l'hôte
  if (short(form, 'disputed') === 'yes' && short(form, 'confirmFinal') !== 'yes') {
    return { key: 'web.incidental.cancelDisputedFinal' };
  }
  return invoiceAction(form, 'HOST', 'cancel', 'cancelled');
}

export async function disputeIncidentalAction(
  _prev: IncidentalFormState,
  form: FormData,
): Promise<IncidentalFormState> {
  const tripId = short(form, 'trip');
  const invoiceId = short(form, 'invoice');
  if (!UUID.test(tripId) || !UUID.test(invoiceId)) return { key: 'common.incidental.notFound' };
  const reason = text(form, 'reason', DISPUTE_MAX).trim();
  const evidence = files(form);
  const values = { reason };
  if (reason.length < DISPUTE_MIN || reason.length > DISPUTE_MAX) {
    return { key: 'web.incidental.dispute.reasonInvalid', values, field: 'reason' };
  }
  if (evidence.length === 0) {
    return { key: 'web.incidental.form.photoRequired', values, field: 'photos' };
  }
  const reply = await callApi(
    'POST',
    `/trips/${tripId}/incidental-fees/${invoiceId}/dispute`,
    await clientContext(),
    { reason, evidenceFileIds: evidence },
  );
  return after(reply, 'GUEST', tripId, null, 'disputed', values);
}
