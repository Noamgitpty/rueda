/**
 * Lecture défensive de la remise et du retour (US-315) : une réponse bien formée donne la vue ;
 * toute forme inattendue ⇒ `null` (jamais une étape partielle) ; gardes des relevés et du
 * contrôle du permis ; sans réseau, la clé « réessayer » (aucune file hors ligne au lot 3,
 * L3-PM-14). Attendus : contrat de `GET /trips/{id}/handover/{direction}`, 16 TRP-002, VER-015
 * (6 points), 17 §3.2.10 (carburant en huitièmes), jamais le code testé.
 */
import { describe, expect, it } from 'vitest';
import {
  handoverFailureKey,
  handoverHref,
  identityBody,
  refusalGuard,
  intField,
  isFuel,
  isOdometer,
  photosHref,
  tripHandoverOf,
} from './trip-handover.ts';

const TRIP = '00000000-0000-4000-8000-000000000315';
const ORG = '00000000-0000-4000-8000-0000000003a1';
const reply = (over: Record<string, unknown> = {}) => ({
  status: 200 as const,
  json: {
    tripId: TRIP,
    direction: 'checkin',
    viewerRole: 'HOST',
    tripStatus: 'BOOKED',
    timezone: 'UTC',
    opensAt: '2036-12-09T15:00:00.000Z',
    open: false,
    canOpen: false,
    blockers: ['CHECKIN_PAYMENT_NOT_CONFIRMED', 'CONTRACT_NOT_SIGNED'],
    identityCheck: { status: 'PENDING', checkedAt: null },
    guest: { firstName: 'Ana', lastInitial: 'P', birthYear: 1990 },
    photos: { mine: 'NONE', other: 'DRAFT' },
    validations: { mine: null, other: null },
    contactlessOffered: false,
    completedAt: null,
    ...over,
  },
  session: null,
});

describe('lecture de la remise (US-315)', () => {
  it('réponse bien formée (hôte, départ) : blocages dans l’ordre, données minimales du voyageur', () => {
    const v = tripHandoverOf(reply());
    expect(v).not.toBeNull();
    expect(v?.blockers).toEqual(['CHECKIN_PAYMENT_NOT_CONFIRMED', 'CONTRACT_NOT_SIGNED']);
    expect(v?.guest).toEqual({ firstName: 'Ana', lastInitial: 'P', birthYear: 1990 });
    expect(v?.identityCheck).toEqual({ status: 'PENDING', checkedAt: null });
    expect(v?.contactlessOffered).toBe(false);
  });

  it('retour terminé : validations des deux parties et fin effective (heure serveur)', () => {
    const v = tripHandoverOf(
      reply({
        direction: 'checkout',
        viewerRole: 'GUEST',
        tripStatus: 'RETURNED',
        opensAt: null,
        blockers: [],
        identityCheck: null,
        guest: null,
        photos: { mine: 'SUBMITTED', other: 'SUBMITTED' },
        validations: {
          mine: { validatedAt: '2036-12-13T10:20:00.000Z', odometerKm: 41250, fuelEighths: 8 },
          other: { validatedAt: '2036-12-13T10:19:00.000Z', odometerKm: 41250, fuelEighths: 7 },
        },
        completedAt: '2036-12-13T10:20:00.000Z',
      }),
    );
    expect(v?.completedAt).toBe('2036-12-13T10:20:00.000Z');
    expect(v?.validations.mine?.odometerKm).toBe(41250);
  });

  it.each([
    ['blocage inconnu', { blockers: ['SOMETHING_ELSE'] }],
    ['direction inconnue', { direction: 'arrival' }],
    ['rôle inconnu', { viewerRole: 'OPS' }],
    [
      'carburant hors bornes',
      {
        validations: {
          mine: null,
          other: { validatedAt: '2036-12-13T10:19:00.000Z', odometerKm: 1, fuelEighths: 9 },
        },
      },
    ],
    [
      'compteur négatif',
      {
        validations: {
          mine: { validatedAt: '2036-12-13T10:19:00.000Z', odometerKm: -1, fuelEighths: 4 },
          other: null,
        },
      },
    ],
    ['heure illisible', { completedAt: 'hier' }],
    ['statut de série inconnu', { photos: { mine: 'VALIDATED', other: 'NONE' } }],
    ['données du voyageur servies au voyageur', { viewerRole: 'GUEST' }],
    ['données du voyageur au retour', { direction: 'checkout', identityCheck: null, blockers: [] }],
    [
      'initiale de plusieurs lettres',
      { guest: { firstName: 'Ana', lastInitial: 'Pé', birthYear: 1990 } },
    ],
    ['contrôle du permis inconnu', { identityCheck: { status: 'MAYBE', checkedAt: null } }],
  ])('forme inattendue (%s) ⇒ null', (_name, over) => {
    expect(tripHandoverOf(reply(over))).toBeNull();
  });

  it('réponse autre que 200, ou réseau absent ⇒ null', () => {
    expect(
      tripHandoverOf({ status: 404, json: { code: 'HANDOVER_NOT_FOUND' }, session: null }),
    ).toBeNull();
    expect(tripHandoverOf({ status: 'unavailable' })).toBeNull();
  });
});

