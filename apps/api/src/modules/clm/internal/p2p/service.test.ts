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
  parseTrafficDisputeRequest,
  parseTrafficGuestView,
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
      reference: '  PV 2031/0042 ',
    };
    const r = parseTrafficChargeRequest(ok);
    expect(r.reference).toBe('PV 2031/0042');
    // référence absente ou vide : refus explicite (0181, F-L3-SIN-01)
    const noRef: Record<string, unknown> = { ...ok };
    delete noRef['reference'];
    for (const b of [noRef, { ...ok, reference: '  ' }]) {
      expect(codeOf(() => parseTrafficChargeRequest(b))).toBe('TRAFFIC_REFERENCE_REQUIRED');
    }
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
      { ...ok, reference: 'ana@correo.com' },
      { ...ok, reference: 'P-1' },
      { ...ok, reference: 'PV#12' },
      { ...ok, reference: 12345 },
      { ...ok, reference: `PV${'9'.repeat(40)}` },
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
    expect(tripClaimOutcomeCode('TRAFFIC_RESPONSE_WINDOW_UNKNOWN')).toBe('TRAFFIC_TERMS_UNKNOWN');
    expect(tripClaimOutcomeCode('TRAFFIC_CAP_UNKNOWN')).toBe('TRAFFIC_TERMS_UNKNOWN');
    for (const o of [
      'GUEST_RESPONSE_WINDOW_CLOSED',
      'INCIDENTAL_DISPUTE_REASON_REQUIRED',
      'CLAIM_EVIDENCE_MISSING',
    ]) {
      expect(tripClaimOutcomeCode(o)).toBe(o);
      expect(TRIP_CLAIM_MESSAGES[tripClaimOutcomeCode(o)].messageKey).toMatch(
        /^common\.incidental\./,
      );
    }
    for (const o of [
      'INCIDENT_NOT_OPEN',
      'INCIDENT_CASE_REQUIRED',
      'INCIDENT_PHOTOS_REQUIRED',
      'TRAFFIC_TRIP_NOT_ENDED',
      'TRAFFIC_CHARGE_DEADLINE_PASSED',
      'TRAFFIC_OUTSIDE_TRIP',
      'TRAFFIC_EVIDENCE_REQUIRED',
      'TRAFFIC_REFERENCE_REQUIRED',
      'TRAFFIC_DUPLICATE',
      'TRAFFIC_AMOUNT_ABOVE_CAP',
      'TRAFFIC_NOT_OPEN',
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
      guestCharges: () => Promise.resolve(null),
      acceptTrafficCharge: () => Promise.resolve('NOT_FOUND'),
      disputeTrafficCharge: () => Promise.resolve('NOT_FOUND'),
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
        reference: 'PV-100',
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
      guestCharges: () => Promise.resolve(null),
      acceptTrafficCharge: () => Promise.resolve('NOT_FOUND'),
      disputeTrafficCharge: () => Promise.resolve('NOT_FOUND'),
    });
    const input = {
      requestId: ID,
      kind: 'FINE',
      occurredAt: ISO,
      amountMinor: '1230',
      fileId: ID,
      reference: 'PV-1230',
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
        responseDueAt: '2031-06-16T10:00:00.000Z',
      }),
    ).declareTrafficCharge(Buffer.alloc(32), ID, input);
    expect(ok).toEqual({
      chargeId: ID,
      amountMinor: '1230',
      adminFeeMinor: '62',
      totalMinor: '1292',
      deadlineAt: '2031-10-12T10:00:00.000Z',
      responseDueAt: '2031-06-16T10:00:00.000Z',
      replayed: false,
      opsReviewRequired: false,
    });
    // doublon et plafond : identifiant existant et plafond rendus (0181)
    await expect(
      new TripClaimsService(store('TRAFFIC_DUPLICATE', { chargeId: ID })).declareTrafficCharge(
        Buffer.alloc(32),
        ID,
        input,
      ),
    ).rejects.toMatchObject({
      code: 'TRAFFIC_DUPLICATE',
      response: expect.objectContaining({ chargeId: ID }),
    });
    await expect(
      new TripClaimsService(
        store('TRAFFIC_AMOUNT_ABOVE_CAP', { capMinor: '100000', currency: 'XTA' }),
      ).declareTrafficCharge(Buffer.alloc(32), ID, input),
    ).rejects.toMatchObject({
      code: 'TRAFFIC_AMOUNT_ABOVE_CAP',
      response: expect.objectContaining({ capMinor: '100000' }),
    });
    // montant illisible : jamais servi
    await expect(
      new TripClaimsService(
        store('DECLARED', { amountMinor: 1230, deadlineAt: '2031-10-12T10:00:00.000Z' }),
      ).declareTrafficCharge(Buffer.alloc(32), ID, input),
    ).rejects.toMatchObject({ code: 'TRIP_CLAIM_UNAVAILABLE' });
  });

  it('récapitulatif (revue ux n° 1) : appel en mode aperçu, montants de la base servis tels quels ; issue autre que PREVIEW ⇒ refus traduit ; forme inattendue ⇒ 503', async () => {
    const seen: boolean[] = [];
    const store = (outcome: string, body: Record<string, unknown> | null): TripClaimsStore => ({
      reportIncident: () => Promise.reject(new Error('non')),
      declareTrafficCharge: (_p, _t, _i, preview) => {
        seen.push(preview);
        return Promise.resolve({ outcome, chargeId: null, body });
      },
      hostClaims: () => Promise.resolve(null),
      guestCharges: () => Promise.resolve(null),
      acceptTrafficCharge: () => Promise.resolve('NOT_FOUND'),
      disputeTrafficCharge: () => Promise.resolve('NOT_FOUND'),
    });
    const input = {
      requestId: ID,
      kind: 'TOLL',
      occurredAt: ISO,
      amountMinor: '25010',
      fileId: ID,
      reference: 'PEAJE-25010',
    };
    const body = {
      amountMinor: '25010',
      adminFeeMinor: '1251',
      totalMinor: '26261',
      currency: 'XTB',
      feeBps: 500,
      deadlineAt: '2031-10-12T10:00:00.000Z',
      reference: 'PEAJE-25010',
      responseHours: 48,
      capMinor: '7500000',
    };
    const ok = await new TripClaimsService(store('PREVIEW', body)).previewTrafficCharge(
      Buffer.alloc(32),
      ID,
      input,
    );
    expect(seen).toEqual([true]);
    expect(ok).toEqual({
      kind: 'TOLL',
      occurredAt: ISO,
      currency: 'XTB',
      feeBps: 500,
      amountMinor: '25010',
      adminFeeMinor: '1251',
      totalMinor: '26261',
      deadlineAt: '2031-10-12T10:00:00.000Z',
      reference: 'PEAJE-25010',
      responseHours: 48,
      capMinor: '7500000',
      chargedBy: 'SEPARATE_CARD_CHARGE',
      opsReviewRequired: false,
    });
    // la déclaration elle-même n'est jamais un aperçu
    const declared = new TripClaimsService(
      store('DECLARED', { ...body, deadlineAt: '2031-10-12T10:00:00.000Z' }),
    );
    await declared.declareTrafficCharge(Buffer.alloc(32), ID, input).catch(() => undefined);
    expect(seen.at(-1)).toBe(false);
    await expect(
      new TripClaimsService(store('TRAFFIC_OUTSIDE_TRIP', null)).previewTrafficCharge(
        Buffer.alloc(32),
        ID,
        input,
      ),
    ).rejects.toMatchObject({ code: 'TRAFFIC_OUTSIDE_TRIP' });
    await expect(
      new TripClaimsService(
        store('TRAFFIC_CHARGE_DEADLINE_PASSED', { deadlineAt: '2031-10-12T10:00:00.000Z' }),
      ).previewTrafficCharge(Buffer.alloc(32), ID, input),
    ).rejects.toMatchObject({
      code: 'TRAFFIC_CHARGE_DEADLINE_PASSED',
      response: expect.objectContaining({ deadlineAt: '2031-10-12T10:00:00.000Z' }),
    });
    // une déclaration enregistrée à la place d'un aperçu : jamais servie comme récapitulatif
    await expect(
      new TripClaimsService(store('DECLARED', body)).previewTrafficCharge(
        Buffer.alloc(32),
        ID,
        input,
      ),
    ).rejects.toMatchObject({ code: 'TRIP_CLAIM_UNAVAILABLE' });
    for (const bad of [
      { ...body, totalMinor: 26261 },
      { ...body, currency: 'xtb' },
      { ...body, feeBps: '500' },
      { ...body, deadlineAt: null },
      { ...body, responseHours: 0 },
      { ...body, capMinor: 7500000 },
    ]) {
      await expect(
        new TripClaimsService(store('PREVIEW', bad)).previewTrafficCharge(
          Buffer.alloc(32),
          ID,
          input,
        ),
      ).rejects.toMatchObject({ code: 'TRIP_CLAIM_UNAVAILABLE' });
    }
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
    responseHours: 48,
    capMinor: '100000',
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
        reference: 'PV-100',
        responseDueAt: ISO,
        guestStatus: 'DISPUTED',
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
      { ...view, responseHours: 0 },
      { ...view, capMinor: 100000 },
      { ...view, charges: [{ ...view.charges[0], guestStatus: 'PAID' }] },
      { ...view, charges: [{ ...view.charges[0], reference: 'a@b.c' }] },
    ]) {
      expect(() => parseTripClaimsView(bad as never), JSON.stringify(bad)).toThrow(
        TripClaimStoreError,
      );
    }
  });
});

