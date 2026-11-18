/**
 * US-217 partie 217a — contrat des routes `GET /trips/{tripId}/receipt` (reçu d'un trip lu par sa
 * partie) et `GET /host/accounts/{orgId}/earnings/{month}` (relevé mensuel des gains de l'hôte) sur
 * l'application RÉELLE (ApiModule, gardes globaux, durcissement HTTP ; harnais d'US-043) avec des
 * FAKE des magasins : chaque réponse est confrontée à `openapi.json`, chaque statut déclaré est
 * exercé.
 *
 * Attendus tirés de 19 US-217 critères 1 et 2 (jambe HOST, frais retenus par Kmino selon le plan
 * figé, trip fee et sa taxe, pénalité de l'hôte en ligne séparée), de 17 §2.3 point 5 (IDOR : 404,
 * même réponse) et des oracles Python (`@rueda/money/golden-vectors` : TJ01 en USD, TJ08a en PYG
 * sans décimale), jamais du code testé. La partie et le titulaire sont jugés en base et prouvés sur
 * PostgreSQL (`packages/db/test/l0/l0-us217-host-receipt.test.ts`) ; ici, les FAKE rendent ce que
 * rendrait la base et la route doit le servir tel quel, ou refuser (fail-closed).
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
import type { HostEarningsRow, HostEarningsStore } from '../internal/checkout/host-earnings.js';
import type { TripReceiptRow, TripReceiptStore } from '../internal/checkout/trip-receipt.js';

const apps: ContractApp[] = [];
afterAll(closeContractApps);

const golden = loadGoldenVectors();
const exponentOf = (currency: string): number => {
  const c = [...repoConfig.countries.values()].find((x) => x.currency.code === currency);
  if (c === undefined) throw new Error(`devise ${currency} absente de la configuration`);
  return c.currency.exponent;
};

const EVENT_AT = '2034-05-20T15:00:00.000Z';
const SETTLED_AT = '2034-05-10T15:00:00.000Z';
const MONTH = '2034-05';

const NOT_FOUND_ROW: TripReceiptRow = {
  outcome: 'NOT_FOUND',
  viewerRole: null,
  tripStatus: null,
  currency: null,
  exponent: null,
  timezone: null,
  receipt: null,
};

/** Magasin en mémoire : ce que la base rendrait à la session (empreinte) pour un trip. */
class FakeTripReceiptStore implements TripReceiptStore {
  readonly rows = new Map<string, TripReceiptRow>();
  failing = false;
  readonly seen: string[] = [];

  set(proofHex: string, tripId: string, row: TripReceiptRow): void {
    this.rows.set(`${proofHex}:${tripId}`, row);
  }

  read(proof: Buffer, tripId: string): Promise<TripReceiptRow> {
    this.seen.push(proof.toString('hex'));
    if (this.failing) return Promise.reject(new Error('base indisponible'));
    return Promise.resolve(this.rows.get(`${proof.toString('hex')}:${tripId}`) ?? NOT_FOUND_ROW);
  }
}

class FakeHostEarningsStore implements HostEarningsStore {
  readonly rows = new Map<string, HostEarningsRow>();
  failing = false;

  set(proofHex: string, orgId: string, month: string, row: HostEarningsRow): void {
    this.rows.set(`${proofHex}:${orgId}:${month}`, row);
  }

  read(proof: Buffer, orgId: string, month: string): Promise<HostEarningsRow> {
    if (this.failing) return Promise.reject(new Error('base indisponible'));
    return Promise.resolve(
      this.rows.get(`${proof.toString('hex')}:${orgId}:${month}`) ?? {
        outcome: 'FORBIDDEN',
        country: null,
        statements: null,
        exponents: null,
      },
    );
  }
}

interface World {
  readonly app: ContractApp;
  readonly receipts: FakeTripReceiptStore;
  readonly earnings: FakeHostEarningsStore;
}

async function world(): Promise<World> {
  const receipts = new FakeTripReceiptStore();
  const earnings = new FakeHostEarningsStore();
  const app = await startContractApp({ checkout: { receipts, earnings } });
  apps.push(app);
  return { app, receipts, earnings };
}

