/**
 * US-318 — lecture défensive des réponses des sinistres d'un trip (incident, refacturation, vue de
 * l'hôte) et angle libre suivant. Attendus : contrat des routes de 0178 / ADR-198 (montants en
 * chaînes d'unités mineures, heures ISO), jamais le code testé.
 */
import { describe, expect, it } from 'vitest';
import type { ApiResult } from './api-client.ts';
import {
  feePercentText,
  incidentReportedOf,
  nextFreeSlot,
  trafficDeclaredOf,
  tripClaimsOf,
} from './trip-claims.ts';

const TRIP = '3180a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b';
const ID = '3180a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5c';
const ok = (json: unknown, status = 200): ApiResult => ({ status, json }) as ApiResult;

const view = (extra: Record<string, unknown> = {}) => ({
  tripId: TRIP,
  country: 'XA',
  currency: 'XTS',
  open: true,
  tripStartAt: '2057-04-07T10:00:00.000Z',
  tripEndAt: '2057-04-10T10:00:00.000Z',
  deadlineAt: '2057-08-08T10:00:00.000Z',
  feeBps: 500,
  theft: null,
  charges: [
    {
      id: ID,
      kind: 'FINE',
      occurredAt: '2057-04-08T10:00:00.000Z',
      amountMinor: '1230',
      adminFeeMinor: '62',
      totalMinor: '1292',
      declaredAt: '2057-04-11T10:00:00.000Z',
      status: 'PENDING',
    },
  ],
  evidence: [{ fileId: ID, slot: 'DAMAGE_01', receivedAt: '2057-04-10T11:00:00.000Z', used: true }],
  ...extra,
});

describe('US-318 — sinistres du trip côté site', () => {
  it('angle libre suivant : DAMAGE_01 à DAMAGE_10 dans l’ordre, null quand la série est pleine', () => {
    expect(nextFreeSlot([])).toBe('DAMAGE_01');
    expect(nextFreeSlot(['DAMAGE_01', 'DAMAGE_03'])).toBe('DAMAGE_02');
    expect(
      nextFreeSlot(
        Array.from({ length: 10 }, (_, i) => `DAMAGE_${String(i + 1).padStart(2, '0')}`),
      ),
    ).toBeNull();
  });

  it('incident ouvert : 201 lisible ; autre statut, aucune photo ou forme inattendue ⇒ null', () => {
    const body = { incidentId: ID, reportedAt: '2057-04-08T11:00:00.000Z', photoCount: 2 };
    expect(incidentReportedOf(ok(body, 201))).toEqual(body);
    expect(incidentReportedOf(ok(body, 200))).toBeNull();
    expect(incidentReportedOf(ok({ ...body, photoCount: 0 }, 201))).toBeNull();
    expect(incidentReportedOf(ok({ ...body, incidentId: 'x' }, 201))).toBeNull();
  });

  it('refacturation : montants en chaînes d’entiers seulement (jamais un nombre JSON)', () => {
    const body = {
      chargeId: ID,
      amountMinor: '1230',
      adminFeeMinor: '62',
      totalMinor: '1292',
      deadlineAt: '2057-08-08T10:00:00.000Z',
    };
    expect(trafficDeclaredOf(ok(body, 201))).toEqual(body);
    expect(trafficDeclaredOf(ok({ ...body, totalMinor: 1292 }, 201))).toBeNull();
    expect(trafficDeclaredOf(ok({ ...body, adminFeeMinor: '6.2' }, 201))).toBeNull();
  });

  it('vue de l’hôte : lue en entier ; trip, pièce ou état inattendus ⇒ null (jamais une vue partielle)', () => {
    const v = tripClaimsOf(ok(view()), TRIP);
    expect(v?.charges[0]?.totalMinor).toBe('1292');
    expect(v?.evidence[0]?.used).toBe(true);
    expect(v?.theft).toBeNull();
    const theft = tripClaimsOf(
      ok(
        view({
          theft: {
            status: 'THEFT_INVESTIGATION',
            openedAt: '2057-04-11T11:00:00.000Z',
            closedAt: null,
            insurerStatus: 'PENDING',
          },
        }),
      ),
      TRIP,
    );
    expect(theft?.theft?.insurerStatus).toBe('PENDING');
    expect(tripClaimsOf(ok(view()), ID)).toBeNull();
    expect(
      tripClaimsOf(
        ok(
          view({
            evidence: [
              { fileId: ID, slot: 'EXT_01', receivedAt: '2057-04-10T11:00:00.000Z', used: false },
            ],
          }),
        ),
        TRIP,
      ),
    ).toBeNull();
    expect(
      tripClaimsOf(
        ok(
          view({
            theft: { status: 'LOST', openedAt: 'x', closedAt: null, insurerStatus: 'PENDING' },
          }),
        ),
        TRIP,
      ),
    ).toBeNull();
    expect(tripClaimsOf(ok(view(), 404), TRIP)).toBeNull();
  });

  it('pourcentage des frais pour l’affichage, dans la langue de la vue', () => {
    expect(feePercentText(500, 'es')).toBe('5');
    expect(feePercentText(250, 'fr')).toBe('2,5');
  });
});
