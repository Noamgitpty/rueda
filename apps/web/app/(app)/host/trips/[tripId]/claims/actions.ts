'use server';
/**
 * Action serveur d'une amende, d'un péage ou d'une fourrière déclarés par l'hôte (US-318, ADR-198 ;
 * 19 US-318 critère 3 ; 08 BR-TT-02 à 04) : `POST /trips/{id}/traffic-charges`. Le fuseau du trip et
 * l'exposant de la devise sont RELUS sur l'API (`GET /host/accounts/{org}/trips/{id}`), jamais pris
 * du formulaire : l'heure murale saisie devient un instant UTC, le montant saisi dans la langue de
 * la vue devient des unités mineures sans flottant (`minorFromInput`). Aucun frais ni aucun total
 * n'est calculé ici : l'API les rend. Délai, période du trip et pièce sont jugés par la base.
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getProfile } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../../../../account/api-client.ts';
import { messageKeyOf, minorFromInput } from '../../../../../../account/host-listings.ts';
import { hostTripOf } from '../../../../../../account/host-trips.ts';
import { clientContext } from '../../../../../../account/request.ts';
import { TRAFFIC_KINDS, trafficDeclaredOf, UUID } from '../../../../../../account/trip-claims.ts';
import type { TrafficDeclared } from '../../../../../../account/trip-claims.ts';
import { localToUtc } from '../../../../../../account/trip-meetings.ts';
import { getRequestLocaleTag } from '../../../../../../i18n.ts';
import { LOCALE_CONFIG } from '../../../../../../locale-config.ts';
import type { FormError, FormErrors } from '../../../../_account/errors.ts';
import {
  TRAFFIC_AMOUNT_ID,
  TRAFFIC_AT_ID,
  TRAFFIC_FILE_ID,
  TRAFFIC_FORM_ID,
  TRAFFIC_KIND_ID,
} from './ids.ts';

export interface TrafficState {
  readonly errors: FormErrors;
  readonly sent?: TrafficDeclared & { readonly currency: string; readonly exponent: number };
  /** Saisie rendue après un refus (le formulaire est réinitialisé par React après l'action). */
  readonly values?: {
    readonly kind: string;
    readonly at: string;
    readonly amount: string;
    readonly file: string;
  };
}

const field = (form: FormData, name: string, max = 40): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};

export async function declareTrafficChargeAction(
  _prev: TrafficState,
  form: FormData,
): Promise<TrafficState> {
  const tripId = field(form, 'trip');
  const org = field(form, 'org');
  const requestId = field(form, 'request');
  const kind = field(form, 'kind');
  const at = field(form, 'at');
  const amount = field(form, 'amount');
  const fileId = field(form, 'file');
  const values = { kind, at, amount, file: fileId };
  const fail = (fieldId: string, key: MessageKey): TrafficState => ({
    errors: [{ fieldId, key }],
    values,
  });
  if (!UUID.test(tripId) || !UUID.test(org) || !UUID.test(requestId)) {
    return fail(TRAFFIC_FORM_ID, 'common.tripClaims.notFound');
  }
  const ctx = await clientContext();
  const tripReply = await callApi('GET', `/host/accounts/${org}/trips/${tripId}`, ctx);
  if (tripReply.status === 401) redirect('/login');
  const read = hostTripOf(tripReply);
  if (read === null) return fail(TRAFFIC_FORM_ID, 'common.tripClaims.notFound');
  const number = getProfile(LOCALE_CONFIG, await getRequestLocaleTag()).number;
  const occurredAt = localToUtc(at, read.trip.timezone);
  const amountMinor = minorFromInput(amount, read.market.currencyExponent, number);
  const errors: FormError[] = [];
  if (!(TRAFFIC_KINDS as readonly string[]).includes(kind)) {
    errors.push({ fieldId: TRAFFIC_KIND_ID, key: 'web.traffic.kindRequired' });
  }
  if (occurredAt === null) errors.push({ fieldId: TRAFFIC_AT_ID, key: 'web.traffic.atRequired' });
  if (amountMinor === null || amountMinor === '0') {
    errors.push({ fieldId: TRAFFIC_AMOUNT_ID, key: 'web.traffic.amountInvalid' });
  }
  if (!UUID.test(fileId))
    errors.push({ fieldId: TRAFFIC_FILE_ID, key: 'web.traffic.fileRequired' });
  if (errors.length > 0) return { errors, values };
  const reply = await callApi('POST', `/trips/${tripId}/traffic-charges`, ctx, {
    requestId,
    kind,
    occurredAt,
    amountMinor,
    fileId,
  });
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 201) {
    const sent = trafficDeclaredOf(reply);
    if (sent === null) return fail(TRAFFIC_FORM_ID, 'common.error.server');
    revalidatePath(`/host/trips/${tripId}/claims`);
    return {
      errors: [],
      sent: { ...sent, currency: read.market.currency, exponent: read.market.currencyExponent },
    };
  }
  const code = codeOf(reply);
  const fieldId =
    code === 'TRAFFIC_OUTSIDE_TRIP'
      ? TRAFFIC_AT_ID
      : code === 'TRAFFIC_EVIDENCE_REQUIRED'
        ? TRAFFIC_FILE_ID
        : TRAFFIC_FORM_ID;
  return fail(
    fieldId,
    reply.status === 'unavailable'
      ? 'common.tripClaims.unavailable'
      : (messageKeyOf(reply) ?? 'common.error.server'),
  );
}
