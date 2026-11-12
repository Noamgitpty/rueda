/**
 * Lecture défensive des réponses des pièces et de l'éligibilité du véhicule (US-124) : une réponse
 * mal formée est refusée entière (`null`), jamais lue à moitié ; un motif inconnu n'est jamais
 * affiché brut (message générique). Attendus : 16 HST-019 / HST-039 (types, statuts), ADR-107.
 */
import { describe, expect, it } from 'vitest';
import type { ApiResult } from './api-client.ts';
import { claimsOf, eligibilityOf, reasonKey, reasonsOf } from './vehicle-documents.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const reply = (status: number, json: unknown): ApiResult => ({ status, json }) as ApiResult;

const vehicle = {
  vehicleId: ID,
  eligibilityStatus: 'PENDING',
  titleHolder: 'THIRD_PARTY',
  lienDeclared: true,
  odometerKm: 42000,
  ownershipAttested: false,
  lienAttested: true,
  hasVin: true,
  reasons: ['VEHICLE_TITLE_MISMATCH'],
  released: false,
  publishable: false,
  underReview: false,
  submittedAt: null,
  checkedAt: null,
  requiredDocuments: ['TITLE', 'OWNER_AUTHORIZATION'],
  documents: [
    {
      documentId: ID,
      type: 'TITLE',
      status: 'REJECTED',
      validUntil: '2030-01-31',
      rejectReason: 'ILLEGIBLE',
      mime: 'application/pdf',
      bytes: 10,
      createdAt: '2031-07-01T08:00:00.000Z',
    },
  ],
};

describe('éligibilité du véhicule (US-124)', () => {
  it('réponse attendue : statut, motifs, pièces exigées et déposées, dépôt annoncé', () => {
    const r = eligibilityOf(
      reply(200, { vehicles: [vehicle], documentUploads: { open: false, maxBytes: 75_000 } }),
    );
    expect(r).toEqual({
      vehicles: [
        {
          vehicleId: ID,
          status: 'PENDING',
          titleHolder: 'THIRD_PARTY',
          lienDeclared: true,
          odometerKm: 42000,
          ownershipAttested: false,
          lienAttested: true,
          hasVin: true,
          reasons: ['VEHICLE_TITLE_MISMATCH'],
          released: false,
          publishable: false,
          underReview: false,
          requiredDocuments: ['TITLE', 'OWNER_AUTHORIZATION'],
          documents: [
            {
              documentId: ID,
              type: 'TITLE',
              status: 'REJECTED',
              validUntil: '2030-01-31',
              rejectReason: 'ILLEGIBLE',
            },
          ],
        },
      ],
      uploads: { open: false, maxBytes: 75_000 },
    });
  });

  it('réponse mal formée : refusée entière', () => {
    const up = { open: true, maxBytes: 1 };
    for (const bad of [
      { ...vehicle, eligibilityStatus: 'MAYBE' },
      { ...vehicle, titleHolder: 'NEIGHBOUR' },
      { ...vehicle, reasons: ['pas un code'] },
      { ...vehicle, requiredDocuments: ['SELFIE'] },
      { ...vehicle, documents: [{ ...vehicle.documents[0], rejectReason: 'BECAUSE' }] },
      { ...vehicle, documents: [{ ...vehicle.documents[0], type: 'PASSPORT' }] },
      { ...vehicle, vehicleId: 'x' },
    ]) {
      expect(eligibilityOf(reply(200, { vehicles: [bad], documentUploads: up }))).toBeNull();
    }
    expect(eligibilityOf(reply(200, { vehicles: [vehicle] }))).toBeNull();
    expect(eligibilityOf(reply(503, {}))).toBeNull();
  });

  it('motif inconnu : message générique, jamais le code brut', () => {
    expect(reasonKey('VEHICLE_VIN_MISMATCH')).toBe('web.vehicleDocs.reason.VEHICLE_VIN_MISMATCH');
    expect(reasonKey('PARAM_MISSING')).toBe('web.vehicleDocs.reason.other');
  });

  it('motifs d’un refus et contestations', () => {
    expect(reasonsOf(reply(422, { reasons: ['VEHICLE_TOO_OLD', 42, 'bad code'] }))).toEqual([
      'VEHICLE_TOO_OLD',
    ]);
    expect(reasonsOf({ status: 'unavailable' } as ApiResult)).toEqual([]);
    expect(
      claimsOf(reply(200, { claims: [{ claimId: ID, plate: 'AB123', status: 'OPEN' }] })),
    ).toEqual([{ claimId: ID, plate: 'AB123', status: 'OPEN' }]);
    expect(
      claimsOf(reply(200, { claims: [{ claimId: ID, plate: 'AB123', status: 'WON' }] })),
    ).toBeNull();
  });
});
