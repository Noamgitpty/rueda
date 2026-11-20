'use server';
/**
 * Action serveur de l'avis d'un trip (S13 voyageur, A12 hôte ; US-317, ADR-190) :
 * `POST /trips/{id}/reviews` avec la note globale, les sous-notes choisies et le texte. La partie
 * est celle de la session, jugée par la base (voyageur ou titulaire du compte d'hôte) ; la fenêtre,
 * le texte exigé de 1 à 3 et le masquage des coordonnées sont jugés par la base. Succès : retour à
 * l'écran (`?rv=SUBMITTED|PUBLISHED`) ; refus : erreur du formulaire, saisie gardée. Chemin de
 * retour reconstruit à partir de l'identifiant du trip et de la portée, jamais lu tel quel (aucune
 * redirection ouverte) ; jamais une note ni un texte dans une URL.
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../account/api-client.ts';
import { messageKeyOf } from '../../../account/host-listings.ts';
import { clientContext } from '../../../account/request.ts';
import {
  GUEST_SCORE_KEYS,
  HOST_SCORE_KEYS,
  REVIEW_TEXT_MAX_CHARS,
  REVIEW_TEXT_MIN_CHARS_LOW_RATING,
  REVIEW_TEXT_OPTIONAL_FROM,
  reviewDoneOf,
  reviewPath,
} from '../../../account/trip-reviews.ts';
import type { ScoreKey } from '../../../account/trip-reviews.ts';
import { UUID } from '../../../account/trip-messages.ts';
import type { FormErrors } from '../_account/errors.ts';
import { REVIEW_FORM_ID, REVIEW_OVERALL_ID, REVIEW_TEXT_ID } from './ids.ts';

export interface ReviewFormState {
  readonly errors: FormErrors;
  readonly overall: string;
  readonly text: string;
  readonly scores: Readonly<Partial<Record<ScoreKey, string>>>;
}

const field = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.slice(0, max) : '';
};

export async function submitReviewAction(
  _prev: ReviewFormState,
  form: FormData,
): Promise<ReviewFormState> {
  const tripId = field(form, 'trip', 36);
  const scope = field(form, 'scope', 5) === 'host' ? 'host' : 'guest';
  const orgValue = field(form, 'org', 36);
  const org = UUID.test(orgValue) ? orgValue : null;
  const overallValue = field(form, 'overall', 1);
  const text = field(form, 'text', REVIEW_TEXT_MAX_CHARS * 2);
  const keys = scope === 'guest' ? GUEST_SCORE_KEYS : HOST_SCORE_KEYS;
  const scores: Partial<Record<ScoreKey, string>> = {};
  const subScores: Partial<Record<ScoreKey, number>> = {};
  for (const k of keys) {
    const v = field(form, `score-${k}`, 1);
    if (/^[1-5]$/.test(v)) {
      scores[k] = v;
      subScores[k] = Number(v);
    }
  }
  const state = { overall: overallValue, text, scores };
  const self = reviewPath(scope, tripId);
  if (self === null) {
    return { ...state, errors: [{ fieldId: REVIEW_FORM_ID, key: 'common.trips.notFound' }] };
  }
  if (!/^[1-5]$/.test(overallValue)) {
    return { ...state, errors: [{ fieldId: REVIEW_OVERALL_ID, key: 'common.reviews.invalid' }] };
  }
  const overall = Number(overallValue);
  // même règle que la base (BR-REVIEW-04), jugée d'abord ici pour garder la saisie
  if (
    overall < REVIEW_TEXT_OPTIONAL_FROM &&
    [...text.trim()].length < REVIEW_TEXT_MIN_CHARS_LOW_RATING
  ) {
    return { ...state, errors: [{ fieldId: REVIEW_TEXT_ID, key: 'common.reviews.textRequired' }] };
  }
  const reply = await callApi('POST', `/trips/${tripId}/reviews`, await clientContext(), {
    overall,
    subScores,
    text: text.trim() === '' ? null : text,
  });
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  const done = reviewDoneOf(reply);
  if (done === null) {
    const key =
      reply.status === 'unavailable'
        ? 'common.reviews.unavailable'
        : (messageKeyOf(reply) ?? 'common.reviews.unavailable');
    const code = codeOf(reply);
    const fieldId =
      code === 'REVIEW_TEXT_REQUIRED'
        ? REVIEW_TEXT_ID
        : code === 'REVIEW_INVALID'
          ? REVIEW_OVERALL_ID
          : REVIEW_FORM_ID;
    return { ...state, errors: [{ fieldId, key }] };
  }
  const query = new URLSearchParams({ rv: done });
  if (scope === 'host' && org !== null) query.set('org', org);
  redirect(`${self}?${query.toString()}`);
}
