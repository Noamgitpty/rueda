'use server';
/**
 * Actions serveur de la remise et du retour entre particuliers (US-315, ADR-183 ; 16 TRP-002,
 * VER-015, TRP-033 ; 10b UX-41, UX-42) :
 *   - `openHandoverAction` : « Ya llegué », ouverture de la remise (`POST …/checkin/open`) ;
 *   - `identityCheckAction` : contrôle du permis physique en 6 points par l'hôte, ou refus « No
 *     entregar el auto » avec son motif (`POST …/checkin/identity`) ;
 *   - `validateHandoverAction` : relevés (compteur, carburant) et validation de sa part
 *     (`POST …/{direction}/validate`, remise EN PERSONNE seulement).
 * Entrées revérifiées ici (identifiants, direction, entiers, cases) puis par l'API et la base.
 * Aucune heure n'est envoyée : l'heure serveur fait foi. Aucune file hors ligne au lot 3
 * (ADR-005, ADR-039) : sans réseau, rien n'est gardé et l'écran demande de réessayer. Aucune
 * donnée personnelle dans une URL ni dans un journal.
 */
import { redirect } from 'next/navigation';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../account/api-client.ts';
import type { ApiResult } from '../../../account/api-client.ts';
import { clientContext } from '../../../account/request.ts';
import {
  directionOf,
  handoverFailureKey,
  handoverHref,
  identityBody,
  intField,
  isFuel,
  isOdometer,
  refusalGuard,
  UUID,
} from '../../../account/trip-handover.ts';
import type { HandoverDirection } from '../../../account/trip-handover.ts';

export interface HandoverFormState {
  readonly key: MessageKey | null;
}

function failure(reply: ApiResult): HandoverFormState {
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  return { key: handoverFailureKey(reply) };
}

function fields(form: FormData) {
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === 'string' ? v.trim().slice(0, 40) : '';
  };
  const tripId = field('trip');
  const direction = directionOf(field('direction'));
  // US-703 : langue du rappel du consentement MIT affiché (S09)
  const locale = /^[a-z]{2}(-[A-Z]{2})?$/.test(field('locale')) ? field('locale') : null;
  return { field, tripId, direction, role: field('role'), org: field('org'), locale };
}

function back(role: string, tripId: string, direction: HandoverDirection, org: string): never {
  redirect(handoverHref(role, tripId, direction, org));
}

export async function openHandoverAction(
  _prev: HandoverFormState,
  form: FormData,
): Promise<HandoverFormState> {
  const f = fields(form);
  if (!UUID.test(f.tripId) || f.direction !== 'checkin') {
    return { key: 'common.handover.notFound' };
  }
  const reply = await callApi(
    'POST',
    `/trips/${f.tripId}/handover/checkin/open`,
    await clientContext(),
    {},
  );
  if (reply.status !== 200) return failure(reply);
  back(f.role, f.tripId, 'checkin', f.org);
}

export async function identityCheckAction(
  _prev: HandoverFormState,
  form: FormData,
): Promise<HandoverFormState> {
  const f = fields(form);
  if (!UUID.test(f.tripId) || f.direction !== 'checkin') {
    return { key: 'common.handover.notFound' };
  }
  const checked = new Set(form.getAll('check').filter((v): v is string => typeof v === 'string'));
  const refuse = f.field('intent') === 'refuse';
  const reason = f.field('subreason');
  // refus définitif (TRIP_ID_FAILED) : motif choisi et confirmation explicite exigés (revue ux n° 1)
  const guard = refusalGuard(refuse, reason, f.field('confirmFinal'));
  if (guard !== null) return { key: guard };
  const body = identityBody(checked, refuse ? reason || null : null);
  // « Confirmar » exige les six cases ; « No entregar » exige au moins une case manquante et un motif
  if (body === null) return { key: 'common.handover.licenseCheckIncomplete' };
  const reply = await callApi(
    'POST',
    `/trips/${f.tripId}/handover/checkin/identity`,
    await clientContext(),
    body,
  );
  if (reply.status !== 200) return failure(reply);
  back(f.role, f.tripId, 'checkin', f.org);
}

export async function validateHandoverAction(
  _prev: HandoverFormState,
  form: FormData,
): Promise<HandoverFormState> {
  const f = fields(form);
  if (!UUID.test(f.tripId) || f.direction === null) return { key: 'common.handover.notFound' };
  const odometerKm = intField(f.field('odometerKm'), isOdometer);
  const fuelEighths = intField(f.field('fuelEighths'), isFuel);
  if (odometerKm === null || fuelEighths === null) {
    return { key: 'common.handover.readingInvalid' };
  }
  const reply = await callApi(
    'POST',
    `/trips/${f.tripId}/handover/${f.direction}/validate`,
    await clientContext(),
    // remise en personne seulement : la remise sans rencontre n'est jamais proposée (OQ-P2P-05) ;
    // US-703 : au départ, le voyageur valide sous le rappel du consentement MIT (langue affichée)
    {
      odometerKm,
      fuelEighths,
      method: 'IN_PERSON',
      ...(f.role === 'GUEST' && f.direction === 'checkin' && f.locale !== null
        ? { locale: f.locale }
        : {}),
    },
  );
  if (reply.status !== 200) return failure(reply);
  back(f.role, f.tripId, f.direction, f.org);
}