describe('US-318 suite — refacturations du voyageur (lecture stricte, réponses)', () => {
  const gv = {
    tripId: ID,
    currency: 'XTA',
    charges: [
      {
        id: ID,
        kind: 'FINE',
        occurredAt: ISO,
        reference: 'PV-100',
        amountMinor: '100',
        adminFeeMinor: '5',
        totalMinor: '105',
        declaredAt: ISO,
        responseDueAt: ISO,
        status: 'AWAITING_GUEST',
        executionStatus: 'PENDING',
        canRespond: true,
        disputeReason: null,
        decidedAt: null,
        decisionRationale: null,
      },
    ],
    photos: [{ fileId: ID, kind: 'CHECKOUT', slot: 'INT_02', takenBy: 'GUEST', receivedAt: ISO }],
  };

  it('forme attendue relue telle quelle ; toute autre forme ⇒ erreur', () => {
    expect(parseTrafficGuestView(gv)).toEqual(gv);
    for (const bad of [
      { ...gv, currency: 'x' },
      { ...gv, photos: null },
      { ...gv, charges: [{ ...gv.charges[0], canRespond: 'oui' }] },
      { ...gv, charges: [{ ...gv.charges[0], status: 'PAID' }] },
      { ...gv, charges: [{ ...gv.charges[0], reference: null }] },
      { ...gv, photos: [{ ...gv.photos[0], takenBy: 'STAFF' }] },
    ]) {
      expect(() => parseTrafficGuestView(bad as never), JSON.stringify(bad)).toThrow(
        TripClaimStoreError,
      );
    }
  });

  it('contestation : motif texte (1 000 au plus), pièces : identifiants (10 au plus), clés fermées', () => {
    expect(parseTrafficDisputeRequest({ reason: 'x', evidence: [ID.toUpperCase()] })).toEqual({
      reason: 'x',
      evidence: [ID],
    });
    expect(parseTrafficDisputeRequest({ reason: 'x' })).toEqual({ reason: 'x', evidence: [] });
    for (const bad of [
      {},
      { reason: 5 },
      { reason: 'x'.repeat(1001) },
      { reason: 'x', evidence: 'y' },
      { reason: 'x', evidence: ['y'] },
      { reason: 'x', evidence: Array.from({ length: 11 }, () => ID) },
      { reason: 'x', at: ISO },
    ]) {
      expect(
        codeOf(() => parseTrafficDisputeRequest(bad)),
        JSON.stringify(bad),
      ).toBe('REQUEST_INVALID');
    }
  });

  it('issues des commandes du voyageur traduites ; rejeu signalé ; vue absente ⇒ 404', async () => {
    const store = (r: string): TripClaimsStore => ({
      reportIncident: () => Promise.reject(new Error('non')),
      declareTrafficCharge: () => Promise.reject(new Error('non')),
      hostClaims: () => Promise.resolve(null),
      guestCharges: () => Promise.resolve(null),
      acceptTrafficCharge: () => Promise.resolve(r),
      disputeTrafficCharge: () => Promise.resolve(r),
    });
    const p = Buffer.alloc(32);
    expect(await new TripClaimsService(store('ACCEPTED')).acceptTrafficCharge(p, ID, {})).toEqual({
      chargeId: ID,
      status: 'ACCEPTED',
      replayed: false,
    });
    expect(
      await new TripClaimsService(store('ALREADY_DISPUTED')).disputeTrafficCharge(p, ID, {
        reason: 'motif',
      }),
    ).toEqual({ chargeId: ID, status: 'DISPUTED', replayed: true });
    for (const [r, code] of [
      ['NOT_FOUND', 'TRIP_CLAIM_NOT_FOUND'],
      ['TRAFFIC_NOT_OPEN', 'TRAFFIC_NOT_OPEN'],
      ['GUEST_RESPONSE_WINDOW_CLOSED', 'GUEST_RESPONSE_WINDOW_CLOSED'],
      ['SURPRISE', 'TRIP_CLAIM_UNAVAILABLE'],
    ] as const) {
      await expect(
        new TripClaimsService(store(r)).acceptTrafficCharge(p, ID, {}),
      ).rejects.toMatchObject({ code });
    }
    await expect(
      new TripClaimsService(store('ACCEPTED')).acceptTrafficCharge(p, ID, { x: 1 }),
    ).rejects.toMatchObject({ code: 'REQUEST_INVALID' });
    await expect(new TripClaimsService(store('X')).guestCharges(p, ID)).rejects.toMatchObject({
      code: 'TRIP_CLAIM_NOT_FOUND',
    });
  });
});
