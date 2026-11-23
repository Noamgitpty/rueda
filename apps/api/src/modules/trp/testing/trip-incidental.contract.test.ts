/**
 * US-706 — contrat des routes des frais annexes (`/trips/{tripId}/incidental-fees`) sur
 * l'application RÉELLE (ApiModule, gardes globaux, durcissement HTTP ; harnais d'US-043) avec le FAKE
 * du magasin : chaque réponse est confrontée à `apps/api/openapi/openapi.json`, chaque statut déclaré
 * est exercé.
 *
 * Attendus tirés de 19 US-706 et de 16 CLM-021, jamais du code testé :
 * - l'hôte demande un frais de la liste fermée avec des photos du trip ; hors liste ⇒ 422
 *   INCIDENTAL_TYPE_NOT_ALLOWED ; sans pièce ⇒ 422 CLAIM_EVIDENCE_MISSING (RT-L3-S02) ;
 * - le voyageur paie ou conteste avant l'échéance (72 h après la notification) ; à l'échéance ⇒ 409
 *   GUEST_RESPONSE_WINDOW_CLOSED ; contestation sans motif ⇒ 422 ;
 * - aucune heure, aucune jambe reçue ; corps strict ; JSON exigé (415) ;
 * - IDOR : toute autre personne, trip ou frais inconnu, frais d'un autre trip ⇒ la même 404 ;
 * - base injoignable ⇒ 503 INCIDENTAL_UNAVAILABLE.
 * Les règles de la base sont prouvées sur PostgreSQL (l0-us706-incidental-fees). Données fictives.
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
import { FakeIncidentalStore, fakeIncidentalTrip } from './fake-incidental-store.js';

afterAll(closeContractApps);

const HOUR = 3_600_000;
const PHOTO_IN = '0190a1b2-c3d4-7e5f-8a9b-00000000aa01';
const PHOTO_INNER = '0190a1b2-c3d4-7e5f-8a9b-00000000aa02';
const REASON = 'Le véhicule a été rendu propre, voir la photo de l’intérieur.';

interface World {
  readonly app: ContractApp;
  readonly store: FakeIncidentalStore;
  readonly trip: string;
  readonly end: Date;
}

async function world(): Promise<World> {
  const store = new FakeIncidentalStore();
  const app = await startContractApp({ trp: { incidental: store } });
  const trip = randomUUID();
  const end = new Date(Date.UTC(2097, 2, 10, 8, 0, 0));
  // voyageur = voyageur du trip ; staff_sans_mfa = titulaire du compte d'hôte ; staff = étranger
  store.trips.set(
    trip,
    fakeIncidentalTrip(app.hash('staff_sans_mfa'), app.hash('voyageur'), end, [
      { fileId: PHOTO_IN, kind: 'CHECKOUT', slotCode: 'FUEL', slotGroup: 'FUEL', takenBy: 'HOST' },
      {
        fileId: PHOTO_INNER,
        kind: 'CHECKOUT',
        slotCode: 'INT_01',
        slotGroup: 'INTERIOR',
        takenBy: 'GUEST',
      },
    ]),
  );
  store.now = () => new Date(end.getTime() + 2 * HOUR);
  return { app, store, trip, end };
}

const guest = (w: World) => w.app.cookie('voyageur');
const host = (w: World) => w.app.cookie('staff_sans_mfa');
const stranger = (w: World) => w.app.cookie('staff');
const at = (w: World, ms: number) => {
  w.store.now = () => new Date(w.end.getTime() + ms);
};
const base = (w: World) => `/trips/${w.trip}/incidental-fees`;
const fee = (over: Record<string, unknown> = {}) => ({
  requestId: randomUUID(),
  feeType: 'CLEANING',
  amountMinor: '4500',
  description: 'Sièges arrière couverts de sable au retour',
  evidenceFileIds: [PHOTO_INNER],
  ...over,
});
const post = (w: World, path: string, who: Record<string, string>, body: unknown) =>
  w.app.api.request('POST', path, { headers: who, body });

async function submitted(w: World): Promise<string> {
  const r = await post(w, base(w), host(w), fee());
  expect(r.status).toBe(200);
  return (r.json as { invoiceId: string }).invoiceId;
}

describe('US-706 — routes des frais annexes (contrat OpenAPI)', () => {
  const apps: ContractApp[] = [];

  it('critère 1 : l’hôte demande, le voyageur voit l’échéance (notification + 72 h) ; payer avant, plus rien à l’échéance (GUEST_RESPONSE_WINDOW_CLOSED)', async () => {
    const w = await world();
    apps.push(w.app);
    const requestId = randomUUID();
    const r = await post(w, base(w), host(w), fee({ requestId }));
    expect(r.status).toBe(200);
    const notified = new Date(w.end.getTime() + 2 * HOUR);
    expect(r.json).toMatchObject({
      status: 'AWAITING_GUEST',
      responseDueAt: new Date(notified.getTime() + 72 * HOUR).toISOString(),
    });
    // rejeu : la même demande
    const again = await post(w, base(w), host(w), fee({ requestId: requestId.toUpperCase() }));
    expect(again.status).toBe(200);
    expect(again.json).toEqual(r.json);
    const id = (r.json as { invoiceId: string }).invoiceId;
    const g = await w.app.api.request('GET', base(w), { headers: guest(w) });
    expect(g.status).toBe(200);
    expect(g.json).toMatchObject({
      viewerRole: 'GUEST',
      currency: 'XTS',
      canSubmit: false,
      invoices: [{ id, feeType: 'CLEANING', amountMinor: '4500', windowOpen: true }],
    });
    at(w, 2 * HOUR + 72 * HOUR);
    const late = await post(w, `${base(w)}/${id}/accept`, guest(w), {});
    expect(late.status).toBe(409);
    expect(late.json).toMatchObject({
      code: 'GUEST_RESPONSE_WINDOW_CLOSED',
      messageKey: 'common.incidental.responseWindowClosed',
    });
    at(w, 2 * HOUR + 72 * HOUR - 1);
    const ok = await post(w, `${base(w)}/${id}/accept`, guest(w), {});
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ invoiceId: id, status: 'ACCEPTED' });
    // payé : ni contestation ni annulation
    expect(
      (
        await post(w, `${base(w)}/${id}/dispute`, guest(w), {
          reason: REASON,
          evidenceFileIds: [PHOTO_INNER],
        })
      ).status,
    ).toBe(409);
    const nc = await post(w, `${base(w)}/${id}/cancel`, host(w), {});
    expect(nc.status).toBe(409);
    expect(nc.json).toMatchObject({ code: 'INCIDENTAL_NOT_CANCELLABLE' });
  });

  it('contestation avec preuves ⇒ DISPUTED ; sans motif ou sans pièce : 422 ; annulation par l’hôte', async () => {
    const w = await world();
    apps.push(w.app);
    const id = await submitted(w);
    const short = await post(w, `${base(w)}/${id}/dispute`, guest(w), {
      reason: 'court',
      evidenceFileIds: [PHOTO_INNER],
    });
    expect(short.status).toBe(422);
    expect(short.json).toMatchObject({ code: 'INCIDENTAL_DISPUTE_REASON_REQUIRED' });
    const none = await post(w, `${base(w)}/${id}/dispute`, guest(w), {
      reason: REASON,
      evidenceFileIds: [],
    });
    expect(none.status).toBe(422);
    expect(none.json).toMatchObject({ code: 'CLAIM_EVIDENCE_MISSING' });
    const ok = await post(w, `${base(w)}/${id}/dispute`, guest(w), {
      reason: REASON,
      evidenceFileIds: [PHOTO_INNER],
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ invoiceId: id, status: 'DISPUTED' });
    expect((await w.app.api.request('GET', base(w), { headers: host(w) })).json).toMatchObject({
      viewerRole: 'HOST',
      invoices: [{ id, status: 'DISPUTED', disputeReason: REASON }],
    });
    // contesté : plus de paiement
    expect((await post(w, `${base(w)}/${id}/accept`, guest(w), {})).json).toMatchObject({
      code: 'INCIDENTAL_NOT_OPEN',
    });
    const c = await post(w, `${base(w)}/${id}/cancel`, host(w), {});
    expect(c.status).toBe(200);
    expect(c.json).toEqual({ invoiceId: id, status: 'CANCELLED_BY_HOST' });
    // ADR-202 (F-L3-FRA-01) : annulée APRÈS contestation, le même frais ne se redemande pas
    const again = await post(w, base(w), host(w), fee());
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ code: 'INCIDENTAL_DUPLICATE' });
  });

  it('ADR-202 (F-L3-FRA-02) : un fichier de l’hôte retenu comme pièce est décrit au voyageur (type, heure serveur de dépôt), sans son identifiant', async () => {
    const w = await world();
    apps.push(w.app);
    const file = '0190a1b2-c3d4-7e5f-8a9b-00000000aa03';
    const received = new Date(w.end.getTime() + HOUR);
    w.store.trips.get(w.trip)!.hostFiles.push({
      fileId: file,
      mime: 'image/webp',
      receivedAt: received,
    });
    const r = await post(w, base(w), host(w), fee({ evidenceFileIds: [file] }));
    expect(r.status).toBe(200);
    const g = await w.app.api.request('GET', base(w), { headers: guest(w) });
    expect(g.status).toBe(200);
    const inv = (g.json as { invoices: { evidenceCount: number; evidence: unknown[] }[] })
      .invoices[0]!;
    expect(inv.evidenceCount).toBe(1);
    expect(inv.evidence).toEqual([
      {
        kind: 'HOST_FILE',
        takenBy: 'HOST',
        mime: 'image/webp',
        receivedAt: received.toISOString(),
      },
    ]);
    expect(JSON.stringify(g.json)).not.toContain(file);
  });

  it('critère 2 et RT-L3-S02 : hors liste fermée ⇒ 422 ; sans pièce ⇒ 422 CLAIM_EVIDENCE_MISSING ; trip non rendu, délai dépassé, doublon ⇒ 409 ; plafond absent ⇒ 503', async () => {
    const w = await world();
    apps.push(w.app);
    for (const [body, code] of [
      [fee({ feeType: 'WEAR_AND_TEAR' }), 'INCIDENTAL_TYPE_NOT_ALLOWED'],
      [fee({ feeType: 'MILEAGE' }), 'INCIDENTAL_TYPE_NOT_SUPPORTED'],
      [fee({ evidenceFileIds: [] }), 'CLAIM_EVIDENCE_MISSING'],
      [fee({ evidenceFileIds: [randomUUID()] }), 'CLAIM_EVIDENCE_MISSING'],
      [fee({ amountMinor: '15001' }), 'INCIDENTAL_AMOUNT_ABOVE_CAP'],
    ] as const) {
      const r = await post(w, base(w), host(w), body);
      expect(r.status, code).toBe(422);
      expect((r.json as { code: string }).code).toBe(code);
    }
    await submitted(w);
    const dup = await post(w, base(w), host(w), fee());
    expect(dup.status).toBe(409);
    expect(dup.json).toMatchObject({ code: 'INCIDENTAL_DUPLICATE' });
    at(w, 72 * HOUR + 1);
    expect((await post(w, base(w), host(w), fee({ feeType: 'FUEL' }))).json).toMatchObject({
      code: 'INCIDENTAL_WINDOW_CLOSED',
    });
    const t = w.store.trips.get(w.trip)!;
    t.endedAt = null;
    expect((await post(w, base(w), host(w), fee({ feeType: 'FUEL' }))).json).toMatchObject({
      code: 'INCIDENTAL_TRIP_NOT_ENDED',
      messageKey: 'common.incidental.tripNotEnded',
    });
    t.endedAt = w.end;
    t.capMinor = null;
    at(w, HOUR);
    const missing = await post(w, base(w), host(w), fee({ feeType: 'SMOKING' }));
    expect(missing.status).toBe(503);
    expect(missing.json).toMatchObject({ code: 'INCIDENTAL_UNAVAILABLE' });
  });

  it('corps strict (aucune heure ni jambe), JSON exigé (415), IDOR 404 (autre personne, autre partie, frais d’un autre trip), sans session 401, base injoignable 503', async () => {
    const w = await world();
    apps.push(w.app);
    const id = await submitted(w);
    for (const body of [
      {},
      fee({ requestId: 'pas-un-uuid' }),
      fee({ amountMinor: 4500 }),
      fee({ amountMinor: '45.00' }),
      fee({ at: new Date().toISOString() }),
      fee({ legs: { HOST: '4500' } }),
      fee({ evidenceFileIds: 'x' }),
    ]) {
      const r = await post(w, base(w), host(w), body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect((r.json as { code: string }).code).toBe('REQUEST_INVALID');
    }
    for (const [action, body] of [
      ['accept', { amountMinor: '1' }],
      ['cancel', { at: 'now' }],
      ['dispute', { reason: REASON }],
    ] as const) {
      const who = action === 'cancel' ? host(w) : guest(w);
      expect((await post(w, `${base(w)}/${id}/${action}`, who, body)).status, action).toBe(400);
    }
    for (const action of ['', '/x/accept', '/x/dispute', '/x/cancel']) {
      const path = `${base(w)}${action.replace('x', id)}`;
      expect((await w.app.api.request('POST', path, textBody(host(w)))).status, path).toBe(415);
    }
    // IDOR : étranger, mauvaise partie, autre trip, identifiants mal formés : la même 404
    const other = randomUUID();
    for (const [method, path, who, body] of [
      ['GET', base(w), stranger(w), undefined],
      ['GET', `/trips/${randomUUID()}/incidental-fees`, host(w), undefined],
      ['GET', '/trips/not-a-uuid/incidental-fees', host(w), undefined],
      ['POST', base(w), guest(w), fee()],
      ['POST', `${base(w)}/${id}/accept`, host(w), {}],
      ['POST', `${base(w)}/${id}/cancel`, guest(w), {}],
      ['POST', `/trips/${other}/incidental-fees/${id}/accept`, guest(w), {}],
      ['POST', `${base(w)}/not-a-uuid/dispute`, guest(w), { reason: REASON, evidenceFileIds: [] }],
      ['POST', `${base(w)}/${randomUUID()}/cancel`, host(w), {}],
    ] as const) {
      const r = await w.app.api.request(method, path, {
        headers: who,
        ...(body !== undefined ? { body } : {}),
      });
      expect(r.status, `${method} ${path}`).toBe(404);
      expect((r.json as { code: string }).code).toBe('INCIDENTAL_NOT_FOUND');
    }
    for (const [method, path, body] of [
      ['GET', base(w), undefined],
      ['POST', base(w), fee()],
      ['POST', `${base(w)}/${id}/accept`, {}],
      ['POST', `${base(w)}/${id}/dispute`, { reason: REASON, evidenceFileIds: [] }],
      ['POST', `${base(w)}/${id}/cancel`, {}],
    ] as const) {
      expect(
        (await w.app.api.request(method, path, body !== undefined ? { body } : {})).status,
        path,
      ).toBe(401);
    }
    const none = await startContractApp();
    apps.push(none);
    for (const [method, path, body] of [
      ['GET', base(w), undefined],
      ['POST', base(w), fee()],
      ['POST', `${base(w)}/${id}/accept`, {}],
      ['POST', `${base(w)}/${id}/dispute`, { reason: REASON, evidenceFileIds: [PHOTO_INNER] }],
      ['POST', `${base(w)}/${id}/cancel`, {}],
    ] as const) {
      const x = await none.api.request(method, path, {
        headers: none.cookie('voyageur'),
        ...(body !== undefined ? { body } : {}),
      });
      expect(x.status, path).toBe(503);
      expect(x.json).toMatchObject({
        code: 'INCIDENTAL_UNAVAILABLE',
        messageKey: 'common.incidental.unavailable',
      });
    }
  });

  it('couverture : chaque statut déclaré pour les routes des frais annexes est exercé', () => {
    for (const path of [
      '/trips/{tripId}/incidental-fees',
      '/trips/{tripId}/incidental-fees/{invoiceId}/accept',
      '/trips/{tripId}/incidental-fees/{invoiceId}/dispute',
      '/trips/{tripId}/incidental-fees/{invoiceId}/cancel',
    ]) {
      expect(missingCoverage(contract, path, coverageOf(...apps)), path).toEqual([]);
    }
  });
});
