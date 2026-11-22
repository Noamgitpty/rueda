/**
 * US-307 — contrat des routes du no-show (`GET` / `POST /trips/{tripId}/no-show`) sur l'application
 * RÉELLE (ApiModule, gardes globaux, durcissement HTTP ; harnais d'US-043) avec le FAKE du magasin :
 * chaque réponse est confrontée à `apps/api/openapi/openapi.json`, chaque statut déclaré est
 * exercé.
 *
 * Attendus tirés de 19 US-307 et de 16 TRP-015, jamais du code testé :
 * - l'hôte déclare le voyageur absent, le voyageur signale l'hôte absent : la partie absente est
 *   déduite de la session, jamais reçue ;
 * - T+50 min (grâce 60) ⇒ 409 NO_SHOW_TOO_EARLY ; après 72 h ⇒ NO_SHOW_WINDOW_CLOSED ;
 * - no-show de l'hôte sans preuve tracée ⇒ NO_SHOW_EVIDENCE_REQUIRED ; partie présente ⇒
 *   NO_SHOW_PARTY_PRESENT ; demande vivante ⇒ CANCELLATION_PENDING ;
 * - aucune déclaration ne se rejoue : même requestId ⇒ la même demande ; un requestId déjà pris
 *   par une autre personne ⇒ 400 ; une heure envoyée par le client ⇒ 400 ;
 * - IDOR : toute autre personne, trip inconnu, identifiant mal formé ⇒ la même 404 ;
 * - base injoignable ⇒ 503 NO_SHOW_UNAVAILABLE.
 * Les règles de la base sont prouvées sur PostgreSQL (l0-us307-no-show). Données fictives.
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
import { FakeNoShowStore, fakeNoShowTrip } from './fake-no-show-store.js';

afterAll(closeContractApps);

const MINUTE = 60_000;

interface World {
  readonly app: ContractApp;
  readonly store: FakeNoShowStore;
  readonly trip: string;
  readonly start: Date;
}

async function world(): Promise<World> {
  const store = new FakeNoShowStore();
  const app = await startContractApp({ trp: { noShow: store } });
  const trip = randomUUID();
  const start = new Date(Date.UTC(2031, 5, 11, 10, 0, 0));
  // voyageur = voyageur du trip ; staff_sans_mfa = titulaire du compte d'hôte ; staff = étranger
  store.trips.set(trip, fakeNoShowTrip(app.hash('staff_sans_mfa'), app.hash('voyageur'), start));
  return { app, store, trip, start };
}

const guest = (w: World) => w.app.cookie('voyageur');
const host = (w: World) => w.app.cookie('staff_sans_mfa');
const stranger = (w: World) => w.app.cookie('staff');
const at = (w: World, minutes: number) => {
  w.store.now = () => new Date(w.start.getTime() + minutes * MINUTE);
};
const report = (w: World, who: Record<string, string>, body: unknown) =>
  w.app.api.request('POST', `/trips/${w.trip}/no-show`, { headers: who, body });
const view = (w: World, who: Record<string, string>) =>
  w.app.api.request('GET', `/trips/${w.trip}/no-show`, { headers: who });

describe('US-307 — routes du no-show (contrat OpenAPI)', () => {
  const apps: ContractApp[] = [];

  it('critère 1 : T+50 min (grâce 60) ⇒ NO_SHOW_TOO_EARLY ; T+60 ⇒ demande PENDING de GUEST_NO_SHOW ; la vue le dit', async () => {
    const w = await world();
    apps.push(w.app);
    at(w, 50);
    const early = await view(w, host(w));
    expect(early.status).toBe(200);
    expect(early.json).toMatchObject({
      viewerRole: 'HOST',
      absentParty: 'GUEST',
      canDeclare: false,
      blocker: 'NO_SHOW_TOO_EARLY',
      declarableFrom: new Date(w.start.getTime() + 60 * MINUTE).toISOString(),
      declarableUntil: new Date(w.start.getTime() + 72 * 60 * MINUTE).toISOString(),
      declaration: null,
    });
    const refused = await report(w, host(w), { requestId: randomUUID() });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({
      code: 'NO_SHOW_TOO_EARLY',
      messageKey: 'common.noShow.tooEarly',
    });
    at(w, 60);
    const id = randomUUID();
    const ok = await report(w, host(w), { requestId: id });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({
      declarationId: id,
      requestedAt: new Date(w.start.getTime() + 60 * MINUTE).toISOString(),
      status: 'PENDING',
    });
    const g = await view(w, guest(w));
    expect(g.json).toMatchObject({
      viewerRole: 'GUEST',
      absentParty: 'HOST',
      declaration: { id, requestedReason: 'GUEST_NO_SHOW', status: 'PENDING', mine: false },
    });
  });

  it('aucune déclaration ne se rejoue : même requestId ⇒ la même demande ; autre requestId ⇒ CANCELLATION_PENDING ; requestId d’une autre personne ⇒ 400', async () => {
    const w = await world();
    apps.push(w.app);
    at(w, 70);
    const id = randomUUID();
    const first = await report(w, host(w), { requestId: id });
    const again = await report(w, host(w), { requestId: id.toUpperCase() });
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    const other = await report(w, host(w), { requestId: randomUUID() });
    expect(other.status).toBe(409);
    expect((other.json as { code: string }).code).toBe('CANCELLATION_PENDING');
    const taken = await report(w, guest(w), { requestId: id });
    expect(taken.status).toBe(400);
    expect((taken.json as { code: string }).code).toBe('REQUEST_INVALID');
  });

  it('critère 4 : no-show de l’hôte signalé par le voyageur à T+31 avec preuve ; sans preuve, trop tôt, hôte présent, fenêtre close, état du trip : refus', async () => {
    const w = await world();
    apps.push(w.app);
    const t = w.store.trips.get(w.trip)!;
    at(w, 29);
    expect((await report(w, guest(w), { requestId: randomUUID() })).json).toMatchObject({
      code: 'NO_SHOW_TOO_EARLY',
    });
    at(w, 31);
    expect((await report(w, guest(w), { requestId: randomUUID() })).json).toMatchObject({
      code: 'NO_SHOW_EVIDENCE_REQUIRED',
      messageKey: 'common.noShow.evidenceRequired',
    });
    t.traced.GUEST = true;
    t.present.HOST = true;
    expect((await report(w, guest(w), { requestId: randomUUID() })).json).toMatchObject({
      code: 'NO_SHOW_PARTY_PRESENT',
    });
    t.present.HOST = false;
    at(w, 72 * 60 + 1);
    expect((await report(w, guest(w), { requestId: randomUUID() })).json).toMatchObject({
      code: 'NO_SHOW_WINDOW_CLOSED',
    });
    at(w, 31);
    t.status = 'BOOKED';
    expect((await report(w, guest(w), { requestId: randomUUID() })).json).toMatchObject({
      code: 'CHECKIN_NOT_OPEN',
    });
    t.status = 'IN_PROGRESS';
    expect((await report(w, guest(w), { requestId: randomUUID() })).json).toMatchObject({
      code: 'NO_SHOW_NOT_ALLOWED',
    });
    t.status = 'CHECKIN_OPEN';
    const id = randomUUID();
    const ok = await report(w, guest(w), { requestId: id });
    expect(ok.status).toBe(200);
    // ADR-191 (revue sécurité n° 1) : le signalement attend la validation de l'ops
    expect(ok.json).toMatchObject({ declarationId: id, status: 'AWAITING_REVIEW' });
    expect((await view(w, host(w))).json).toMatchObject({
      declaration: { id, requestedReason: 'HOST_NO_SHOW', status: 'AWAITING_REVIEW', mine: false },
    });
  });

  it('corps strict (aucune heure, aucun motif reçus), JSON exigé (415), IDOR 404, sans session 401, base injoignable 503', async () => {
    const w = await world();
    apps.push(w.app);
    at(w, 70);
    for (const body of [
      {},
      { requestId: 'pas-un-uuid' },
      { requestId: randomUUID(), at: new Date().toISOString() },
      { requestId: randomUUID(), reason: 'HOST_NO_SHOW' },
    ]) {
      const r = await report(w, host(w), body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect((r.json as { code: string }).code).toBe('REQUEST_INVALID');
    }
    expect(
      (await w.app.api.request('POST', `/trips/${w.trip}/no-show`, textBody(host(w)))).status,
    ).toBe(415);
    for (const path of [
      `/trips/${w.trip}/no-show`,
      `/trips/${randomUUID()}/no-show`,
      `/trips/not-a-uuid/no-show`,
    ]) {
      const g = await w.app.api.request('GET', path, { headers: stranger(w) });
      expect(g.status, path).toBe(404);
      expect((g.json as { code: string }).code).toBe('NO_SHOW_NOT_FOUND');
      const p = await w.app.api.request('POST', path, {
        headers: stranger(w),
        body: { requestId: randomUUID() },
      });
      expect(p.status, path).toBe(404);
    }
    expect((await w.app.api.request('GET', `/trips/${w.trip}/no-show`)).status).toBe(401);
    expect(
      (
        await w.app.api.request('POST', `/trips/${w.trip}/no-show`, {
          body: { requestId: randomUUID() },
        })
      ).status,
    ).toBe(401);
    const none = await startContractApp();
    apps.push(none);
    for (const [method, json] of [
      ['GET', undefined],
      ['POST', { requestId: randomUUID() }],
    ] as const) {
      const x = await none.api.request(method, `/trips/${w.trip}/no-show`, {
        headers: none.cookie('voyageur'),
        ...(json !== undefined ? { body: json } : {}),
      });
      expect(x.status, method).toBe(503);
      expect(x.json).toMatchObject({
        code: 'NO_SHOW_UNAVAILABLE',
        messageKey: 'common.noShow.unavailable',
      });
    }
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/no-show est exercé', () => {
    expect(missingCoverage(contract, '/trips/{tripId}/no-show', coverageOf(...apps))).toEqual([]);
  });
});
