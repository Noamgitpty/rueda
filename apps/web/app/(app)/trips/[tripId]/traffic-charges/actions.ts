'use server';
/**
 * Actions serveur du voyageur sur une amende, un péage ou une fourrière refacturés (suite d'US-318,
 * 0181, ADR-201 ; 08 BR-TT-02 ; 10b S12) :
 * - `acceptTrafficAction` : `POST /trips/{id}/traffic-charges/{chargeId}/accept` (corps vide ;
 *   accord écrit au bouton, débit par Kmino ensuite) ;
 * - `disputeTrafficAction` : `POST …/{chargeId}/dispute` avec le motif (20 à 1 000 caractères) et
 *   les photos du trip cochées (facultatives, 10 au plus).
 * Entrées revérifiées ici puis par l'API et la base (échéance, état, pièces) ; aucune heure ni aucun
 * montant envoyé. Aucune donnée personnelle dans une URL ni un journal.
 */
import { redirect } from 'next/navigation';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../../../account/api-client.ts';
import { clientContext } from '../../../../../account/request.ts';
import { UUID } from '../../../../../account/trip-claims.ts';
import {
  TRAFFIC_DISPUTE_MAX,
  TRAFFIC_DISPUTE_MIN,
  TRAFFIC_EVIDENCE_MAX,
  trafficFailureKey,
  trafficGuestHref,
} from '../../../../../account/trip-traffic.ts';
import type { TrafficDone } from '../../../../../account/trip-traffic.ts';

export interface TrafficGuestFormState {
  readonly key: MessageKey | null;
  readonly values?: Readonly<Record<string, string>>;
  /** Champ en erreur (focus et `aria-invalid`), jamais une valeur. */
  readonly field?: 'reason' | null;
}

const short = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, 40).toLowerCase() : '';
};

async function after(
  reply: Awaited<ReturnType<typeof callApi>>,
  tripId: string,
  done: TrafficDone,
  values: Readonly<Record<string, string>> = {},
): Promise<TrafficGuestFormState> {
  if (reply.status !== 200) {
    if (reply.status === 401) redirect('/login');
    if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
    const code = codeOf(reply);
    return {
      key: trafficFailureKey(reply),
      values,
      field: code === 'INCIDENTAL_DISPUTE_REASON_REQUIRED' ? 'reason' : null,
    };
  }
  redirect(trafficGuestHref(tripId, done));
}

export async function acceptTrafficAction(
  _prev: TrafficGuestFormState,
  form: FormData,
): Promise<TrafficGuestFormState> {
  const tripId = short(form, 'trip');
  const chargeId = short(form, 'charge');
  if (!UUID.test(tripId) || !UUID.test(chargeId)) return { key: 'common.tripClaims.notFound' };
  const reply = await callApi(
    'POST',
    `/trips/${tripId}/traffic-charges/${chargeId}/accept`,
    await clientContext(),
    {},
  );
  return after(reply, tripId, 'accepted');
}

export async function disputeTrafficAction(
  _prev: TrafficGuestFormState,
  form: FormData,
): Promise<TrafficGuestFormState> {
  const tripId = short(form, 'trip');
  const chargeId = short(form, 'charge');
  if (!UUID.test(tripId) || !UUID.test(chargeId)) return { key: 'common.tripClaims.notFound' };
  const raw = form.get('reason');
  const reason = (typeof raw === 'string' ? raw.slice(0, TRAFFIC_DISPUTE_MAX + 1) : '').trim();
  const evidence = [
    ...new Set(
      form
        .getAll('evidence')
        .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
        .filter((v) => UUID.test(v)),
    ),
  ].slice(0, TRAFFIC_EVIDENCE_MAX);
  const values = { reason };
  if (reason.length < TRAFFIC_DISPUTE_MIN || reason.length > TRAFFIC_DISPUTE_MAX) {
    return { key: 'web.trafficGuest.dispute.reasonInvalid', values, field: 'reason' };
  }
  const reply = await callApi(
    'POST',
    `/trips/${tripId}/traffic-charges/${chargeId}/dispute`,
    await clientContext(),
    { reason, evidence },
  );
  return after(reply, tripId, 'disputed', values);
}