/** Reçu de l'hôte tel que la base le rend (montants de l'oracle, jamais du code testé). */
const hostReceipt = (hostLeg: bigint, base: bigint) => ({
  kind: 'EARNING',
  source: 'CAPTURE',
  settlementVersion: null,
  periodMonth: MONTH,
  eventAt: EVENT_AT,
  hostPlanCode: 'ESTÁNDAR',
  hostSharePct: '3/4',
  shareBaseMinor: base.toString(),
  kminoFeeMinor: (base - hostLeg).toString(),
  hostLegMinor: hostLeg.toString(),
  adjustments: [],
  adjustmentsMinor: '0',
  netMinor: hostLeg.toString(),
});

const guestReceipt = (total: bigint) => ({
  source: 'CAPTURE',
  settlementVersion: null,
  totalPaidMinor: total.toString(),
  refundMinor: '0',
  tripFee: {
    chargedMinor: '1800',
    taxMinor: '126',
    taxRateBps: 700,
    refundedMinor: '0',
    retainedMinor: '1800',
  },
  fiscalDocument: 'OFF_PLATFORM',
});

describe('US-217 partie 217a — reçu d’un trip lu par sa partie', () => {
  it.each(['TJ01', 'TJ08a'])(
    'critère 1 (%s) : l’hôte lit la jambe HOST et les frais retenus par Kmino, le voyageur le trip fee et sa taxe ; montants tels que la base les rend',
    async (id) => {
      const w = await world();
      const v = legVector(golden, id);
      const exponent = exponentOf(v.currency);
      const trip = randomUUID();
      const base = (v.legsMinor.HOST * 4n) / 3n;
      const row = {
        outcome: 'OK',
        tripStatus: 'COMPLETED',
        currency: v.currency,
        exponent,
        timezone: 'Etc/UTC',
      };
      w.receipts.set(w.app.hash('staff'), trip, {
        ...row,
        viewerRole: 'HOST',
        receipt: hostReceipt(v.legsMinor.HOST, base),
      });
      w.receipts.set(w.app.hash('voyageur'), trip, {
        ...row,
        viewerRole: 'GUEST',
        receipt: guestReceipt(v.totalMinor),
      });
      const host = await w.app.api.request('GET', `/trips/${trip.toUpperCase()}/receipt`, {
        headers: w.app.cookie('staff'),
      });
      expect(host.status).toBe(200);
      expect(host.headers.get('cache-control')).toBe('no-store');
      expect(host.json).toEqual({
        tripId: trip,
        viewerRole: 'HOST',
        tripStatus: 'COMPLETED',
        currency: v.currency,
        currencyExponent: exponent,
        timezone: 'Etc/UTC',
        receipt: hostReceipt(v.legsMinor.HOST, base),
      });
      const guest = await w.app.api.request('GET', `/trips/${trip}/receipt`, {
        headers: w.app.cookie('voyageur'),
      });
      expect(guest.status).toBe(200);
      expect(guest.json).toMatchObject({
        viewerRole: 'GUEST',
        receipt: guestReceipt(v.totalMinor),
      });
    },
  );

  it('critère 2 : reçu d’un trip annulé par l’hôte, jambe HOST 0 et pénalité en ligne séparée (montants signés)', async () => {
    const w = await world();
    const trip = randomUUID();
    const receipt = {
      ...hostReceipt(0n, 0n),
      kind: 'CXL_EARNING',
      source: 'SETTLEMENT',
      settlementVersion: 1,
      eventAt: SETTLED_AT,
      adjustments: [
        {
          reason: 'HOST_CANCELLATION_PENALTY',
          amountMinor: '-2500',
          periodMonth: MONTH,
          at: SETTLED_AT,
        },
      ],
      adjustmentsMinor: '-2500',
      netMinor: '-2500',
    };
    w.receipts.set(w.app.hash('staff'), trip, {
      outcome: 'OK',
      viewerRole: 'HOST',
      tripStatus: 'CANCELLED_BY_HOST',
      currency: 'XTS',
      exponent: 2,
      timezone: 'Etc/UTC',
      receipt,
    });
    const r = await w.app.api.request('GET', `/trips/${trip}/receipt`, {
      headers: w.app.cookie('staff'),
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ viewerRole: 'HOST', receipt });
  });

  it('IDOR et saisie : tiers, trip inconnu ou identifiant mal formé ⇒ même 404 ; sans capture ni règlement ⇒ 409 ; sans session ⇒ 401', async () => {
    const w = await world();
    const trip = randomUUID();
    w.receipts.set(w.app.hash('voyageur'), trip, {
      ...NOT_FOUND_ROW,
      outcome: 'NO_RECEIPT',
      viewerRole: 'GUEST',
      tripStatus: 'BOOKED',
      currency: 'XTS',
      timezone: 'Etc/UTC',
    });
    const notReady = await w.app.api.request('GET', `/trips/${trip}/receipt`, {
      headers: w.app.cookie('voyageur'),
    });
    expect(notReady.status).toBe(409);
    expect(notReady.json).toEqual({
      code: 'RECEIPT_NOT_READY',
      messageKey: 'common.receipt.notReady',
    });
    const notFound = { code: 'RECEIPT_NOT_FOUND', messageKey: 'common.receipt.notFound' };
    for (const [path, headers] of [
      [`/trips/${trip}/receipt`, w.app.cookie('staff')],
      [`/trips/${randomUUID()}/receipt`, w.app.cookie('voyageur')],
      ['/trips/pas-un-uuid/receipt', w.app.cookie('voyageur')],
    ] as const) {
      const r = await w.app.api.request('GET', path, { headers });
      expect(r.status, path).toBe(404);
      expect(r.json).toEqual(notFound);
    }
    const anonymous = await w.app.api.request('GET', `/trips/${trip}/receipt`);
    expect(anonymous.status).toBe(401);
    // l'empreinte transmise au magasin est celle du jeton de session (jamais un identifiant reçu)
    const token = w.app.h.sessions.voyageur.token;
    expect(w.receipts.seen).toContain(createHash('sha256').update(token, 'utf8').digest('hex'));
  });

  it('fail-closed : base indisponible, aucun adaptateur, clé de trop, montant ou forme inattendus ⇒ 503, rien de servi', async () => {
    const w = await world();
    const trip = randomUUID();
    const hash = w.app.hash('staff');
    const headers = w.app.cookie('staff');
    const path = `/trips/${trip}/receipt`;
    const good = hostReceipt(13125n, 17500n);
    const base: TripReceiptRow = {
      outcome: 'OK',
      viewerRole: 'HOST',
      tripStatus: 'COMPLETED',
      currency: 'XTS',
      exponent: 2,
      timezone: 'Etc/UTC',
      receipt: good,
    };
    const guestBase: TripReceiptRow = {
      ...base,
      viewerRole: 'GUEST',
      receipt: guestReceipt(25666n),
    };
    const fee = guestReceipt(25666n).tripFee;
    for (const row of [
      { ...base, receipt: { ...good, hostLegMinor: '1.5' } },
      { ...base, receipt: { ...good, hostLegMinor: '-1' } },
      { ...base, receipt: { ...good, hostLegMinor: null } },
      { ...base, receipt: { ...good, kind: 'COMMISSION' } },
      { ...base, receipt: { ...good, settlementVersion: 1 } },
      { ...base, receipt: { ...good, periodMonth: '2034-13' } },
      { ...base, receipt: { ...good, hostSharePct: '75%' } },
      { ...base, receipt: { ...good, guestName: 'Ana' } },
      { ...base, receipt: { ...good, adjustments: [{ reason: 'FEE', amountMinor: '-1' }] } },
      { ...base, receipt: 'x' },
      { ...base, exponent: null },
      { ...base, timezone: 'UTC; DROP' },
      { ...base, viewerRole: 'STAFF' },
      { ...base, outcome: 'MAYBE' },
      { ...guestBase, receipt: { ...guestReceipt(25666n), fiscalDocument: 'PAC' } },
      { ...guestBase, receipt: { ...guestReceipt(25666n), hostLegMinor: '13125' } },
      { ...guestBase, receipt: { ...guestReceipt(25666n), tripFee: { ...fee, taxRateBps: 1.5 } } },
      { ...guestBase, receipt: { ...guestReceipt(25666n), refundMinor: '-1' } },
    ] as TripReceiptRow[]) {
      w.receipts.set(hash, trip, row);
      const r = await w.app.api.request('GET', path, { headers });
      expect(r.status, JSON.stringify(row)).toBe(503);
      expect(r.json).toEqual({
        code: 'RECEIPT_UNAVAILABLE',
        messageKey: 'common.receipt.unavailable',
      });
    }
    w.receipts.failing = true;
    expect((await w.app.api.request('GET', path, { headers })).status).toBe(503);
    const bare = await startContractApp();
    apps.push(bare);
    const none = await bare.api.request('GET', `/trips/${randomUUID()}/receipt`, {
      headers: bare.cookie('voyageur'),
    });
    expect(none.status).toBe(503);
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/receipt est exercé', () => {
    expect(
      missingCoverage(contract, '/trips/{tripId}/receipt', coverageOf(...apps)),
      'statuts',
    ).toEqual([]);
  });
});

