/**
 * US-214 — contrat des routes `GET /trips` et `GET /trips/{tripId}` (« Mis viajes » et détail du
 * trip du voyageur) sur l'application RÉELLE (ApiModule, gardes globaux, durcissement HTTP ; harnais
 * d'US-043) avec un FAKE du magasin : chaque réponse est confrontée à `openapi.json`, chaque statut
 * déclaré est exercé.
 *
 * Attendus tirés de 19 US-214 (« Given un guest A, When il demande le trip de B, Then 404 »), de
 * 17 §2.3 point 5 (IDOR : même réponse), de 16 BKG-027 et des oracles Python
 * (`@rueda/money/golden-vectors` : total capturé de TJ01 en USD, de TJ08a en PYG sans décimale),
 * jamais du code testé. Le voyageur (celui de la session) est jugé en base et prouvé sur PostgreSQL
 * (`packages/db/test/l0/l0-us214-guest-trips.test.ts`) ; ici, le FAKE rend ce que rendrait la base
 * et la route doit le servir tel quel, ou refuser (fail-closed).
 */
import { createHash, randomUUID } from 'node:crypto';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { afterAll, describe, expect, it } from 'vitest';
import { repoConfig } from '../../../../test/support/quote.js';
import {
  closeContractApps,
  contract,
  coverageOf,
  startContractApp,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import type { GuestTripRow, GuestTripStore } from '../internal/checkout/guest-trips.js';

const apps: ContractApp[] = [];
afterAll(closeContractApps);

const golden = loadGoldenVectors();
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
/** Total capturé d'un vecteur = Σ jambes (08 E7 règle 1). */
const totalOf = (id: string) => {
  const v = legVector(golden, id);
  return { total: LEGS.reduce((s, k) => s + (v.legsMinor[k] ?? 0n), 0n), currency: v.currency };
};
const exponentOf = (currency: string): number => {
  const c = [...repoConfig.countries.values()].find((x) => x.currency.code === currency);
  if (c === undefined) throw new Error(`devise ${currency} absente de la configuration`);
  return c.currency.exponent;
};

const START = new Date('2034-03-10T15:00:00.000Z');
const END = new Date('2034-03-13T15:00:00.000Z');
const RESPOND_BY = new Date('2034-03-08T15:00:00.000Z');

const tripRow = (id: string, currency: string, exponent: number, total: string): GuestTripRow => ({
  outcome: 'DONE',
  kind: 'TRIP',
  itemId: id,
  publicRef: `K-${id.slice(0, 8).toUpperCase()}`,
  tab: 'UPCOMING',
  status: 'BOOKED',
  paymentStatus: 'CONFIRMED',
  currency,
  exponent,
  timezone: 'Etc/UTC',
  startsAt: START,
  endsAt: END,
  respondBy: null,
  vehicleMake: 'Toyota',
  vehicleModel: 'Yaris',
  vehicleYear: 2022,
  hostName: 'María G.',
  placeLabel: 'Punto de entrega',
  placeAddress: 'Calle de prueba 1',
  placeCity: 'Ciudad de prueba',
  totalMinor: total,
  contractState: 'TO_SIGN',
});

const requestRow = (id: string, currency: string, exponent: number, total: string) =>
  ({
    ...tripRow(id, currency, exponent, total),
    kind: 'REQUEST',
    publicRef: null,
    tab: 'REQUESTED',
    status: 'AWAITING_HOST',
    paymentStatus: null,
    respondBy: RESPOND_BY,
    placeLabel: null,
    placeAddress: null,
    contractState: null,
  }) satisfies GuestTripRow;

/** Magasin en mémoire : ce que la base rendrait à la session (empreinte). */
class FakeGuestTripStore implements GuestTripStore {
  readonly rows = new Map<string, GuestTripRow[]>();
  failing = false;

  set(proofHex: string, rows: GuestTripRow[]): void {
    this.rows.set(proofHex, rows);
  }

  read(proof: Buffer, tripId: string | null, limit: number): Promise<GuestTripRow[]> {
    if (this.failing) return Promise.reject(new Error('base indisponible'));
    const all = this.rows.get(proof.toString('hex'));
    if (all === undefined) {
      // session inconnue de la base : la base rend AUTH_REQUIRED (0136)
      return Promise.resolve([
        { ...tripRow(randomUUID(), 'XTS', 2, '1'), outcome: 'AUTH_REQUIRED' },
      ]);
    }
    const mine =
      tripId === null ? all : all.filter((r) => r.kind === 'TRIP' && r.itemId === tripId);
    return Promise.resolve(mine.slice(0, limit));
  }
}

async function world(): Promise<{ app: ContractApp; store: FakeGuestTripStore }> {
  const store = new FakeGuestTripStore();
  const app = await startContractApp({ checkout: { guestTrips: store } });
  apps.push(app);
  return { app, store };
}

describe('US-214 — Mis viajes et détail du trip du voyageur', () => {
  it.each(['TJ01', 'TJ08a'])(
    'liste et détail (%s) : demande puis trip, total tel que la base le rend, exposant de la devise, hôte minimisé',
    async (id) => {
      const w = await world();
      const { total, currency } = totalOf(id);
      const exponent = exponentOf(currency);
      const trip = randomUUID();
      const hold = randomUUID();
      w.store.set(w.app.hash('voyageur'), [
        requestRow(hold, currency, exponent, '4200'),
        tripRow(trip, currency, exponent, total.toString()),
      ]);
      const list = await w.app.api.request('GET', '/trips', { headers: w.app.cookie('voyageur') });
      expect(list.status).toBe(200);
      expect(list.headers.get('cache-control')).toBe('no-store');
      const expectedTrip = {
        kind: 'TRIP',
        id: trip,
        reference: `K-${trip.slice(0, 8).toUpperCase()}`,
        tab: 'UPCOMING',
        status: 'BOOKED',
        paymentStatus: 'CONFIRMED',
        currency,
        currencyExponent: exponent,
        timezone: 'Etc/UTC',
        startsAt: START.toISOString(),
        endsAt: END.toISOString(),
        respondBy: null,
        vehicle: { make: 'Toyota', model: 'Yaris', year: 2022 },
        hostName: 'María G.',
        handover: {
          place: 'Punto de entrega',
          address: 'Calle de prueba 1',
          city: 'Ciudad de prueba',
        },
        totalMinor: total.toString(),
        contract: 'TO_SIGN',
      };
      expect(list.json).toEqual({
        trips: [
          {
            ...expectedTrip,
            kind: 'REQUEST',
            id: hold,
            reference: null,
            tab: 'REQUESTED',
            status: 'AWAITING_HOST',
            paymentStatus: null,
            respondBy: RESPOND_BY.toISOString(),
            handover: { place: null, address: null, city: 'Ciudad de prueba' },
            totalMinor: '4200',
            contract: null,
          },
          expectedTrip,
        ],
      });
      // identifiant en majuscules : même trip (la base reçoit la forme canonique)
      const one = await w.app.api.request('GET', `/trips/${trip.toUpperCase()}`, {
        headers: w.app.cookie('voyageur'),
      });
      expect(one.status).toBe(200);
      expect(one.headers.get('cache-control')).toBe('no-store');
      expect(one.json).toEqual({ trip: expectedTrip });
    },
  );

  it('liste vide : 200 sans élément', async () => {
    const w = await world();
    w.store.set(w.app.hash('voyageur'), []);
    const r = await w.app.api.request('GET', '/trips', { headers: w.app.cookie('voyageur') });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ trips: [] });
  });

  it('IDOR et saisie : trip d’autrui, trip inconnu, demande lue par identifiant ou identifiant mal formé ⇒ même 404 ; sans session ⇒ 401', async () => {
    const w = await world();
    const trip = randomUUID();
    const hold = randomUUID();
    w.store.set(w.app.hash('voyageur'), [
      requestRow(hold, 'XTS', 2, '100'),
      tripRow(trip, 'XTS', 2, '100'),
    ]);
    // une autre personne (session valide) : la base ne lui rend aucun trip
    w.store.set(w.app.hash('staff'), []);
    const notFound = { code: 'TRIP_NOT_FOUND', messageKey: 'common.trips.notFound' };
    for (const [path, headers] of [
      [`/trips/${trip}`, w.app.cookie('staff')],
      [`/trips/${randomUUID()}`, w.app.cookie('voyageur')],
      [`/trips/${hold}`, w.app.cookie('voyageur')],
      ['/trips/pas-un-uuid', w.app.cookie('voyageur')],
    ] as const) {
      const r = await w.app.api.request('GET', path, { headers });
      expect(r.status, path).toBe(404);
      expect(r.json).toEqual(notFound);
    }
    for (const path of ['/trips', `/trips/${trip}`]) {
      const anonymous = await w.app.api.request('GET', path);
      expect(anonymous.status, path).toBe(401);
    }
    // session valide pour la garde mais inconnue de la base (révoquée entre-temps) : 401
    const revoked = await w.app.api.request('GET', '/trips', {
      headers: w.app.cookie('staff_sans_mfa'),
    });
    expect(revoked.status).toBe(401);
    expect(revoked.json).toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('fail-closed : base indisponible, aucun adaptateur, forme inattendue ou montant mal formé ⇒ 503, rien de servi', async () => {
    const w = await world();
    const hash = w.app.hash('voyageur');
    const headers = w.app.cookie('voyageur');
    const id = randomUUID();
    const good = tripRow(id, 'XTS', 2, '100');
    const req = requestRow(randomUUID(), 'XTS', 2, '100');
    for (const bad of [
      { ...good, totalMinor: '1.5' },
      { ...good, totalMinor: '-100' },
      { ...good, totalMinor: 100 },
      { ...good, totalMinor: null },
      { ...good, status: 'CANCELLED_BY_GUEST' }, // onglet incohérent avec l'état
      { ...good, status: 'HELD' },
      { ...good, tab: 'PAST' },
      { ...good, kind: 'HOLD' },
      { ...good, paymentStatus: 'PENDING' },
      { ...good, contractState: 'MAYBE' },
      { ...good, contractState: null },
      { ...good, publicRef: null },
      { ...good, respondBy: RESPOND_BY },
      { ...good, startsAt: 'pas une date' },
      { ...good, currency: 'xts' },
      { ...good, exponent: null },
      { ...good, timezone: 'UTC; DROP' },
      { ...good, itemId: 'pas-un-uuid' },
      { ...good, vehicleYear: '2022' },
      { ...good, hostName: 42 },
      { ...good, outcome: 'REQUEST_INVALID' },
      { ...req, placeAddress: 'Calle de prueba 1' }, // adresse d'une demande : jamais servie
      { ...req, respondBy: null },
      { ...req, paymentStatus: 'CONFIRMED' },
      { ...req, status: 'ACTIVE' },
      { ...req, contractState: 'NONE' },
    ] as GuestTripRow[]) {
      w.store.set(hash, [good, bad]);
      const r = await w.app.api.request('GET', '/trips', { headers });
      expect(r.status, JSON.stringify(bad)).toBe(503);
      expect(r.json).toEqual({
        code: 'TRIPS_UNAVAILABLE',
        messageKey: 'common.trips.unavailable',
      });
    }
    // détail : la base rend un autre trip que celui demandé ⇒ 503
    const other = randomUUID();
    w.store.read = () => Promise.resolve([tripRow(other, 'XTS', 2, '100')]);
    expect((await w.app.api.request('GET', `/trips/${id}`, { headers })).status).toBe(503);
    w.store.failing = true;
    w.store.read = FakeGuestTripStore.prototype.read.bind(w.store);
    expect((await w.app.api.request('GET', '/trips', { headers })).status).toBe(503);
    const bare = await startContractApp();
    apps.push(bare);
    const none = await bare.api.request('GET', '/trips', { headers: bare.cookie('voyageur') });
    expect(none.status).toBe(503);
    const noneOne = await bare.api.request('GET', `/trips/${randomUUID()}`, {
      headers: bare.cookie('voyageur'),
    });
    expect(noneOne.status).toBe(503);
  });

  it('l’empreinte transmise au magasin est celle du jeton de session (jamais un identifiant reçu)', async () => {
    const w = await world();
    const seen: string[] = [];
    const read = w.store.read.bind(w.store);
    w.store.read = (proof, tripId, limit) => {
      seen.push(proof.toString('hex'));
      return read(proof, tripId, limit);
    };
    w.store.set(w.app.hash('voyageur'), []);
    await w.app.api.request('GET', '/trips', { headers: w.app.cookie('voyageur') });
    await w.app.api.request('GET', `/trips/${randomUUID()}`, { headers: w.app.cookie('voyageur') });
    const token = w.app.h.sessions.voyageur.token;
    const expected = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(seen).toEqual([expected, expected]);
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId} est exercé', () => {
    // GET /trips et GET /trips/{tripId} seulement : le contrat (CTR) et le remboursement ont leur suite
    expect(
      missingCoverage(contract, '/trips', coverageOf(...apps)).filter((d) =>
        /^GET \/trips(\/\{tripId\})? \d{3}$/.test(d),
      ),
      'statuts',
    ).toEqual([]);
  });
});
