/**
 * US-224 partie 224d — contrat de la route `GET /trips/{tripId}/refunds` (remboursement d'un trip lu
 * par sa partie) sur l'application RÉELLE (ApiModule, gardes globaux, durcissement HTTP ; harnais
 * d'US-043) avec un FAKE du magasin : chaque réponse est confrontée à `openapi.json`, chaque statut
 * déclaré est exercé.
 *
 * Attendus tirés de 19 US-224 critère 1 (« visible du voyageur, de l'hôte (jambe HOST seulement) et
 * de l'ops »), de 17 §2.3 point 5 (IDOR : 404, même réponse), de 08 BR-PAY-08 (date d'émission) et
 * des oracles Python (`@rueda/money/golden-vectors` : −TJ02b en USD, −TJ08b en PYG sans décimale),
 * jamais du code testé. La partie (voyageur, titulaire du compte d'hôte, autre personne) est jugée
 * en base et prouvée sur PostgreSQL (`packages/db/test/l0/l0-us224d-refund-read.test.ts`) ; ici, le
 * FAKE rend ce que rendrait la base et la route doit le servir tel quel, ou refuser (fail-closed).
 */
import { createHash, randomUUID } from 'node:crypto';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
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
import type { TripRefundRow, TripRefundStore } from '../internal/checkout/trip-refunds.js';

const apps: ContractApp[] = [];
afterAll(closeContractApps);

const golden = loadGoldenVectors();
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
/** Remboursement de chaque jambe = −variation (08 E7 règle 1). */
const refundOf = (v: GoldenLegVector) => {
  const legs = Object.fromEntries(LEGS.map((k) => [k, -(v.legsMinor[k] ?? 0n)])) as Record<
    (typeof LEGS)[number],
    bigint
  >;
  return { legs, total: LEGS.reduce((s, k) => s + legs[k], 0n), currency: v.currency };
};
const exponentOf = (currency: string): number => {
  const c = [...repoConfig.countries.values()].find((x) => x.currency.code === currency);
  if (c === undefined) throw new Error(`devise ${currency} absente de la configuration`);
  return c.currency.exponent;
};

const PLANNED_AT = '2034-03-07T10:00:00.000Z';
const ISSUED_AT = '2034-03-07T10:00:10.123Z';

/** Magasin en mémoire : ce que la base rendrait à la session (empreinte) pour un trip. */
class FakeTripRefundStore implements TripRefundStore {
  readonly rows = new Map<string, TripRefundRow>();
  failing = false;

  set(proofHex: string, tripId: string, row: TripRefundRow): void {
    this.rows.set(`${proofHex}:${tripId}`, row);
  }

  read(proof: Buffer, tripId: string): Promise<TripRefundRow> {
    if (this.failing) return Promise.reject(new Error('base indisponible'));
    return Promise.resolve(
      this.rows.get(`${proof.toString('hex')}:${tripId}`) ?? {
        outcome: 'NOT_FOUND',
        viewerRole: null,
        tripStatus: null,
        currency: null,
        exponent: null,
        timezone: null,
        refunds: null,
      },
    );
  }
}

interface World {
  readonly app: ContractApp;
  readonly store: FakeTripRefundStore;
}

async function world(): Promise<World> {
  const store = new FakeTripRefundStore();
  const app = await startContractApp({ checkout: { refunds: store } });
  apps.push(app);
  return { app, store };
}

