/**
 * US-315 — contrat des routes de la remise et du retour (`/trips/{tripId}/handover/{direction}`,
 * `/checkin/open`, `/checkin/identity`, `/{direction}/validate`) sur l'application RÉELLE
 * (ApiModule, gardes globaux, durcissement HTTP ; harnais d'US-043) avec le FAKE du magasin :
 * chaque réponse est confrontée à `apps/api/openapi/openapi.json`, chaque statut déclaré est
 * exercé.
 *
 * Attendus tirés de 19 US-315 et de 16 TRP-002, VER-015, TRP-033, jamais du code testé :
 * - remise bloquée tant qu'une condition manque (paiement prouvé par webhook signé, contrat signé,
 *   caution, assureur, éligibilité) : 409 avec le code de la condition ;
 * - contrôle du permis par l'hôte seul (403 au voyageur), six points ; forme incomplète ⇒ 422 ;
 * - une heure envoyée par le client est refusée (400) : l'heure serveur fait foi ;
 * - remise sans rencontre jamais proposée (`contactlessOffered` false) et refusée (409) ;
 * - seconde validation ⇒ transition à l'heure serveur ; rejeu ⇒ l'heure d'origine ;
 * - IDOR : toute autre personne, trip inconnu, sens mal formé ⇒ la même 404 ;
 * - base injoignable ⇒ 503 HANDOVER_UNAVAILABLE (aucune file hors ligne, L3-PM-14).
 * Les règles de la base sont prouvées sur PostgreSQL (l0-us315-handover). Données fictives.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  closeContractApps,
  contract,
  coverageOf,
  startContractApp,
  textBody,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import type { MitConsentOutcome, MitConsentPort, MitReminderOutcome } from '../../pay/index.js';
import { FakeHandoverStore, fakeTrip } from './fake-handover-store.js';

/** Rappel du consentement MIT (US-703) imposé — TESTS SEULEMENT ; la règle est jugée en base. */
class RecordingReminders implements MitConsentPort {
  readonly reminded: { readonly tripId: string; readonly locale: string }[] = [];
  down = false;
  mode(): Promise<null> {
    return Promise.resolve(null);
  }
  accept(): Promise<MitConsentOutcome> {
    return Promise.reject(new Error('non utilisé'));
  }
  acknowledgeReminder(_p: Buffer, tripId: string, locale: string): Promise<MitReminderOutcome> {
    if (this.down) return Promise.reject(new Error('base indisponible'));
    this.reminded.push({ tripId, locale });
    return Promise.resolve('ACKNOWLEDGED');
  }
}

afterAll(closeContractApps);

const OK6 = {
  face: true,
  name: true,
  birthYear: true,
  valid: true,
  provisional: true,
  restrictions: true,
};
const READING = { odometerKm: 42000, fuelEighths: 8, method: 'IN_PERSON' };

interface World {
  readonly app: ContractApp;
  readonly store: FakeHandoverStore;
  readonly trip: string;
}

async function world(reminders?: RecordingReminders): Promise<World> {
  const store = new FakeHandoverStore();
  const app = await startContractApp({
    trp: { handover: store, ...(reminders === undefined ? {} : { mitReminders: reminders }) },
  });
  const trip = randomUUID();
  // voyageur = voyageur du trip ; staff_sans_mfa = titulaire du compte d'hôte ; staff = étranger
  store.trips.set(
    trip,
    fakeTrip(app.hash('staff_sans_mfa'), app.hash('voyageur'), new Date(Date.now() - 60_000)),
  );
  return { app, store, trip };
}

const guest = (w: World) => w.app.cookie('voyageur');
const host = (w: World) => w.app.cookie('staff_sans_mfa');
const stranger = (w: World) => w.app.cookie('staff');

const post = (w: World, who: Record<string, string>, path: string, body: unknown) =>
  w.app.api.request('POST', `/trips/${w.trip}/handover/${path}`, { headers: who, body });

