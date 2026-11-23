'use server';
/**
 * Action serveur d'une amende, d'un péage ou d'une fourrière déclarés par l'hôte (US-318, ADR-198 ;
 * 19 US-318 critère 3 ; 08 BR-TT-02 à 04), en deux temps (revue ux n° 1) : `review` demande le
 * récapitulatif calculé par l'API (`POST /trips/{id}/traffic-charges/preview`, rien d'écrit) ;
 * `confirm` envoie la MÊME saisie avec le même identifiant de requête
 * (`POST /trips/{id}/traffic-charges`) ; `correct` revient au formulaire, saisie conservée.
 * Date et heure sont saisies dans l'ordre de la langue de la vue (revue ux n° 6). Le fuseau du trip et
 * l'exposant de la devise sont RELUS sur l'API (`GET /host/accounts/{org}/trips/{id}`), jamais pris
 * du formulaire : l'heure murale saisie devient un instant UTC, le montant saisi dans la langue de
 * la vue devient des unités mineures sans flottant (`minorFromInput`). Aucun frais ni aucun total
 * n'est calculé ici : l'API les rend. Délai, période du trip et pièce sont jugés par la base.
 * Suite (0181, ADR-201) : la référence de l'avis, du PV ou du reçu est obligatoire (format revérifié
 * ici, unicité par trip jugée en base : `TRAFFIC_DUPLICATE`) ; le plafond du pays est appliqué par
 * la base (`TRAFFIC_AMOUNT_ABOVE_CAP`) ; chaque refus est rendu sur son champ.
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getProfile } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../../../../account/api-client.ts';
import { messageKeyOf, minorFromInput } from '../../../../../../account/host-listings.ts';
import { hostTripOf } from '../../../../../../account/host-trips.ts';
import { clientContext } from '../../../../../../account/request.ts';
import {
  dateOrder,
  parseLocalDate,
  parseLocalTime,
  TRAFFIC_KINDS,
  TRAFFIC_REFERENCE_MAX,
  trafficDeclaredOf,
  trafficPreviewOf,
  trafficReferenceOf,
  UUID,
} from '../../../../../../account/trip-claims.ts';
import type { TrafficDeclared, TrafficPreview } from '../../../../../../account/trip-claims.ts';
import { localToUtc } from '../../../../../../account/trip-meetings.ts';
import { getRequestLocaleTag } from '../../../../../../i18n.ts';
import { LOCALE_CONFIG } from '../../../../../../locale-config.ts';
import type { FormError, FormErrors } from '../../../../_account/errors.ts';
import {
  TRAFFIC_AMOUNT_ID,
  TRAFFIC_AT_ID,
  TRAFFIC_TIME_ID,
  TRAFFIC_FILE_ID,
  TRAFFIC_FORM_ID,
  TRAFFIC_KIND_ID,
  TRAFFIC_REFERENCE_ID,
} from './ids.ts';

export interface TrafficValues {
  readonly kind: string;
  readonly reference: string;
  readonly date: string;
  readonly time: string;
  readonly amount: string;
  readonly file: string;
}

export interface TrafficState {
  readonly errors: FormErrors;
  readonly sent?: TrafficDeclared & { readonly currency: string; readonly exponent: number };
  /** Récapitulatif rendu par l'API, à confirmer (aucun montant calculé ici). */
  readonly preview?: TrafficPreview & { readonly exponent: number };
  /** Saisie conservée (refus, récapitulatif, correction). */
  readonly values?: TrafficValues;
}

const field = (form: FormData, name: string, max = 40): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};

