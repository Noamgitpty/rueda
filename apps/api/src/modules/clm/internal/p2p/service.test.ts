/**
 * US-318 — lecture stricte des corps et de la vue des sinistres d'un trip, traduction des issues de
 * la base (ADR-198). Les règles elles-mêmes sont prouvées sur PostgreSQL (l0-us318-p2p-claims).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TRIP_CLAIM_MESSAGES, TripClaimHttpError, tripClaimOutcomeCode } from './errors.js';
import {
  parseIncidentRequest,
  parseTrafficChargeRequest,
  parseTripClaimsView,
  TripClaimsService,
} from './service.js';
import { TripClaimStoreError, UnavailableTripClaimsStore } from './store.js';
import type { TripClaimsStore } from './store.js';

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof TripClaimHttpError ? e.code : 'OTHER';
  }
};

const ID = randomUUID();
const ISO = '2031-06-11T10:00:00.000Z';

describe('US-318 — corps des routes', () => {
  it('incident : clés exactes, identifiants et booléens', () => {
    const ok = { requestId: ID.toUpperCase(), caseId: ID, thirdParty: true, policeReport: false };
    expect(parseIncidentRequest(ok)).toEqual({
      requestId: ID,
      caseId: ID,
      thirdParty: true,
      policeReport: false,
    });
    for (const bad of [
      {},
      { ...ok, at: ISO },
      { ...ok, caseId: 'x' },
      { ...ok, thirdParty: 1 },
      { requestId: ID, caseId: ID, thirdParty: true },
    ]) {
      expect(
        codeOf(() => parseIncidentRequest(bad)),
        JSON.stringify(bad),
      ).toBe('REQUEST_INVALID');
    }
  });

  it('refacturation : nature fermée, montant texte d’entier > 0 (13 chiffres au plus), heure ISO avec fuseau', () => {
    const ok = {
      requestId: ID,
      kind: 'IMPOUND',
      occurredAt: '2031-06-11T07:00:00-03:00',
      amountMinor: '25010',
      fileId: ID,
    };
    const r = parseTrafficChargeRequest(ok);
    expect(r.kind).toBe('IMPOUND');
    expect(r.amountMinor).toBe(25010n);
    expect(r.occurredAt.toISOString()).toBe(ISO);
    for (const bad of [
      { ...ok, kind: 'PARKING' },
      { ...ok, amountMinor: '0' },
      { ...ok, amountMinor: '012' },
      { ...ok, amountMinor: '12.30' },
      { ...ok, amountMinor: 1230 },
      { ...ok, amountMinor: '12345678901234' },
      { ...ok, occurredAt: '2031-06-11' },
      { ...ok, occurredAt: '2031-06-11T10:00:00' },
      { ...ok, fileId: 'x' },
      { ...ok, adminFeeMinor: '1' },
    ]) {
      expect(
        codeOf(() => parseTrafficChargeRequest(bad)),
        JSON.stringify(bad),
      ).toBe('REQUEST_INVALID');
    }
  });
});

describe('US-318 — issues de la base', () => {
  it('chaque issue connue a son code ; paramètre absent ⇒ TRAFFIC_TERMS_UNKNOWN ; inconnue ⇒ 503', () => {
    expect(tripClaimOutcomeCode('NOT_FOUND')).toBe('TRIP_CLAIM_NOT_FOUND');
    expect(tripClaimOutcomeCode('TRAFFIC_WINDOW_UNKNOWN')).toBe('TRAFFIC_TERMS_UNKNOWN');
    expect(tripClaimOutcomeCode('TRAFFIC_FEE_UNKNOWN')).toBe('TRAFFIC_TERMS_UNKNOWN');
    for (const o of [
      'INCIDENT_NOT_OPEN',
      'INCIDENT_CASE_REQUIRED',
      'INCIDENT_PHOTOS_REQUIRED',
      'TRAFFIC_TRIP_NOT_ENDED',
      'TRAFFIC_CHARGE_DEADLINE_PASSED',
      'TRAFFIC_OUTSIDE_TRIP',
      'TRAFFIC_EVIDENCE_REQUIRED',
    ]) {
      expect(tripClaimOutcomeCode(o)).toBe(o);
      expect(TRIP_CLAIM_MESSAGES[tripClaimOutcomeCode(o)].messageKey).toMatch(
        /^common\.tripClaims\./,
      );
    }
    expect(tripClaimOutcomeCode('SURPRISE')).toBe('TRIP_CLAIM_UNAVAILABLE');
  });

  it('magasin indisponible ⇒ 503 ; 22023 (requestId repris) ⇒ 400', async () => {
    const down = new TripClaimsService(new UnavailableTripClaimsStore());
    await expect(down.view(Buffer.alloc(32), ID)).rejects.toMatchObject({
      code: 'TRIP_CLAIM_UNAVAILABLE',
    });
    const taken: TripClaimsStore = {
      reportIncident: () => Promise.reject(new TripClaimStoreError('x', '22023')),
      declareTrafficCharge: () => Promise.reject(new TripClaimStoreError('x', '40001')),
      hostClaims: () => Promise.resolve(null),
    };
    const s = new TripClaimsService(taken);
    await expect(
      s.reportIncident(Buffer.alloc(32), ID, {
        requestId: ID,
        caseId: ID,
        thirdParty: false,
        policeReport: false,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_INVALID' });
    await expect(
      s.declareTrafficCharge(Buffer.alloc(32), ID, {
        requestId: ID,
        kind: 'TOLL',
        occurredAt: ISO,
        amountMinor: '100',
        fileId: ID,
      }),
    ).rejects.toMatchObject({ code: 'TRIP_CLAIM_UNAVAILABLE' });
    await expect(s.view(Buffer.alloc(32), ID)).rejects.toMatchObject({
      code: 'TRIP_CLAIM_NOT_FOUND',
    });
  });

  it('refacturation refusée hors délai : deadlineAt rendu ; acceptée : montants de la base', async () => {
    const store = (outcome: string, body: Record<string, unknown> | null): TripClaimsStore => ({
      reportIncident: () => Promise.reject(new Error('non')),
      declareTrafficCharge: () =>
        Promise.resolve({ outcome, chargeId: outcome === 'DECLARED' ? ID : null, body }),
      hostClaims: () => Promise.resolve(null),
    });
    const input = {
      requestId: ID,
      kind: 'FINE',
      occurredAt: ISO,
      amountMinor: '1230',
      fileId: ID,
    };
    await expect(
      new TripClaimsService(
        store('TRAFFIC_CHARGE_DEADLINE_PASSED', { deadlineAt: '2031-10-12T10:00:00.000Z' }),
      ).declareTrafficCharge(Buffer.alloc(32), ID, input),
    ).rejects.toMatchObject({
      code: 'TRAFFIC_CHARGE_DEADLINE_PASSED',
      response: expect.objectContaining({ deadlineAt: '2031-10-12T10:00:00.000Z' }),
    });
    const ok = await new TripClaimsService(
      store('DECLARED', {
        amountMinor: '1230',
        adminFeeMinor: '62',
        totalMinor: '1292',
        deadlineAt: '2031-10-12T10:00:00.000Z',
      }),
    ).declareTrafficCharge(Buffer.alloc(32), ID, input);
    expect(ok).toEqual({
      chargeId: ID,
      amountMinor: '1230',
      adminFeeMinor: '62',
      totalMinor: '1292',
      deadlineAt: '2031-10-12T10:00:00.000Z',
      replayed: false,
    });
    // montant illisible : jamais servi
    await expect(
      new TripClaimsService(
        store('DECLARED', { amountMinor: 1230, deadlineAt: '2031-10-12T10:00:00.000Z' }),
      ).declareTrafficCharge(Buffer.alloc(32), ID, input),
    ).rejects.toMatchObject({ code: 'TRIP_CLAIM_UNAVAILABLE' });
  });
});

describe('US-318 — vue des sinistres du trip (lecture stricte)', () => {
  const view = {
    tripId: ID,
    country: 'XA',
    currency: 'XTA',
    open: true,
    tripStartAt: ISO,
    tripEndAt: ISO,
    deadlineAt: ISO,
    feeBps: 500,
    theft: {
      status: 'THEFT_INVESTIGATION',
      openedAt: ISO,
      closedAt: null,
      insurerStatus: 'PENDING',
    },
    charges: [
      {
        id: ID,
        kind: 'TOLL',
        occurredAt: ISO,
        amountMinor: '100',
        adminFeeMinor: '5',
        totalMinor: '105',
        declaredAt: ISO,
        status: 'PENDING',
      },
    ],
    evidence: [{ fileId: ID, slot: 'DAMAGE_01', receivedAt: ISO, used: true }],
  };

  it('forme attendue : relue telle quelle', () => {
    expect(parseTripClaimsView(view)).toEqual(view);
  });

  it('toute forme inattendue ⇒ erreur (jamais une vue partielle)', () => {
    for (const bad of [
      { ...view, tripId: 'x' },
      { ...view, feeBps: -1 },
      { ...view, theft: { ...view.theft, status: 'STOLEN' } },
      { ...view, charges: [{ ...view.charges[0], amountMinor: 100 }] },
      { ...view, charges: [{ ...view.charges[0], status: 'PAID' }] },
      { ...view, evidence: [{ ...view.evidence[0], slot: 'EXT_01' }] },
      { ...view, tripStartAt: 'hier' },
      { ...view, charges: null },
    ]) {
      expect(() => parseTripClaimsView(bad as never), JSON.stringify(bad)).toThrow(
        TripClaimStoreError,
      );
    }
  });
});