describe('US-217 partie 217a — relevé mensuel des gains de l’hôte', () => {
  const statement = (hostLeg: bigint, currency: string) => ({
    currency,
    tripsCount: 2,
    hostLegMinor: hostLeg.toString(),
    adjustmentsMinor: '-2500',
    netMinor: (hostLeg - 2500n).toString(),
    lines: [
      {
        kind: 'EARNING',
        tripId: '0b6f3f6e-6d0a-4a57-9a8e-1f2d3c4b5a69',
        tripStatus: 'COMPLETED',
        source: 'CAPTURE',
        settlementVersion: null,
        reason: null,
        eventAt: EVENT_AT,
        amountMinor: hostLeg.toString(),
        shareBaseMinor: null,
        kminoFeeMinor: null,
        hostPlanCode: null,
        hostSharePct: null,
      },
      {
        kind: 'CXL_EARNING',
        tripId: '1c7a4a7f-7e1b-4b68-8b9f-2a3e4d5c6b7a',
        tripStatus: 'CANCELLED_BY_HOST',
        source: 'SETTLEMENT',
        settlementVersion: 1,
        reason: null,
        eventAt: SETTLED_AT,
        amountMinor: '0',
        shareBaseMinor: '0',
        kminoFeeMinor: '0',
        hostPlanCode: null,
        hostSharePct: null,
      },
      {
        kind: 'ADJUSTMENT',
        tripId: '1c7a4a7f-7e1b-4b68-8b9f-2a3e4d5c6b7a',
        tripStatus: 'CANCELLED_BY_HOST',
        source: 'HOST_LEDGER',
        settlementVersion: 1,
        reason: 'HOST_CANCELLATION_PENALTY',
        eventAt: SETTLED_AT,
        amountMinor: '-2500',
        shareBaseMinor: null,
        kminoFeeMinor: null,
        hostPlanCode: null,
        hostSharePct: null,
      },
    ],
  });

  it.each(['TJ01', 'TJ08a'])(
    'critères 2 et 3 (%s) : Σ jambes HOST, pénalité en ligne séparée, net ; exposant de la devise joint',
    async (id) => {
      const w = await world();
      const v = legVector(golden, id);
      const org = randomUUID();
      const s = statement(v.legsMinor.HOST, v.currency);
      w.earnings.set(w.app.hash('staff'), org, MONTH, {
        outcome: 'OK',
        country: 'XA',
        statements: [s],
        exponents: { [v.currency]: exponentOf(v.currency) },
      });
      const r = await w.app.api.request('GET', `/host/accounts/${org}/earnings/${MONTH}`, {
        headers: w.app.cookie('staff'),
      });
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.json).toEqual({
        orgId: org,
        month: MONTH,
        country: 'XA',
        statements: [{ ...s, currencyExponent: exponentOf(v.currency) }],
      });
    },
  );

  it('IDOR et saisie : compte d’autrui, inconnu ou mal formé ⇒ même 404 ; mois mal formé ⇒ 400 ; sans session ⇒ 401', async () => {
    const w = await world();
    const org = randomUUID();
    w.earnings.set(w.app.hash('staff'), org, MONTH, {
      outcome: 'OK',
      country: 'XA',
      statements: [],
      exponents: {},
    });
    const own = await w.app.api.request('GET', `/host/accounts/${org}/earnings/${MONTH}`, {
      headers: w.app.cookie('staff'),
    });
    expect(own.status).toBe(200);
    expect(own.json).toMatchObject({ statements: [] });
    const notFound = { code: 'EARNINGS_NOT_FOUND', messageKey: 'common.earnings.notFound' };
    for (const [path, headers] of [
      [`/host/accounts/${org}/earnings/${MONTH}`, w.app.cookie('voyageur')],
      [`/host/accounts/${randomUUID()}/earnings/${MONTH}`, w.app.cookie('staff')],
      [`/host/accounts/pas-un-uuid/earnings/${MONTH}`, w.app.cookie('staff')],
    ] as const) {
      const r = await w.app.api.request('GET', path, { headers });
      expect(r.status, path).toBe(404);
      expect(r.json).toEqual(notFound);
    }
    for (const month of ['2034-13', '2034-5', 'mai-2034']) {
      const r = await w.app.api.request('GET', `/host/accounts/${org}/earnings/${month}`, {
        headers: w.app.cookie('staff'),
      });
      expect(r.status, month).toBe(400);
      expect(r.json).toEqual({ code: 'REQUEST_INVALID', messageKey: 'common.auth.requestInvalid' });
    }
    const anonymous = await w.app.api.request('GET', `/host/accounts/${org}/earnings/${MONTH}`);
    expect(anonymous.status).toBe(401);
  });

  it('fail-closed : base indisponible, aucun adaptateur, devise sans exposant, ligne inattendue ⇒ 503', async () => {
    const w = await world();
    const org = randomUUID();
    const path = `/host/accounts/${org}/earnings/${MONTH}`;
    const headers = w.app.cookie('staff');
    const good = statement(13125n, 'XTS');
    const [earning, cxl, adjustment] = good.lines;
    for (const statements of [
      [{ ...good, hostLegMinor: '-1' }],
      [{ ...good, tripsCount: -1 }],
      [{ ...good, lines: [{ ...earning, amountMinor: '-1' }] }],
      [{ ...good, lines: [{ ...earning, kind: 'COMMISSION' }] }],
      [{ ...good, lines: [{ ...cxl, reason: 'HOST_CANCELLATION_PENALTY' }] }],
      [{ ...good, lines: [{ ...adjustment, reason: null }] }],
      [{ ...good, lines: [{ ...adjustment, source: 'CAPTURE' }] }],
      [{ ...good, lines: [{ ...earning, guestName: 'Ana' }] }],
      [{ ...good, currency: 'XTA' }],
      'x',
    ]) {
      w.earnings.set(w.app.hash('staff'), org, MONTH, {
        outcome: 'OK',
        country: 'XA',
        statements,
        exponents: { XTS: 2 },
      });
      const r = await w.app.api.request('GET', path, { headers });
      expect(r.status, JSON.stringify(statements)).toBe(503);
      expect(r.json).toEqual({
        code: 'EARNINGS_UNAVAILABLE',
        messageKey: 'common.earnings.unavailable',
      });
    }
    w.earnings.failing = true;
    expect((await w.app.api.request('GET', path, { headers })).status).toBe(503);
    const bare = await startContractApp();
    apps.push(bare);
    const none = await bare.api.request('GET', path, { headers: bare.cookie('staff') });
    expect(none.status).toBe(503);
  });

  it('couverture : chaque statut déclaré pour /host/accounts/{orgId}/earnings/{month} est exercé', () => {
    expect(
      missingCoverage(contract, '/host/accounts/{orgId}/earnings/{month}', coverageOf(...apps)),
      'statuts',
    ).toEqual([]);
  });
});
