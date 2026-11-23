/**
 * US-318 — contrat des routes des sinistres entre particuliers d'un trip
 * (`POST /trips/{tripId}/incidents`, `GET /trips/{tripId}/claims`,
 * `POST /trips/{tripId}/traffic-charges`, `POST /trips/{tripId}/traffic-charges/preview`) sur l'application RÉELLE (ApiModule, gardes globaux,
 * durcissement HTTP ; harnais d'US-043) avec le FAKE du magasin : chaque réponse est confrontée à
 * `apps/api/openapi/openapi.json`, chaque statut déclaré est exercé.
 *
 * Attendus tirés de 19 US-318 et de 16 CLM-002, 08 BR-TT-02 à 04 et BR-PRICE-15, jamais du code
 * testé :
 * - accident déclaré par le voyageur depuis S17 : demande d'aide exigée, au moins une photo ;
 *   l'hôte, une autre personne, un trip inconnu ⇒ la même 404 ;
 * - amende, péage, fourrière : fin effective + 120 j acceptée, + 1 ms refusée (deadlineAt) ; fait
 *   hors du trip refusé ; pièce exigée, une par refacturation ; frais 5 % (USD 12,30 ⇒ 0,62) ;
 * - récapitulatif AVANT l'envoi (revue ux n° 1) : montants calculés par l'API (oracle
 *   `traffic_fee_oracle.py` : 1 230 ⇒ 62, total 1 292 ; 25 010 ⇒ 1 251, total 26 261), rien n'est
 *   écrit, l'identifiant de requête reste libre, mêmes refus que la déclaration ;
 * - corps strict (clé inconnue, identifiant, montant, nature) ⇒ 400 ; JSON exigé ⇒ 415 ; sans
 *   session ⇒ 401 ; aucun magasin ⇒ 503.
 * - suite (0181, ADR-201, red team F-L3-SIN-01 / 02) : référence du PV exigée et unique par trip
 *   (409 TRAFFIC_DUPLICATE, chargeId), plafond du pays (422 TRAFFIC_AMOUNT_ABOVE_CAP, capMinor) ;
 *   le voyageur lit ses refacturations, paie ou conteste avant l'échéance (08 BR-TT-02 : 48 h).
 * - suite 2 (0183, ADR-203, red team F-L3-SIN-03 / 04 / 05) : clé canonique du PV et unicité par
 *   compte d'hôte (409 TRAFFIC_DUPLICATE sur un autre trip du même hôte), plafond cumulé du trip
 *   (au-delà : enregistrée, `opsReviewRequired`, revue de l'ops avant tout débit).
 * Les règles de la base sont prouvées sur PostgreSQL (l0-us318-p2p-claims,
 * l0-us318s-traffic-response). Données fictives.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeContractApps,
  contract,
  coverageOf,
  startContractApp,
  textBody,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { FakeTripClaimsStore, fakeClaimsTrip } from './fake-trip-claims-store.js';

afterAll(closeContractApps);

const DAY = 86_400_000;
const START = new Date(Date.UTC(2031, 5, 11, 10, 0, 0));
const END = new Date(Date.UTC(2031, 5, 14, 10, 0, 0));
const DEADLINE = new Date(END.getTime() + 120 * DAY);

interface World {
  readonly app: ContractApp;
  readonly store: FakeTripClaimsStore;
  readonly trip: string;
}

async function world(): Promise<World> {
  const store = new FakeTripClaimsStore();
  const app = await startContractApp({ tripClaims: { store } });
  const trip = randomUUID();
  // voyageur = voyageur du trip ; staff_sans_mfa = titulaire du compte d'hôte ; staff = étranger
  store.trips.set(trip, fakeClaimsTrip(app.hash('staff_sans_mfa'), app.hash('voyageur'), START));
  return { app, store, trip };
}

const guest = (w: World) => w.app.cookie('voyageur');
const host = (w: World) => w.app.cookie('staff_sans_mfa');
const stranger = (w: World) => w.app.cookie('staff');
const code = (r: { json: unknown }) => (r.json as { code?: string }).code;
const incident = (w: World, who: Record<string, string>, body: unknown, trip = w.trip) =>
  w.app.api.request('POST', `/trips/${trip}/incidents`, { headers: who, body });
const charge = (w: World, who: Record<string, string>, body: unknown, trip = w.trip) =>
  w.app.api.request('POST', `/trips/${trip}/traffic-charges`, { headers: who, body });
const preview = (w: World, who: Record<string, string>, body: unknown, trip = w.trip) =>
  w.app.api.request('POST', `/trips/${trip}/traffic-charges/preview`, { headers: who, body });
const view = (w: World, who: Record<string, string>, trip = w.trip) =>
  w.app.api.request('GET', `/trips/${trip}/claims`, { headers: who });
const guestView = (w: World, who: Record<string, string>, trip = w.trip) =>
  w.app.api.request('GET', `/trips/${trip}/traffic-charges`, { headers: who });
const respond = (
  w: World,
  who: Record<string, string>,
  id: string,
  action: 'accept' | 'dispute',
  body: unknown,
  trip = w.trip,
) =>
  w.app.api.request('POST', `/trips/${trip}/traffic-charges/${id}/${action}`, {
    headers: who,
    body,
  });
const ref = (): string => `PV-${randomUUID().slice(0, 8)}`;
const HOUR = 3_600_000;
const REASON = 'Je ne conduisais pas sur cette route ce jour-là.';
const incidentBody = (caseId: string, requestId: string = randomUUID()) => ({
  requestId,
  caseId,
  thirdParty: true,
  policeReport: false,
});

describe('US-318 — routes des sinistres d’un trip (contrat OpenAPI)', () => {
  const apps: ContractApp[] = [];

  it('critère 2 : accident déclaré depuis S17 — demande d’aide exigée, photos exigées, heure serveur, rejeu ; trip terminé : refus', async () => {
    const w = await world();
    apps.push(w.app);
    const t = w.store.trips.get(w.trip)!;
    const at = new Date(START.getTime() + DAY);
    w.store.now = () => at;
    const caseId = randomUUID();
    const noCase = await incident(w, guest(w), incidentBody(caseId));
    expect(noCase.status).toBe(409);
    expect(noCase.json).toMatchObject({
      code: 'INCIDENT_CASE_REQUIRED',
      messageKey: 'common.tripClaims.incidentCaseRequired',
    });
    t.cases.add(caseId);
    const noPhoto = await incident(w, guest(w), incidentBody(caseId));
    expect(noPhoto.status).toBe(422);
    expect(code(noPhoto)).toBe('INCIDENT_PHOTOS_REQUIRED');
    t.incidentPhotos = 2;
    const req = randomUUID();
    const ok = await incident(w, guest(w), incidentBody(caseId, req));
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ reportedAt: at.toISOString(), photoCount: 2, replayed: false });
    const again = await incident(w, guest(w), incidentBody(caseId, req.toUpperCase()));
    expect(again.status).toBe(201);
    expect(again.json).toMatchObject({
      incidentId: (ok.json as { incidentId: string }).incidentId,
      replayed: true,
    });
    t.status = 'COMPLETED';
    const closed = await incident(w, guest(w), incidentBody(randomUUID()));
    expect(closed.status).toBe(409);
    expect(code(closed)).toBe('INCIDENT_NOT_OPEN');
  });

  it('critère 3 : amende — fin effective + 120 j acceptée, + 1 ms refusée ; fait hors du trip ; pièce exigée ; frais 5 % (1 230 unités mineures ⇒ 62) ; vue de l’hôte', async () => {
    const w = await world();
    apps.push(w.app);
    const t = w.store.trips.get(w.trip)!;
    const file = randomUUID();
    const file2 = randomUUID();
    t.evidence.set(file, { slot: 'DAMAGE_01', receivedAt: END });
    t.evidence.set(file2, { slot: 'DAMAGE_02', receivedAt: END });
    const body = (o: Record<string, unknown> = {}) => ({
      requestId: randomUUID(),
      kind: 'FINE',
      occurredAt: START.toISOString(),
      amountMinor: '1230',
      fileId: file,
      reference: ref(),
      ...o,
    });
    const notEnded = await charge(w, host(w), body());
    expect(notEnded.status).toBe(409);
    expect(code(notEnded)).toBe('TRAFFIC_TRIP_NOT_ENDED');
    t.status = 'COMPLETED';
    t.end = END;
    w.store.now = () => new Date(DEADLINE.getTime() + 1);
    const late = await charge(w, host(w), body());
    expect(late.status).toBe(422);
    expect(late.json).toEqual({
      code: 'TRAFFIC_CHARGE_DEADLINE_PASSED',
      messageKey: 'common.tripClaims.trafficDeadlinePassed',
      deadlineAt: DEADLINE.toISOString(),
    });
    w.store.now = () => DEADLINE;
    const before = await charge(
      w,
      host(w),
      body({ occurredAt: new Date(START.getTime() - 1).toISOString() }),
    );
    expect(before.status).toBe(422);
    expect(code(before)).toBe('TRAFFIC_OUTSIDE_TRIP');
    const noPiece = await charge(w, host(w), body({ fileId: randomUUID() }));
    expect(code(noPiece)).toBe('TRAFFIC_EVIDENCE_REQUIRED');
    const req = randomUUID();
    const ok = await charge(w, host(w), body({ requestId: req }));
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({
      amountMinor: '1230',
      adminFeeMinor: '62',
      totalMinor: '1292',
      deadlineAt: DEADLINE.toISOString(),
      replayed: false,
    });
    const again = await charge(w, host(w), body({ requestId: req }));
    expect(again.status).toBe(201);
    expect(again.json).toMatchObject({ replayed: true });
    expect(code(await charge(w, host(w), body({ kind: 'TOLL' })))).toBe(
      'TRAFFIC_EVIDENCE_REQUIRED',
    );
    expect((await charge(w, host(w), body({ kind: 'IMPOUND', fileId: file2 }))).status).toBe(201);
    t.theft = {
      status: 'THEFT_INVESTIGATION',
      openedAt: END,
      closedAt: null,
      insurerStatus: 'PENDING',
    };
    const v = await view(w, host(w));
    expect(v.status).toBe(200);
    expect(v.json).toMatchObject({
      open: true,
      deadlineAt: DEADLINE.toISOString(),
      feeBps: 500,
      theft: { status: 'THEFT_INVESTIGATION', insurerStatus: 'PENDING' },
    });
    expect((v.json as { charges: unknown[] }).charges).toHaveLength(2);
    // délai ou frais du pays absents : refus fail-closed
    t.feeBps = null;
    const terms = await charge(w, host(w), body({ fileId: randomUUID() }));
    expect(terms.status).toBe(503);
    expect(code(terms)).toBe('TRAFFIC_TERMS_UNKNOWN');
  });

  it('récapitulatif avant l’envoi (revue ux n° 1) : montants calculés par l’API, rien d’écrit, requestId libre, mêmes refus ; puis confirmation 201', async () => {
    const w = await world();
    apps.push(w.app);
    const t = w.store.trips.get(w.trip)!;
    const file = randomUUID();
    t.evidence.set(file, { slot: 'DAMAGE_01', receivedAt: END });
    const req = randomUUID();
    const body = (o: Record<string, unknown> = {}) => ({
      requestId: req,
      kind: 'TOLL',
      occurredAt: START.toISOString(),
      amountMinor: '1230',
      fileId: file,
      reference: ref(),
      ...o,
    });
    expect(code(await preview(w, host(w), body()))).toBe('TRAFFIC_TRIP_NOT_ENDED');
    t.status = 'COMPLETED';
    t.end = END;
    w.store.now = () => DEADLINE;
    const pb = body({ reference: 'PEAJE 2031/77' });
    const p = await preview(w, host(w), pb);
    expect(p.status).toBe(200);
    expect(p.json).toEqual({
      kind: 'TOLL',
      occurredAt: START.toISOString(),
      currency: 'XTA',
      feeBps: 500,
      amountMinor: '1230',
      adminFeeMinor: '62',
      totalMinor: '1292',
      deadlineAt: DEADLINE.toISOString(),
      reference: 'PEAJE 2031/77',
      responseHours: 48,
      capMinor: '100000',
      chargedBy: 'SEPARATE_CARD_CHARGE',
      opsReviewRequired: false,
    });
    const big = await preview(w, host(w), body({ amountMinor: '25010' }));
    expect(big.json).toMatchObject({ adminFeeMinor: '1251', totalMinor: '26261' });
    // rien n'est écrit ; le requestId n'est pas consommé par le récapitulatif
    expect(w.store.charges).toHaveLength(0);
    const confirmed = await charge(w, host(w), body());
    expect(confirmed.status).toBe(201);
    expect(confirmed.json).toMatchObject({
      adminFeeMinor: '62',
      totalMinor: '1292',
      replayed: false,
    });
    // mêmes refus que la déclaration
    expect(code(await preview(w, host(w), body({ requestId: randomUUID() })))).toBe(
      'TRAFFIC_EVIDENCE_REQUIRED',
    );
    const outside = await preview(
      w,
      host(w),
      body({ requestId: randomUUID(), occurredAt: new Date(END.getTime() + 1).toISOString() }),
    );
    expect(outside.status).toBe(422);
    expect(code(outside)).toBe('TRAFFIC_OUTSIDE_TRIP');
    w.store.now = () => new Date(DEADLINE.getTime() + 1);
    const late = await preview(w, host(w), body({ requestId: randomUUID() }));
    expect(late.status).toBe(422);
    expect(late.json).toMatchObject({
      code: 'TRAFFIC_CHARGE_DEADLINE_PASSED',
      deadlineAt: DEADLINE.toISOString(),
    });
    w.store.now = () => DEADLINE;
    t.feeBps = null;
    const terms = await preview(w, host(w), body({ requestId: randomUUID() }));
    expect(terms.status).toBe(503);
    expect(code(terms)).toBe('TRAFFIC_TERMS_UNKNOWN');
    // corps strict, IDOR, session, JSON
    expect(code(await preview(w, host(w), { ...body(), amountMinor: 12.3 }))).toBe(
      'REQUEST_INVALID',
    );
    for (const [who, trip] of [
      [guest(w), w.trip],
      [stranger(w), w.trip],
      [host(w), 'not-a-uuid'],
    ] as const) {
      const r = await preview(w, who, body(), trip);
      expect(r.status).toBe(404);
      expect(code(r)).toBe('TRIP_CLAIM_NOT_FOUND');
    }
    expect(
      (
        await w.app.api.request('POST', `/trips/${w.trip}/traffic-charges/preview`, {
          body: body(),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await w.app.api.request(
          'POST',
          `/trips/${w.trip}/traffic-charges/preview`,
          textBody(host(w)),
        )
      ).status,
    ).toBe(415);
    const none = await startContractApp();
    apps.push(none);
    const x = await none.api.request('POST', `/trips/${w.trip}/traffic-charges/preview`, {
      headers: none.cookie('staff_sans_mfa'),
      body: body(),
    });
    expect(x.status).toBe(503);
    expect(code(x)).toBe('TRIP_CLAIM_UNAVAILABLE');
  });

  it('corps strict (400), JSON exigé (415), IDOR 404 (même réponse), sans session 401, base injoignable 503', async () => {
    const w = await world();
    apps.push(w.app);
    const t = w.store.trips.get(w.trip)!;
    t.status = 'COMPLETED';
    t.end = END;
    w.store.now = () => END;
    const good = {
      requestId: randomUUID(),
      kind: 'TOLL',
      occurredAt: START.toISOString(),
      amountMinor: '100',
      fileId: randomUUID(),
      reference: ref(),
    };
    for (const bad of [
      {},
      { ...good, extra: 1 },
      { ...good, requestId: 'x' },
      { ...good, fileId: 'x' },
      { ...good, amountMinor: '0' },
      { ...good, amountMinor: 100 },
      { ...good, amountMinor: '-5' },
      { ...good, kind: 'PARKING' },
      { ...good, occurredAt: 'hier' },
      { ...good, adminFeeMinor: '5' },
      { ...good, reference: 'ana@correo.com' },
      { ...good, reference: 42 },
      { ...good, reference: 'P-1' },
    ]) {
      const r = await charge(w, host(w), bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(code(r)).toBe('REQUEST_INVALID');
    }
    for (const bad of [
      {},
      { ...incidentBody(randomUUID()), at: START.toISOString() },
      { ...incidentBody(randomUUID()), caseId: 'x' },
      { ...incidentBody(randomUUID()), thirdParty: 'oui' },
    ]) {
      const r = await incident(w, guest(w), bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    // requestId déjà pris par une autre personne ⇒ 400
    const id = randomUUID();
    t.cases.add(id);
    t.incidentPhotos = 1;
    t.status = 'IN_PROGRESS';
    expect((await incident(w, guest(w), incidentBody(id, id))).status).toBe(201);
    t.cases.add(randomUUID());
    expect(code(await incident(w, guest(w), incidentBody(randomUUID(), id)))).toBe(
      'REQUEST_INVALID',
    );
    for (const route of ['incidents', 'traffic-charges']) {
      expect(
        (await w.app.api.request('POST', `/trips/${w.trip}/${route}`, textBody(host(w)))).status,
      ).toBe(415);
    }
    // IDOR : l'hôte ne déclare pas d'incident, le voyageur ne lit ni ne déclare les refacturations
    const cases: [string, Record<string, string>, string][] = [
      ['incidents', host(w), w.trip],
      ['incidents', stranger(w), w.trip],
      ['incidents', guest(w), randomUUID()],
      ['incidents', guest(w), 'not-a-uuid'],
      ['traffic-charges', guest(w), w.trip],
      ['traffic-charges', stranger(w), w.trip],
      ['traffic-charges', host(w), 'not-a-uuid'],
    ];
    for (const [route, who, trip] of cases) {
      const r =
        route === 'incidents'
          ? await incident(w, who, incidentBody(randomUUID()), trip)
          : await charge(w, who, good, trip);
      expect(r.status, `${route} ${trip}`).toBe(404);
      expect(r.json).toMatchObject({
        code: 'TRIP_CLAIM_NOT_FOUND',
        messageKey: 'common.tripClaims.notFound',
      });
    }
    for (const [who, trip] of [
      [guest(w), w.trip],
      [stranger(w), w.trip],
      [host(w), randomUUID()],
      [host(w), 'not-a-uuid'],
    ] as const) {
      const r = await view(w, who, trip);
      expect(r.status).toBe(404);
      expect(code(r)).toBe('TRIP_CLAIM_NOT_FOUND');
    }
    expect((await w.app.api.request('GET', `/trips/${w.trip}/claims`)).status).toBe(401);
    expect(
      (await w.app.api.request('POST', `/trips/${w.trip}/incidents`, { body: incidentBody(id) }))
        .status,
    ).toBe(401);
    expect(
      (await w.app.api.request('POST', `/trips/${w.trip}/traffic-charges`, { body: good })).status,
    ).toBe(401);
    const none = await startContractApp();
    apps.push(none);
    for (const [method, path, json] of [
      ['GET', `/trips/${w.trip}/claims`, undefined],
      ['POST', `/trips/${w.trip}/incidents`, incidentBody(randomUUID())],
      ['POST', `/trips/${w.trip}/traffic-charges`, good],
    ] as const) {
      const x = await none.api.request(method, path, {
        headers: none.cookie('voyageur'),
        ...(json !== undefined ? { body: json } : {}),
      });
      expect(x.status, path).toBe(503);
      expect(x.json).toMatchObject({
        code: 'TRIP_CLAIM_UNAVAILABLE',
        messageKey: 'common.tripClaims.unavailable',
      });
    }
  });

  it('suite (0181) : référence exigée et unique par trip (409 TRAFFIC_DUPLICATE même avec une autre saisie, heure + 1 s, autre nature), plafond (422 TRAFFIC_AMOUNT_ABOVE_CAP) ; le voyageur lit, paie ou conteste avant l’échéance (48 h) ; IDOR, 401, 415, 503', async () => {
    const w = await world();
    apps.push(w.app);
    const t = w.store.trips.get(w.trip)!;
    t.status = 'COMPLETED';
    t.end = END;
    const at = new Date(END.getTime() + HOUR);
    w.store.now = () => at;
    const files = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, f] of files.entries()) {
      t.evidence.set(f, { slot: `DAMAGE_0${i + 1}`, receivedAt: END });
    }
    const body = (o: Record<string, unknown> = {}) => ({
      requestId: randomUUID(),
      kind: 'FINE',
      occurredAt: START.toISOString(),
      amountMinor: '1230',
      fileId: files[0],
      reference: 'PV 2031-0042',
      ...o,
    });
    const noRef: Record<string, unknown> = { ...body() };
    delete noRef['reference'];
    for (const b of [noRef, body({ reference: '   ' })]) {
      for (const call of [charge, preview]) {
        const r = await call(w, host(w), b);
        expect(r.status).toBe(422);
        expect(r.json).toMatchObject({
          code: 'TRAFFIC_REFERENCE_REQUIRED',
          messageKey: 'common.tripClaims.trafficReferenceRequired',
        });
      }
    }
    const above = await charge(w, host(w), body({ amountMinor: '100001' }));
    expect(above.status).toBe(422);
    expect(above.json).toEqual({
      code: 'TRAFFIC_AMOUNT_ABOVE_CAP',
      messageKey: 'common.tripClaims.trafficAmountAboveCap',
      capMinor: '100000',
    });
    const ok = await charge(w, host(w), body());
    expect(ok.status).toBe(201);
    const first = (ok.json as { chargeId: string; responseDueAt: string }).chargeId;
    expect(ok.json).toMatchObject({
      responseDueAt: new Date(at.getTime() + 48 * HOUR).toISOString(),
    });
    for (const b of [
      body({ fileId: files[1], reference: 'pv-2031/0042' }),
      body({ fileId: files[1], occurredAt: new Date(START.getTime() + 1000).toISOString() }),
      body({ fileId: files[1], kind: 'TOLL', amountMinor: '1231' }),
    ]) {
      for (const call of [charge, preview]) {
        const r = await call(w, host(w), b);
        expect(r.status).toBe(409);
        expect(r.json).toEqual({
          code: 'TRAFFIC_DUPLICATE',
          messageKey: 'common.tripClaims.trafficDuplicate',
          chargeId: first,
        });
      }
    }
    const second = await charge(w, host(w), body({ fileId: files[1], reference: 'PEAJE-77' }));
    expect(second.status).toBe(201);
    const other = (second.json as { chargeId: string }).chargeId;
    // vue de l'hôte : référence, échéance et réponse du voyageur
    const hv = await view(w, host(w));
    expect(hv.json).toMatchObject({ responseHours: 48, capMinor: '100000' });
    expect((hv.json as { charges: unknown[] }).charges).toContainEqual(
      expect.objectContaining({
        id: first,
        reference: 'PV 2031-0042',
        guestStatus: 'AWAITING_GUEST',
      }),
    );
    // vue du voyageur
    const gv = await guestView(w, guest(w));
    expect(gv.status).toBe(200);
    expect((gv.json as { charges: unknown[] }).charges).toContainEqual(
      expect.objectContaining({ id: first, totalMinor: '1292', canRespond: true }),
    );
    for (const [who, trip] of [
      [host(w), w.trip],
      [stranger(w), w.trip],
      [guest(w), randomUUID()],
      [guest(w), 'not-a-uuid'],
    ] as const) {
      const r = await guestView(w, who, trip);
      expect(r.status).toBe(404);
      expect(code(r)).toBe('TRIP_CLAIM_NOT_FOUND');
    }
    // paiement et contestation
    const paid = await respond(w, guest(w), first, 'accept', {});
    expect(paid.status).toBe(200);
    expect(paid.json).toEqual({ chargeId: first, status: 'ACCEPTED', replayed: false });
    expect((await respond(w, guest(w), first, 'accept', {})).json).toMatchObject({
      replayed: true,
    });
    const notOpen = await respond(w, guest(w), first, 'dispute', { reason: REASON });
    expect(notOpen.status).toBe(409);
    expect(code(notOpen)).toBe('TRAFFIC_NOT_OPEN');
    const short = await respond(w, guest(w), other, 'dispute', { reason: 'trop court' });
    expect(short.status).toBe(422);
    expect(short.json).toMatchObject({
      code: 'INCIDENTAL_DISPUTE_REASON_REQUIRED',
      messageKey: 'common.incidental.disputeReasonRequired',
    });
    const foreign = await respond(w, guest(w), other, 'dispute', {
      reason: REASON,
      evidence: [randomUUID()],
    });
    expect(foreign.status).toBe(422);
    expect(code(foreign)).toBe('CLAIM_EVIDENCE_MISSING');
    for (const bad of [
      { reason: REASON, extra: 1 },
      { reason: 5 },
      { reason: REASON, evidence: ['x'] },
    ]) {
      const r = await respond(w, guest(w), other, 'dispute', bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(code(r)).toBe('REQUEST_INVALID');
    }
    expect((await respond(w, guest(w), other, 'accept', { x: 1 })).status).toBe(400);
    const disputed = await respond(w, guest(w), other, 'dispute', { reason: REASON });
    expect(disputed.status).toBe(200);
    expect(disputed.json).toEqual({ chargeId: other, status: 'DISPUTED', replayed: false });
    // fenêtre close à l'échéance, jamais rouverte
    const third = await charge(w, host(w), body({ fileId: files[2], reference: 'GRUA-9' }));
    const late = (third.json as { chargeId: string }).chargeId;
    w.store.now = () => new Date(at.getTime() + 48 * HOUR);
    for (const [action, b] of [
      ['accept', {}],
      ['dispute', { reason: REASON }],
    ] as const) {
      const r = await respond(w, guest(w), late, action, b);
      expect(r.status).toBe(409);
      expect(r.json).toMatchObject({
        code: 'GUEST_RESPONSE_WINDOW_CLOSED',
        messageKey: 'common.incidental.responseWindowClosed',
      });
    }
    // IDOR : l'hôte, un tiers, un identifiant inconnu ou mal formé ⇒ la même 404
    for (const action of ['accept', 'dispute'] as const) {
      const b = action === 'accept' ? {} : { reason: REASON };
      for (const [who, id, trip] of [
        [host(w), late, w.trip],
        [stranger(w), late, w.trip],
        [guest(w), randomUUID(), w.trip],
        [guest(w), 'not-a-uuid', w.trip],
        [guest(w), late, 'not-a-uuid'],
      ] as const) {
        const r = await respond(w, who, id, action, b, trip);
        expect(r.status, `${action} ${id}`).toBe(404);
        expect(code(r)).toBe('TRIP_CLAIM_NOT_FOUND');
      }
      const path = `/trips/${w.trip}/traffic-charges/${late}/${action}`;
      expect((await w.app.api.request('POST', path, { body: b })).status).toBe(401);
      expect((await w.app.api.request('POST', path, textBody(guest(w)))).status).toBe(415);
    }
    expect((await w.app.api.request('GET', `/trips/${w.trip}/traffic-charges`)).status).toBe(401);
    const none = await startContractApp();
    apps.push(none);
    for (const [method, path, json] of [
      ['GET', `/trips/${w.trip}/traffic-charges`, undefined],
      ['POST', `/trips/${w.trip}/traffic-charges/${late}/accept`, {}],
      ['POST', `/trips/${w.trip}/traffic-charges/${late}/dispute`, { reason: REASON }],
    ] as const) {
      const x = await none.api.request(method, path, {
        headers: none.cookie('voyageur'),
        ...(json !== undefined ? { body: json } : {}),
      });
      expect(x.status, path).toBe(503);
      expect(code(x)).toBe('TRIP_CLAIM_UNAVAILABLE');
    }
  });

  it('suite 2 (0183) : le même PV écrit autrement (zéros de tête, O pour 0) ou déclaré sur un autre trip du même hôte ⇒ 409 TRAFFIC_DUPLICATE ; somme du trip au-delà du plafond cumulé ⇒ enregistrée avec opsReviewRequired (revue de l’ops avant tout débit), annoncée au récapitulatif', async () => {
    const w = await world();
    apps.push(w.app);
    const t = w.store.trips.get(w.trip)!;
    const otherTrip = randomUUID();
    w.store.trips.set(
      otherTrip,
      fakeClaimsTrip(w.app.hash('staff_sans_mfa'), w.app.hash('voyageur'), START),
    );
    const o = w.store.trips.get(otherTrip)!;
    const at = new Date(END.getTime() + HOUR);
    w.store.now = () => at;
    const files = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const trip of [t, o]) {
      trip.status = 'COMPLETED';
      trip.end = END;
    }
    for (const [i, f] of files.entries()) {
      (i === 3 ? o : t).evidence.set(f, { slot: `DAMAGE_0${i + 1}`, receivedAt: END });
    }
    const body = (x: Record<string, unknown>) => ({
      requestId: randomUUID(),
      kind: 'FINE',
      occurredAt: START.toISOString(),
      amountMinor: '60000',
      ...x,
    });
    const first = await charge(w, host(w), body({ fileId: files[0], reference: 'PV 100200' }));
    expect(first.status).toBe(201);
    const id = (first.json as { chargeId: string }).chargeId;
    for (const [trip, file, reference] of [
      [w.trip, files[1], 'PV 1OO2OO'],
      [w.trip, files[1], 'pv-000100200'],
      [otherTrip, files[3], 'PV 100200'],
    ] as const) {
      const r = await charge(w, host(w), body({ fileId: file, reference }), trip);
      expect(r.status, reference).toBe(409);
      expect(r.json).toEqual({
        code: 'TRAFFIC_DUPLICATE',
        messageKey: 'common.tripClaims.trafficDuplicate',
        chargeId: id,
      });
    }
    const pre = await preview(w, host(w), body({ fileId: files[1], reference: 'PEAJE-78' }));
    expect(pre.status).toBe(200);
    expect(pre.json).toMatchObject({ opsReviewRequired: true, capMinor: '100000' });
    const within = await preview(
      w,
      host(w),
      body({ fileId: files[1], reference: 'PEAJE-78', amountMinor: '40000' }),
    );
    expect(within.json).toMatchObject({ opsReviewRequired: false });
    expect(first.json).toMatchObject({ opsReviewRequired: false });
    const over = await charge(w, host(w), body({ fileId: files[1], reference: 'PEAJE-78' }));
    expect(over.status).toBe(201);
    expect(over.json).toMatchObject({ opsReviewRequired: true, replayed: false });
    const after = await charge(
      w,
      host(w),
      body({ fileId: files[2], reference: 'PEAJE-79', amountMinor: '1' }),
    );
    expect(after.status).toBe(201);
    expect(after.json).toMatchObject({ opsReviewRequired: true });
  });

  it('couverture : chaque statut déclaré pour les routes du voyageur (refacturations) est exercé', () => {
    for (const path of [
      '/trips/{tripId}/traffic-charges/{chargeId}/accept',
      '/trips/{tripId}/traffic-charges/{chargeId}/dispute',
    ]) {
      expect(missingCoverage(contract, path, coverageOf(...apps)), path).toEqual([]);
    }
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/incidents est exercé', () => {
    expect(missingCoverage(contract, '/trips/{tripId}/incidents', coverageOf(...apps))).toEqual([]);
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/claims est exercé', () => {
    expect(missingCoverage(contract, '/trips/{tripId}/claims', coverageOf(...apps))).toEqual([]);
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/traffic-charges/preview est exercé', () => {
    expect(
      missingCoverage(contract, '/trips/{tripId}/traffic-charges/preview', coverageOf(...apps)),
    ).toEqual([]);
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/traffic-charges est exercé', () => {
    expect(
      missingCoverage(contract, '/trips/{tripId}/traffic-charges', coverageOf(...apps)),
    ).toEqual([]);
  });
});