describe('gardes des saisies (US-315)', () => {
  it('compteur : entier de 0 à 9 999 999 ; carburant : entier de 0 à 8', () => {
    expect(isOdometer(0)).toBe(true);
    expect(isOdometer(9_999_999)).toBe(true);
    expect(isOdometer(10_000_000)).toBe(false);
    expect(isOdometer(1.5)).toBe(false);
    expect(isFuel(8)).toBe(true);
    expect(isFuel(9)).toBe(false);
    expect(intField('41250', isOdometer)).toBe(41250);
    expect(intField('4 1250', isOdometer)).toBeNull();
    expect(intField('-1', isOdometer)).toBeNull();
    expect(intField('', isFuel)).toBeNull();
    expect(intField('9', isFuel)).toBeNull();
  });

  it('permis : les 6 points confirment sans motif ; un point manquant exige un motif de la liste', () => {
    const all = new Set(['face', 'name', 'birthYear', 'valid', 'provisional', 'restrictions']);
    expect(identityBody(all, null)).toEqual({
      checklist: {
        face: true,
        name: true,
        birthYear: true,
        valid: true,
        provisional: true,
        restrictions: true,
      },
    });
    // confirmation incomplète, ou motif envoyé avec les 6 points : refus côté site
    expect(identityBody(new Set(['face']), null)).toBeNull();
    expect(identityBody(all, 'INVALID_LICENSE')).toBeNull();
    expect(identityBody(new Set(['face']), 'NOT_A_REASON')).toBeNull();
    const refusal = identityBody(new Set(['face', 'name']), 'OTHER_DRIVER_SENT');
    expect(refusal?.subreason).toBe('OTHER_DRIVER_SENT');
    expect(refusal?.checklist.valid).toBe(false);
  });

  it('sans réseau : « réessayer » (aucune file hors ligne) ; clé inconnue ⇒ erreur générique', () => {
    expect(handoverFailureKey({ status: 'unavailable' })).toBe('common.handover.unavailable');
    expect(
      handoverFailureKey({
        status: 409,
        json: { code: 'CONTRACT_NOT_SIGNED', messageKey: 'common.handover.contractNotSigned' },
        session: null,
      }),
    ).toBe('common.handover.contractNotSigned');
    expect(handoverFailureKey({ status: 500, json: { messageKey: 'x.y' }, session: null })).toBe(
      'common.error.server',
    );
  });

  it('liens reconstruits : organisation seulement si c’est un identifiant', () => {
    expect(handoverHref('HOST', TRIP, 'checkin', ORG)).toBe(
      `/host/trips/${TRIP}/handover/checkin?org=${ORG}`,
    );
    expect(handoverHref('HOST', TRIP, 'checkout', 'evil')).toBe(
      `/host/trips/${TRIP}/handover/checkout`,
    );
    expect(handoverHref('GUEST', TRIP, 'checkin', ORG)).toBe(`/trips/${TRIP}/handover/checkin`);
    expect(photosHref('GUEST', TRIP, 'checkout', null)).toBe(`/trips/${TRIP}/inspection/checkout`);
  });
});

describe('refus définitif « No entregar el auto » (revue ux n° 1)', () => {
  it('exige un motif choisi puis une confirmation explicite ; « Confirmar » n’est pas concerné', () => {
    expect(refusalGuard(true, '', 'yes')).toBe('web.handover.refuse.reasonRequired');
    expect(refusalGuard(true, 'INVALID_LICENSE', '')).toBe('web.handover.refuse.confirmRequired');
    expect(refusalGuard(true, 'INVALID_LICENSE', 'on')).toBe('web.handover.refuse.confirmRequired');
    expect(refusalGuard(true, 'OTHER_DRIVER_SENT', 'yes')).toBeNull();
    expect(refusalGuard(false, '', '')).toBeNull();
  });
});