describe('US-315 — routes de la remise et du retour (contrat OpenAPI)', () => {
  const apps: ContractApp[] = [];

  it('lecture : état, conditions, permis ; l’hôte voit prénom, initiale, année ; sans rencontre jamais proposée ; IDOR 404 ; 401', async () => {
    const w = await world();
    apps.push(w.app);
    const h = await w.app.api.request('GET', `/trips/${w.trip}/handover/checkin`, {
      headers: host(w),
    });
    expect(h.status).toBe(200);
    // avant l'ouverture : aucune donnée du voyageur à l'hôte
    expect(h.json).toMatchObject({
      viewerRole: 'HOST',
      direction: 'checkin',
      tripStatus: 'BOOKED',
      canOpen: true,
      blockers: [],
      guest: null,
      contactlessOffered: false,
    });
    w.store.trips.get(w.trip)!.status = 'CHECKIN_OPEN';
    const during = await w.app.api.request('GET', `/trips/${w.trip}/handover/checkin`, {
      headers: host(w),
    });
    expect(during.json).toMatchObject({
      guest: { firstName: 'Ana', lastInitial: 'P', birthYear: 1990 },
    });
    const g = await w.app.api.request('GET', `/trips/${w.trip}/handover/checkin`, {
      headers: guest(w),
    });
    expect(g.json).toMatchObject({ viewerRole: 'GUEST', guest: null });
    const out = await w.app.api.request('GET', `/trips/${w.trip}/handover/checkout`, {
      headers: host(w),
    });
    expect(out.json).toMatchObject({ guest: null, identityCheck: null, opensAt: null });
    for (const path of [
      `/trips/${w.trip}/handover/checkin`,
      `/trips/${w.trip}/handover/arrival`,
      `/trips/not-a-uuid/handover/checkin`,
      `/trips/${randomUUID()}/handover/checkin`,
    ]) {
      const x = await w.app.api.request('GET', path, { headers: stranger(w) });
      expect(x.status, path).toBe(404);
      expect((x.json as { code: string }).code).toBe('HANDOVER_NOT_FOUND');
    }
    expect((await w.app.api.request('GET', `/trips/${w.trip}/handover/checkin`)).status).toBe(401);
  });

  it('critère 1 : remise bloquée sans preuve de paiement par webhook ou sans contrat signé ; témoin ouvert', async () => {
    const w = await world();
    apps.push(w.app);
    const t = w.store.trips.get(w.trip)!;
    for (const code of ['CHECKIN_PAYMENT_NOT_CONFIRMED', 'CONTRACT_NOT_SIGNED']) {
      t.blockers = [code];
      const r = await post(w, host(w), 'checkin/open', {});
      expect(r.status, code).toBe(409);
      expect((r.json as { code: string }).code).toBe(code);
    }
    t.blockers = [];
    const ok = await post(w, guest(w), 'checkin/open', {});
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ tripStatus: 'CHECKIN_OPEN' });
    expect((await post(w, host(w), 'checkin/open', { at: 'now' })).status).toBe(400);
    expect((await post(w, stranger(w), 'checkin/open', {})).status).toBe(404);
  });

  it('critères 2, 3, 4 et 6 : permis (hôte seul, six points), heure client refusée, sans rencontre refusée, seconde validation ⇒ IN_PROGRESS puis RETURNED à l’heure serveur', async () => {
    const w = await world();
    apps.push(w.app);
    const t = w.store.trips.get(w.trip)!;
    // permis : remise non ouverte, puis voyageur refusé, forme incomplète, puis conforme
    expect((await post(w, host(w), 'checkin/identity', { checklist: OK6 })).status).toBe(409);
    t.status = 'CHECKIN_OPEN';
    const asGuest = await post(w, guest(w), 'checkin/identity', { checklist: OK6 });
    expect(asGuest.status).toBe(403);
    expect((asGuest.json as { code: string }).code).toBe('HANDOVER_HOST_ONLY');
    const five = { face: true, name: true, birthYear: true, valid: true, provisional: true };
    const incomplete = await post(w, host(w), 'checkin/identity', { checklist: five });
    expect(incomplete.status).toBe(422);
    expect((incomplete.json as { code: string }).code).toBe('CHECKIN_LICENSE_CHECK_INCOMPLETE');
    expect(
      (await post(w, host(w), 'checkin/identity', { checklist: OK6, licenseNumber: 'X1' })).status,
    ).toBe(400);
    const checked = await post(w, host(w), 'checkin/identity', { checklist: OK6 });
    expect(checked.status).toBe(200);
    expect(checked.json).toMatchObject({ status: 'OK', alreadyChecked: false });

    // relevés : une heure envoyée par le client est refusée ; relevé hors bornes ⇒ 422
    expect(
      (await post(w, host(w), 'checkin/validate', { ...READING, validatedAt: '2001-01-01' }))
        .status,
    ).toBe(400);
    const bad = await post(w, host(w), 'checkin/validate', { ...READING, fuelEighths: 9 });
    expect(bad.status).toBe(422);
    expect((bad.json as { code: string }).code).toBe('READING_INVALID');
    // série de photos non validée ⇒ 409 ; sans rencontre ⇒ 409, jamais acceptée
    const step = await post(w, host(w), 'checkin/validate', READING);
    expect(step.status).toBe(409);
    expect((step.json as { code: string }).code).toBe('CHECKIN_STEP_INCOMPLETE');
    t.photos.CHECKIN = { HOST: 'SUBMITTED', GUEST: 'SUBMITTED' };
    const contactless = await post(w, host(w), 'checkin/validate', {
      ...READING,
      method: 'CONTACTLESS',
    });
    expect(contactless.status).toBe(409);
    expect((contactless.json as { code: string }).code).toBe('CONTACTLESS_UNAVAILABLE');

    // première validation, puis la seconde : IN_PROGRESS à l'heure serveur
    const T1 = new Date('2035-06-10T10:10:00.000Z');
    const T2 = new Date('2035-06-10T10:30:00.000Z');
    w.store.now = () => T1;
    const first = await post(w, host(w), 'checkin/validate', READING);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ completed: false, completedAt: null });
    w.store.now = () => T2;
    const second = await post(w, guest(w), 'checkin/validate', READING);
    expect(second.json).toMatchObject({
      completed: true,
      completedAt: T2.toISOString(),
      tripStatus: 'IN_PROGRESS',
      alreadyValidated: false,
    });
    const replay = await post(w, guest(w), 'checkin/validate', READING);
    expect(replay.json).toMatchObject({ alreadyValidated: true, completedAt: T2.toISOString() });

    // retour : les deux validations ⇒ RETURNED, fin effective = heure serveur de la seconde
    t.photos.CHECKOUT = { HOST: 'SUBMITTED', GUEST: 'SUBMITTED' };
    const T3 = new Date('2035-06-14T10:20:00.000Z');
    w.store.now = () => T3;
    expect((await post(w, host(w), 'checkout/validate', READING)).status).toBe(200);
    const back = await post(w, guest(w), 'checkout/validate', READING);
    expect(back.json).toMatchObject({
      completed: true,
      completedAt: T3.toISOString(),
      tripStatus: 'RETURNED',
    });
    const v = await w.app.api.request('GET', `/trips/${w.trip}/handover/checkout`, {
      headers: host(w),
    });
    expect((v.json as { completedAt: string }).completedAt).toBe(T3.toISOString());
  });

  it('US-703 : validation de la remise avec la langue du rappel MIT ⇒ rappel transmis à la base (départ seulement) ; langue invalide ⇒ 400 ; rappel en échec ⇒ la remise n’est jamais bloquée', async () => {
    const reminders = new RecordingReminders();
    const w = await world(reminders);
    apps.push(w.app);
    const t = w.store.trips.get(w.trip)!;
    t.status = 'CHECKIN_OPEN';
    t.photos.CHECKIN = { HOST: 'SUBMITTED', GUEST: 'SUBMITTED' };
    expect(
      (await post(w, guest(w), 'checkin/validate', { ...READING, locale: 'espagnol' })).status,
    ).toBe(400);
    expect(reminders.reminded).toEqual([]);
    reminders.down = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await post(w, guest(w), 'checkin/validate', { ...READING, locale: 'fr' });
    expect(first.status).toBe(200);
    // revue sécurité n° 7 : échec journalisé par un code, sans identifiant ni valeur
    const lines = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    expect(lines).toContainEqual(
      JSON.stringify({ level: 'warn', event: 'handover.mit_reminder_failed', code: 'Error' }),
    );
    expect(lines.join(' ')).not.toContain(w.trip);
    reminders.down = false;
    const replay = await post(w, guest(w), 'checkin/validate', { ...READING, locale: 'pt-BR' });
    expect(replay.status).toBe(200);
    expect(reminders.reminded).toEqual([{ tripId: w.trip, locale: 'pt-BR' }]);
    // sans langue (hôte, ancien client) : aucun rappel ; au retour : jamais
    await post(w, host(w), 'checkin/validate', READING);
    t.photos.CHECKOUT = { HOST: 'SUBMITTED', GUEST: 'SUBMITTED' };
    await post(w, guest(w), 'checkout/validate', { ...READING, locale: 'es' });
    expect(reminders.reminded).toHaveLength(1);
  });

  it('corps : JSON exigé (415), sans session (401), magasin injoignable ⇒ 503 « réessayer » (aucune file hors ligne)', async () => {
    const w = await world();
    apps.push(w.app);
    for (const path of ['checkin/open', 'checkin/identity', 'checkin/validate']) {
      const t = await w.app.api.request(
        'POST',
        `/trips/${w.trip}/handover/${path}`,
        textBody(guest(w)),
      );
      expect(t.status, path).toBe(415);
      const x = await w.app.api.request('POST', `/trips/${w.trip}/handover/${path}`, { body: {} });
      expect(x.status, path).toBe(401);
      expect(
        (
          await post(
            w,
            stranger(w),
            path,
            path.endsWith('identity')
              ? { checklist: OK6 }
              : path.endsWith('validate')
                ? READING
                : {},
          )
        ).status,
        path,
      ).toBe(404);
    }
    const none = await startContractApp();
    apps.push(none);
    for (const [method, path, json] of [
      ['GET', `/trips/${w.trip}/handover/checkin`, undefined],
      ['POST', `/trips/${w.trip}/handover/checkin/open`, {}],
      ['POST', `/trips/${w.trip}/handover/checkin/identity`, { checklist: OK6 }],
      ['POST', `/trips/${w.trip}/handover/checkout/validate`, READING],
    ] as const) {
      const x = await none.api.request(method, path, {
        headers: none.cookie('voyageur'),
        ...(json !== undefined ? { body: json } : {}),
      });
      expect(x.status, path).toBe(503);
      expect(x.json).toMatchObject({
        code: 'HANDOVER_UNAVAILABLE',
        messageKey: 'common.handover.unavailable',
      });
    }
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/handover est exercé', () => {
    expect(missingCoverage(contract, '/trips/{tripId}/handover', coverageOf(...apps))).toEqual([]);
  });
});