describe('US-224 partie 224d — remboursement d’un trip lu par sa partie', () => {
  it.each(['TJ02b', 'TJ08b'])(
    'critère 1 (%s) : le voyageur lit le montant remboursé, le rail et la date d’émission ; l’hôte lit la jambe HOST seulement ; montants tels que la base les rend',
    async (id) => {
      const w = await world();
      const r = refundOf(legVector(golden, id));
      const exponent = exponentOf(r.currency);
      const trip = randomUUID();
      w.store.set(w.app.hash('voyageur'), trip, {
        outcome: 'OK',
        viewerRole: 'GUEST',
        tripStatus: 'CANCELLED_BY_GUEST',
        currency: r.currency,
        exponent,
        timezone: 'Etc/UTC',
        refunds: [
          {
            status: 'SENT',
            currency: r.currency,
            amountMinor: r.total.toString(),
            rail: 'NATIVE_PARTIAL',
            plannedAt: PLANNED_AT,
            issuedAt: ISSUED_AT,
          },
        ],
      });
      w.store.set(w.app.hash('staff'), trip, {
        outcome: 'OK',
        viewerRole: 'HOST',
        tripStatus: 'CANCELLED_BY_GUEST',
        currency: r.currency,
        exponent,
        timezone: 'Etc/UTC',
        refunds: [
          {
            status: 'PLANNED',
            currency: r.currency,
            hostLegMinor: r.legs.HOST.toString(),
            plannedAt: PLANNED_AT,
            issuedAt: null,
          },
        ],
      });
      // identifiant en majuscules : même trip (la base reçoit la forme canonique)
      const guest = await w.app.api.request('GET', `/trips/${trip.toUpperCase()}/refunds`, {
        headers: w.app.cookie('voyageur'),
      });
      expect(guest.status).toBe(200);
      expect(guest.headers.get('cache-control')).toBe('no-store');
      expect(guest.json).toEqual({
        tripId: trip,
        viewerRole: 'GUEST',
        tripStatus: 'CANCELLED_BY_GUEST',
        currency: r.currency,
        currencyExponent: exponent,
        timezone: 'Etc/UTC',
        refunds: [
          {
            status: 'SENT',
            amountMinor: r.total.toString(),
            rail: 'NATIVE_PARTIAL',
            plannedAt: PLANNED_AT,
            issuedAt: ISSUED_AT,
          },
        ],
      });
      const host = await w.app.api.request('GET', `/trips/${trip}/refunds`, {
        headers: w.app.cookie('staff'),
      });
      expect(host.status).toBe(200);
      // jambe HOST seulement : ni montant du voyageur, ni rail
      expect(host.json).toEqual({
        tripId: trip,
        viewerRole: 'HOST',
        tripStatus: 'CANCELLED_BY_GUEST',
        currency: r.currency,
        currencyExponent: exponent,
        timezone: 'Etc/UTC',
        refunds: [
          {
            status: 'PLANNED',
            hostLegMinor: r.legs.HOST.toString(),
            plannedAt: PLANNED_AT,
            issuedAt: null,
          },
        ],
      });
    },
  );

  it('IDOR et saisie : tiers, trip inconnu ou identifiant mal formé ⇒ même 404 ; sans session ⇒ 401', async () => {
    const w = await world();
    const trip = randomUUID();
    w.store.set(w.app.hash('voyageur'), trip, {
      outcome: 'OK',
      viewerRole: 'GUEST',
      tripStatus: 'BOOKED',
      currency: 'XTS',
      exponent: 2,
      timezone: 'Etc/UTC',
      refunds: [],
    });
    const own = await w.app.api.request('GET', `/trips/${trip}/refunds`, {
      headers: w.app.cookie('voyageur'),
    });
    expect(own.status).toBe(200);
    expect(own.json).toMatchObject({ refunds: [] });
    const notFound = { code: 'REFUND_NOT_FOUND', messageKey: 'common.refund.notFound' };
    for (const [path, headers] of [
      [`/trips/${trip}/refunds`, w.app.cookie('staff_sans_mfa')],
      [`/trips/${randomUUID()}/refunds`, w.app.cookie('voyageur')],
      ['/trips/pas-un-uuid/refunds', w.app.cookie('voyageur')],
    ] as const) {
      const r = await w.app.api.request('GET', path, { headers });
      expect(r.status, path).toBe(404);
      expect(r.json).toEqual(notFound);
    }
    const anonymous = await w.app.api.request('GET', `/trips/${trip}/refunds`);
    expect(anonymous.status).toBe(401);
  });

  it('fail-closed : base indisponible, aucun adaptateur, forme inattendue ou montant mal formé ⇒ 503, rien de servi', async () => {
    const w = await world();
    const trip = randomUUID();
    const hash = w.app.hash('voyageur');
    const headers = w.app.cookie('voyageur');
    const path = `/trips/${trip}/refunds`;
    const good = {
      status: 'CONFIRMED',
      currency: 'XTS',
      amountMinor: '100',
      rail: 'NATIVE_PARTIAL',
      plannedAt: PLANNED_AT,
      issuedAt: ISSUED_AT,
    };
    const base: TripRefundRow = {
      outcome: 'OK',
      viewerRole: 'GUEST',
      tripStatus: 'CANCELLED_BY_GUEST',
      currency: 'XTS',
      exponent: 2,
      timezone: 'Etc/UTC',
      refunds: [good],
    };
    for (const row of [
      { ...base, refunds: [{ ...good, amountMinor: '1.5' }] },
      { ...base, refunds: [{ ...good, amountMinor: '-100' }] },
      { ...base, refunds: [{ ...good, status: 'REFUNDED' }] },
      { ...base, refunds: [{ ...good, issuedAt: '2034-03-07' }] },
      { ...base, refunds: [{ ...good, currency: 'XTA' }] },
      { ...base, refunds: [{ ...good, rail: 'AGENCY_TRANSFER' }] },
      { ...base, refunds: 'x' },
      { ...base, exponent: null },
      { ...base, timezone: null },
      { ...base, timezone: 'UTC; DROP' },
      { ...base, viewerRole: 'STAFF' },
      { ...base, outcome: 'MAYBE' },
    ] as TripRefundRow[]) {
      w.store.set(hash, trip, row);
      const r = await w.app.api.request('GET', path, { headers });
      expect(r.status, JSON.stringify(row)).toBe(503);
      expect(r.json).toEqual({
        code: 'REFUNDS_UNAVAILABLE',
        messageKey: 'common.refund.unavailable',
      });
    }
    w.store.failing = true;
    expect((await w.app.api.request('GET', path, { headers })).status).toBe(503);
    const bare = await startContractApp();
    apps.push(bare);
    const none = await bare.api.request('GET', `/trips/${randomUUID()}/refunds`, {
      headers: bare.cookie('voyageur'),
    });
    expect(none.status).toBe(503);
  });

  it('l’empreinte transmise au magasin est celle du jeton de session (jamais un identifiant reçu)', async () => {
    const w = await world();
    const trip = randomUUID();
    const seen: string[] = [];
    const read = w.store.read.bind(w.store);
    w.store.read = (proof, id) => {
      seen.push(proof.toString('hex'));
      return read(proof, id);
    };
    await w.app.api.request('GET', `/trips/${trip}/refunds`, {
      headers: w.app.cookie('voyageur'),
    });
    const token = w.app.h.sessions.voyageur.token;
    expect(seen).toEqual([createHash('sha256').update(token, 'utf8').digest('hex')]);
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/refunds est exercé', () => {
    expect(
      missingCoverage(contract, '/trips/{tripId}/refunds', coverageOf(...apps)),
      'statuts',
    ).toEqual([]);
  });
});
