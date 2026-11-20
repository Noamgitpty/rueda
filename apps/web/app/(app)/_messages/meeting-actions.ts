'use server';
/**
 * Actions serveur des rendez-vous d'un trip (S16, US-316, ADR-186) :
 * - proposition de l'hôte : `POST /trips/{id}/meetings` avec l'identifiant tiré au rendu de la page
 *   (champ caché : un nouvel essai garde le MÊME identifiant et la saisie, sans doublon) ; l'heure
 *   murale du champ est convertie en UTC au fuseau du trip ;
 * - réponse du voyageur : `POST /trips/{id}/meetings/{meetingId}/answer` (`ACCEPT`, `DECLINE`).
 * Succès : retour à l'écran (`?mt=PROPOSED|ACCEPTED|DECLINED`) ; refus de la réponse :
 * `?me=<code>` (liste fermée). Chemin de retour reconstruit à partir de l'identifiant du trip et de
 * la portée, jamais lu tel quel (aucune redirection ouverte) ; jamais de lieu dans une URL.
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../account/api-client.ts';
import { messageKeyOf } from '../../../account/host-listings.ts';
import { clientContext } from '../../../account/request.ts';
import {
  ANSWER_ERRORS,
  localToUtc,
  MEETING_KINDS,
  meetingDoneOf,
  PLACE_MAX_CHARS,
} from '../../../account/trip-meetings.ts';
import { UUID, threadPath } from '../../../account/trip-messages.ts';
import type { FormErrors } from '../_account/errors.ts';
import { MEETING_FORM_ID, MEETING_PLACE_ID, MEETING_WHEN_ID } from './ids.ts';

export interface MeetingFormState {
  readonly errors: FormErrors;
  readonly place: string;
  readonly when: string;
  readonly kind: string;
}

const field = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.slice(0, max) : '';
};

export async function proposeMeetingAction(
  _prev: MeetingFormState,
  form: FormData,
): Promise<MeetingFormState> {
  const tripId = field(form, 'trip', 36);
  const id = field(form, 'id', 36);
  const zone = field(form, 'zone', 64);
  const kindValue = field(form, 'kind', 8);
  const kind = (MEETING_KINDS as readonly string[]).includes(kindValue) ? kindValue : 'PICKUP';
  const place = field(form, 'place', PLACE_MAX_CHARS * 2);
  const when = field(form, 'when', 16);
  const state = { place, when, kind };
  const back = threadPath('host', tripId);
  if (back === null || !UUID.test(id)) {
    return { ...state, errors: [{ fieldId: MEETING_FORM_ID, key: 'common.trips.notFound' }] };
  }
  if (place.trim() === '' || when === '') {
    const fieldId = place.trim() === '' ? MEETING_PLACE_ID : MEETING_WHEN_ID;
    return { ...state, errors: [{ fieldId, key: 'web.s16.meeting.form.required' }] };
  }
  const meetAt = localToUtc(when, zone);
  if (meetAt === null) {
    return { ...state, errors: [{ fieldId: MEETING_WHEN_ID, key: 'common.meetings.invalid' }] };
  }
  const reply = await callApi('POST', `/trips/${tripId}/meetings`, await clientContext(), {
    id,
    kind,
    place,
    meetAt,
  });
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (meetingDoneOf(reply) === null) {
    const key =
      reply.status === 'unavailable'
        ? 'common.messages.unavailable'
        : (messageKeyOf(reply) ?? 'common.messages.unavailable');
    const code = codeOf(reply);
    const fieldId =
      code === 'MEETING_PLACE_CONTACT'
        ? MEETING_PLACE_ID
        : code === 'MEETING_INVALID'
          ? MEETING_WHEN_ID
          : MEETING_FORM_ID;
    return { ...state, errors: [{ fieldId, key }] };
  }
  redirect(`${back}?mt=PROPOSED`);
}

export async function answerMeetingAction(form: FormData): Promise<void> {
  const tripId = field(form, 'trip', 36);
  const meetingId = field(form, 'meeting', 36);
  const decision = field(form, 'decision', 7) === 'DECLINE' ? 'DECLINE' : 'ACCEPT';
  const back = threadPath('guest', tripId);
  if (back === null || !UUID.test(meetingId)) redirect('/trips');
  const reply = await callApi(
    'POST',
    `/trips/${tripId}/meetings/${meetingId}/answer`,
    await clientContext(),
    { decision },
  );
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  const done = meetingDoneOf(reply);
  if (done !== null) redirect(`${back}?mt=${done}`);
  const code = codeOf(reply);
  const known = ANSWER_ERRORS.find((e) => e === code);
  redirect(`${back}?me=${known ?? 'MESSAGES_UNAVAILABLE'}`);
}