export async function trafficChargeAction(
  _prev: TrafficState,
  form: FormData,
): Promise<TrafficState> {
  const intent = field(form, 'intent');
  const tripId = field(form, 'trip');
  const org = field(form, 'org');
  const requestId = field(form, 'request');
  const values: TrafficValues = {
    kind: field(form, 'kind'),
    reference: field(form, 'reference', TRAFFIC_REFERENCE_MAX + 1),
    date: field(form, 'date'),
    time: field(form, 'time'),
    amount: field(form, 'amount'),
    file: field(form, 'file'),
  };
  if (intent === 'correct') return { errors: [], values };
  const fail = (fieldId: string, key: MessageKey): TrafficState => ({
    errors: [{ fieldId, key }],
    values,
  });
  if (
    !UUID.test(tripId) ||
    !UUID.test(org) ||
    !UUID.test(requestId) ||
    (intent !== 'review' && intent !== 'confirm')
  ) {
    return fail(TRAFFIC_FORM_ID, 'common.tripClaims.notFound');
  }
  const ctx = await clientContext();
  const tripReply = await callApi('GET', `/host/accounts/${org}/trips/${tripId}`, ctx);
  if (tripReply.status === 401) redirect('/login');
  const read = hostTripOf(tripReply);
  if (read === null) return fail(TRAFFIC_FORM_ID, 'common.tripClaims.notFound');
  const tag = await getRequestLocaleTag();
  const number = getProfile(LOCALE_CONFIG, tag).number;
  const day = parseLocalDate(values.date, dateOrder(tag));
  const time = parseLocalTime(values.time);
  const occurredAt =
    day === null || time === null ? null : localToUtc(`${day}T${time}`, read.trip.timezone);
  const amountMinor = minorFromInput(values.amount, read.market.currencyExponent, number);
  const reference = trafficReferenceOf(values.reference);
  const errors: FormError[] = [];
  if (!(TRAFFIC_KINDS as readonly string[]).includes(values.kind)) {
    errors.push({ fieldId: TRAFFIC_KIND_ID, key: 'web.traffic.kindRequired' });
  }
  if (values.reference === '') {
    errors.push({
      fieldId: TRAFFIC_REFERENCE_ID,
      key: 'common.tripClaims.trafficReferenceRequired',
    });
  } else if (reference === null) {
    errors.push({ fieldId: TRAFFIC_REFERENCE_ID, key: 'web.traffic.referenceInvalid' });
  }
  if (day === null) errors.push({ fieldId: TRAFFIC_AT_ID, key: 'web.traffic.dateInvalid' });
  else if (time === null) errors.push({ fieldId: TRAFFIC_TIME_ID, key: 'web.traffic.timeInvalid' });
  else if (occurredAt === null)
    errors.push({ fieldId: TRAFFIC_AT_ID, key: 'web.traffic.atRequired' });
  if (amountMinor === null || amountMinor === '0') {
    errors.push({ fieldId: TRAFFIC_AMOUNT_ID, key: 'web.traffic.amountInvalid' });
  }
  if (!UUID.test(values.file))
    errors.push({ fieldId: TRAFFIC_FILE_ID, key: 'web.traffic.fileRequired' });
  if (errors.length > 0) return { errors, values };
  const payload = {
    requestId,
    kind: values.kind,
    occurredAt,
    amountMinor,
    fileId: values.file,
    reference,
  };
  const reply = await callApi(
    'POST',
    intent === 'review'
      ? `/trips/${tripId}/traffic-charges/preview`
      : `/trips/${tripId}/traffic-charges`,
    ctx,
    payload,
  );
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (intent === 'review' && reply.status === 200) {
    const preview = trafficPreviewOf(reply);
    if (preview === null) return fail(TRAFFIC_FORM_ID, 'common.error.server');
    return {
      errors: [],
      values,
      preview: { ...preview, exponent: read.market.currencyExponent },
    };
  }
  if (intent === 'confirm' && reply.status === 201) {
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
        : code === 'TRAFFIC_DUPLICATE' || code === 'TRAFFIC_REFERENCE_REQUIRED'
          ? TRAFFIC_REFERENCE_ID
          : code === 'TRAFFIC_AMOUNT_ABOVE_CAP'
            ? TRAFFIC_AMOUNT_ID
            : TRAFFIC_FORM_ID;
  return fail(
    fieldId,
    reply.status === 'unavailable'
      ? 'common.tripClaims.unavailable'
      : (messageKeyOf(reply) ?? 'common.error.server'),
  );
}
