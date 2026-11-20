/**
 * US-314 — tests de contrat de `GET /host/accounts/{orgId}/payouts` sur l'application RÉELLE
 * (ApiModule, harnais d'US-043) et le FAKE du magasin (sans base) : chaque réponse est confrontée
 * à `apps/api/openapi/openapi.json`. Attendus : 19 US-314 critère 5 (l'hôte voit ses versements,
 * leurs dates et leurs gels), 08 BR-PAYOUT-02 et SM-6 (états, motifs de retenue), 17 §2.3 (co-hôte
 * ou autre hôte ⇒ 404 comme un compte inconnu). Les règles elles-mêmes (titulaire, RLS-26,
 * RLS-28, calendrier du pays) sont prouvées sur PostgreSQL : l0-us314-host-payouts, en PA et en PY.
 * Devise, exposant et calendrier : données CFG, jamais des constantes ; montants : jambe HOST des
 * vecteurs TJ01 / TJ08a de l'export des oracles.
 */
import { randomUUID } from 'node:crypto';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { afterAll, describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../cfg/index.js';
import {
  closeContractApps,
  contract,
  COUNTRIES,
  coverageOf,
  startContractApp,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import type { HostPayoutsRow } from '../internal/host-payouts.js';
import { FakeHostPayoutsStore } from './fake-host-payouts-store.js';
import { FakePayoutAccountStore } from './fake-payout-account-store.js';

const config = new CountryConfigService().config;
const golden = loadGoldenVectors();
/** Jambe HOST de la capture TJ01 (USD) ou TJ08a (PYG), choisie par la devise du pays. */
const CAPTURES = [legVector(golden, 'TJ01'), legVector(golden, 'TJ08a')];
const hostLegOf = (currency: string): bigint =>
  CAPTURES.find((v) => v.currency === currency)?.legsMinor.HOST ?? 0n;
const valueOf = (key: string, country: string): unknown =>
  config.values.find((v) => v.key === key && v.country === country)?.value ?? null;

const apps: ContractApp[] = [];

async function world(): Promise<{ app: ContractApp; store: FakeHostPayoutsStore }> {
  const store = new FakeHostPayoutsStore();
  const app = await startContractApp({
    pyo: {
      store: new FakePayoutAccountStore(),
      payouts: store,
      vault: null,
      verifier: null,
      log: { warn: () => undefined },
    },
  });
  apps.push(app);
  return { app, store };
}

function rowFor(country: string, trip: string, batches?: unknown): HostPayoutsRow {
  const entry = config.countries.get(country);
  const currency = entry?.currency.code ?? '';
  const host = hostLegOf(currency).toString();
  return {
    outcome: 'OK',
    country,
    currency,
    exponent: entry?.currency.exponent ?? null,
    schedule: {
      businessDayOffset: valueOf('payout_business_day_offset', country),
      firstPayoutBusinessDay: valueOf('first_payout_business_day', country),
      localTimeMinutes: valueOf('payout_batch_local_time', country),
      timeZone: entry?.timeZone ?? null,
    },
    batches: batches ?? [
      {
        batchId: randomUUID(),
        kind: 'FINAL',
        status: 'ON_HOLD',
        currency,
        scheduledFor: '2033-06-08T15:00:00.000Z',
        firstPayout: true,
        grossMinor: host,
        nettedMinor: '0',
        netMinor: host,
        holdReasons: ['CLAIM', 'PAYOUTS_DISABLED', 'SOME_FUTURE_REASON', 'CLAIM'],
        initiatedAt: null,
        paidAt: null,
        items: [{ tripId: trip, amountMinor: host }],
      },
    ],
  };
}

afterAll(async () => {
  await closeContractApps();
});

describe.each(COUNTRIES)('US-314 — versements lus par le titulaire (%s)', (country) => {
  it('200 : calendrier du pays et lots ; motifs lisibles (inconnu ⇒ OTHER, sans doublon) ; no-store', async () => {
    const { app, store } = await world();
    const org = randomUUID();
    const trip = randomUUID();
    store.set(app.hash('voyageur'), org, rowFor(country, trip));
    const r = await app.api.request('GET', `/host/accounts/${org}/payouts`, {
      headers: app.cookie('voyageur'),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const entry = config.countries.get(country);
    const host = hostLegOf(entry?.currency.code ?? '').toString();
    expect(r.json).toMatchObject({
      orgId: org,
      country,
      currency: entry?.currency.code,
      currencyExponent: entry?.currency.exponent,
      schedule: {
        businessDayOffset: valueOf('payout_business_day_offset', country),
        firstPayoutBusinessDay: valueOf('first_payout_business_day', country),
      },
      payouts: [
        {
          status: 'ON_HOLD',
          firstPayout: true,
          grossMinor: host,
          netMinor: host,
          holdReasons: ['CLAIM', 'PAYOUTS_DISABLED', 'OTHER'],
          trips: [{ tripId: trip, amountMinor: host }],
        },
      ],
    });
  });

  it('404 : compte d’un autre hôte, co-hôte ou inconnu (même réponse) ; identifiant mal formé ⇒ 404 sans lecture', async () => {
    const { app, store } = await world();
    const r = await app.api.request('GET', `/host/accounts/${randomUUID()}/payouts`, {
      headers: app.cookie('voyageur'),
    });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ code: 'HOST_ACCOUNT_NOT_FOUND' });
    const before = store.calls.length;
    const bad = await app.api.request('GET', '/host/accounts/not-a-uuid/payouts', {
      headers: app.cookie('voyageur'),
    });
    expect(bad.status).toBe(404);
    expect(store.calls.length).toBe(before);
  });
});

describe('US-314 — refus et fail-closed', () => {
  it('401 sans session ; 403 permission retirée de la matrice ; 503 base indisponible ou forme inattendue', async () => {
    const { app, store } = await world();
    const country = COUNTRIES[0] ?? '';
    const org = randomUUID();
    const anon = await app.api.request('GET', `/host/accounts/${org}/payouts`);
    expect(anon.status).toBe(401);

    store.set(app.hash('voyageur'), org, {
      outcome: 'PERMISSION_DENIED',
      country: null,
      currency: null,
      schedule: null,
      batches: null,
      exponent: null,
    });
    const denied = await app.api.request('GET', `/host/accounts/${org}/payouts`, {
      headers: app.cookie('voyageur'),
    });
    expect(denied.status).toBe(403);
    expect(denied.json).toMatchObject({ code: 'PAYOUTS_READ_FORBIDDEN' });

    // forme inattendue : net ≠ brut − compensation ⇒ rien n'est servi
    const odd = randomUUID();
    const row = rowFor(country, randomUUID());
    const [b] = row.batches as Record<string, unknown>[];
    store.set(app.hash('voyageur'), odd, { ...row, batches: [{ ...b, netMinor: '1' }] });
    const bad = await app.api.request('GET', `/host/accounts/${odd}/payouts`, {
      headers: app.cookie('voyageur'),
    });
    expect(bad.status).toBe(503);
    expect(bad.json).toMatchObject({ code: 'PAYOUTS_UNAVAILABLE' });

    store.failing = true;
    const down = await app.api.request('GET', `/host/accounts/${org}/payouts`, {
      headers: app.cookie('voyageur'),
    });
    expect(down.status).toBe(503);
  });
});

describe('US-314 — couverture du contrat', () => {
  it('chaque statut déclaré pour /host/accounts/{orgId}/payouts est exercé', () => {
    expect(
      missingCoverage(contract, '/host/accounts/{orgId}/payouts', coverageOf(...apps)),
    ).toEqual([]);
  });
});
