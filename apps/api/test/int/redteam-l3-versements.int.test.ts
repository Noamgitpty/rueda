/**
 * US-313 — red team du lot 3, axe « versements » de bout en bout (19 US-313 critère 3 : scénarios de
 * l'ex-porte LB ; pré-mortem du lot 3, RT-L3-V01, V03 ; risques L3-PM-30, L3-PM-33). PostgreSQL
 * réel, rôles de PRODUCTION (`open` : assertion L0-05 en tête, une connexion par transaction), PSP
 * `FAKE` de `@rueda/fake-adapters` aux compteurs d'appels réels, dans chaque pays configuré : USD
 * (deux décimales) et PYG (sans décimale). TESTS SEULEMENT : aucun correctif, aucune migration,
 * aucune fixture. Rapport : docs/team/redteam/L3-versements.md.
 *
 * Ce que les preuves existantes ne couvrent pas : l'ordonnanceur de versement (`PayoutScheduler`,
 * US-708) est éprouvé contre une MÉMOIRE (`pyo/testing/payout-scheduler.test.ts`) et la base contre
 * des commandes SQL isolées (L0) ; ici, le VRAI stockage PostgreSQL (`PgPayoutBatchStore`) et le
 * VRAI ordonnanceur pilotent un `FAKE` dont on lit les compteurs.
 *
 * Attendus (jamais le code testé) : 19 US-313 critère 3 (« aucun appel `payout` n'est émis ») ; 17
 * §0.1 (`payouts_enabled` lu en base, absent ⇒ `false` ; fermé ici : état de production) ; 08
 * BR-PAYOUT-02 et SM-6 (un lot par trip, aucun versement tant que l'interrupteur est fermé) ; jambe
 * HOST encaissée = vecteur de capture de l'export des oracles (TJ01 en USD, TJ08a en PYG).
 *
 * Données : trip VALIDÉ par scénario (horloge virtuelle 2092 et 2093, une année par scénario ;
 * aucune autre série de la base ne les utilise), décalé de 30 jours par pays. Aucun compte global :
 * chaque lecture est bornée au trip ou au lot du test. `payouts_enabled` n'est JAMAIS ouvert (même
 * pas dans une transaction annulée : l'ordonnanceur valide ses transactions).
 */
import { FakePsp, FakePspError } from '@rueda/fake-adapters';
import type { FakeCapability } from '@rueda/fake-adapters';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { CapabilitySet, PaymentError } from '../../src/modules/pay/index.js';
import type {
  AdjustPayoutRequest,
  PaymentConnectorRegistry,
  PaymentProvider,
  PayoutRequest,
  ProviderOperation,
  ReleaseLegRequest,
} from '../../src/modules/pay/index.js';
import { PayoutScheduler } from '../../src/modules/pyo/index.js';
import type { DueBatch, PayoutBatchStep } from '../../src/modules/pyo/index.js';
import {
  ALL_CLOSED,
  CASES,
  DAY,
  capturedTripIn,
  inTx,
  legsOf,
  iso,
  open,
  sum,
  switches,
  TestTransactions,
  type Case,
} from '../support/redteam-l2.js';

const PROVIDER = 'FAKE';
const v = (capability: string, value: boolean | number): FakeCapability => ({
  capability,
  method: '*',
  value,
  status: 'VALIDATED_SANDBOX',
});
/** Matrice complète : le FAKE honnête sait tout faire, seul l'INTERRUPTEUR de la base retient. */
const CAPABILITIES: readonly FakeCapability[] = [
  v('SUPPORTS_PER_LEG_AMOUNTS', true),
  v('SUPPORTS_MULTI_LEG_SPLIT', true),
  v('SUPPORTS_DELAYED_PAYOUT_RELEASE', true),
  v('SUPPORTS_B2C_PAYOUT', true),
  v('SUPPORTS_SUBMERCHANT', true),
  v('SUPPORTS_INDIVIDUAL_SUBMERCHANT', true),
  v('SUPPORTS_LOOKUP_BY_MERCHANT_REF', true),
  v('SUPPORTS_IDEMPOTENCY_HEADER', true),
  v('IDEMPOTENCY_KEY_MAX_LEN', 64),
  v('SUPPORTS_PAYOUT_ADJUSTMENT', true),
];

function translate(error: unknown): never {
  if (error instanceof FakePspError) {
    if (error.kind === 'TIMEOUT' || error.kind === 'UNREADABLE') {
      throw new PaymentError('UNKNOWN_OUTCOME', error.message);
    }
    if (error.kind === 'UNAVAILABLE') throw new PaymentError('PROVIDER_UNAVAILABLE', error.message);
    if (error.kind === 'DECLINED') throw new PaymentError('DECLINED', error.message);
    throw new PaymentError('INVALID_REQUEST', error.message);
  }
  throw error;
}
const statusOf = (s: string): 'SUBMITTED' | 'SUCCEEDED' | 'FAILED' =>
  s === 'CREATED' ? 'SUBMITTED' : s === 'SUCCEEDED' || s === 'AUTHORIZED' ? 'SUCCEEDED' : 'FAILED';

/** Connecteur minimal : les seules méthodes du versement, sur le FAKE (copie du test unitaire d'US-708). */
function connectorOf(psp: FakePsp): PaymentProvider {
  const caps = new CapabilitySet(CAPABILITIES);
  const run = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      return translate(error);
    }
  };
  const impl = {
    provider: PROVIDER,
    capabilities: () => caps,
    releaseLeg: (r: ReleaseLegRequest) =>
      Promise.resolve(
        run(() => {
          const tx = psp.releaseLeg({
            merchantReference: r.idempotencyKey,
            tripReference: r.tripReference,
            leg: r.leg,
            amountMinor: r.amountMinor,
            currency: r.currency,
            beneficiaryReference: r.beneficiaryReference,
          });
          return { providerReference: tx.reference, status: statusOf(tx.status) };
        }),
      ),
    payout: (r: PayoutRequest) =>
      Promise.resolve(
        run(() => {
          const tx = psp.payout({
            merchantReference: r.idempotencyKey,
            submerchantReference: r.submerchantReference,
            amountMinor: r.amountMinor,
            currency: r.currency,
          });
          return { providerReference: tx.reference, status: statusOf(tx.status) };
        }),
      ),
    adjustPayout: (r: AdjustPayoutRequest) =>
      Promise.resolve(
        run(() => {
          const tx = psp.adjustPayout({
            merchantReference: r.idempotencyKey,
            submerchantReference: r.submerchantReference,
            amountMinor: r.amountMinor,
            currency: r.currency,
            reason: r.reason,
          });
          return { providerReference: tx.reference, status: statusOf(tx.status) };
        }),
      ),
    getOperation: (lookup: { merchantReference?: string; providerReference?: string }) =>
      Promise.resolve(
        run((): ProviderOperation | null => {
          const tx = psp.lookup(
            lookup.merchantReference !== undefined
              ? { merchantReference: lookup.merchantReference }
              : { reference: lookup.providerReference ?? '' },
          );
          return tx === null
            ? null
            : {
                providerReference: tx.reference,
                merchantReference: tx.merchantReference,
                status: statusOf(tx.status),
                amountMinor: tx.amountMinor,
                currency: tx.currency,
                legs: null,
              };
        }),
      ),
  };
  return impl as unknown as PaymentProvider;
}

/** Fin effective d'un scénario (année propre, décalée de 30 jours par pays). */
const endOf = (year: number, c: Case): number =>
  Date.UTC(year, 2, 6, 20, 0, 0) + c.index * 30 * DAY;

async function setNow(tx: pg.ClientBase, ms: number): Promise<void> {
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso(ms)]);
}

/**
 * Trip capturé aux jambes de l'oracle (vraie commande, preuve signée, report), compte de versement
 * vérifié, terminé à `end` (fixture 9921, même ligne RETURNED que la remise). VALIDÉ.
 */
async function completedTrip(year: number, c: Case): Promise<{ trip: string; end: number }> {
  const end = endOf(year, c);
  const worker = await open('app_worker');
  const trip = await inTx(
    worker,
    { worker: 'payment_command', at: iso(end - 10 * DAY), commit: true },
    async (tx) => {
      const w = await capturedTripIn(tx, c, end - 3 * DAY, 3);
      await tx.query('SELECT test_fixture.us708_holiday($1, $2::date)', [
        c.country,
        `${String(year)}-01-01`,
      ]);
      await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [w.trip]);
      await setNow(tx, end);
      await tx.query('SELECT test_fixture.us708_complete_trip($1)', [w.trip]);
      return w.trip;
    },
  );
  return { trip, end };
}

interface BatchRow {
  readonly id: string;
  readonly status: string;
  readonly hold_reasons: string[];
}
async function batchesOf(trip: string): Promise<BatchRow[]> {
  const worker = await open('app_worker');
  return inTx(
    worker,
    { worker: 'payment_command' },
    async (tx) =>
      (
        await tx.query<BatchRow>(
          'SELECT id, status, hold_reasons FROM test_fixture.us708_batches($1)',
          [trip],
        )
      ).rows,
  );
}
async function itemsOf(trip: string): Promise<number> {
  const worker = await open('app_worker');
  return inTx(
    worker,
    { worker: 'payment_command' },
    async (tx) =>
      (await tx.query('SELECT * FROM test_fixture.us708_items($1)', [trip])).rowCount ?? -1,
  );
}
async function releaseOrders(trip: string): Promise<number> {
  const worker = await open('app_worker');
  return inTx(worker, { worker: 'payment_command' }, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      `SELECT pg_catalog.count(*)::int AS n FROM core.payment_payment_operation
        WHERE trip_id = $1 AND kind = 'LEG_RELEASE'`,
      [trip],
    );
    return rows[0]?.n ?? -1;
  });
}

/** Faits du trip (travailleur reconciliation) : capturé = encaissé = Σ des jambes des encaissements. */
async function legInvariant(trip: string, captured: bigint): Promise<void> {
  const worker = await open('app_worker');
  await inTx(worker, { worker: 'reconciliation' }, async (tx) => {
    const { rows } = await tx.query<{
      captured: string;
      collected: string | null;
      collected_legs: string | null;
    }>(
      `SELECT captured_minor::text AS captured, collected_minor::text AS collected,
              collected_legs_minor::text AS collected_legs
         FROM core.finance_trip_leg_facts() WHERE trip_id = $1::uuid`,
      [trip],
    );
    expect(rows).toEqual([
      {
        captured: captured.toString(),
        collected: captured.toString(),
        collected_legs: captured.toString(),
      },
    ]);
  });
}

function rig(atMs: number) {
  const psp = new FakePsp({
    secret: 'whsec_fake_test_only',
    clock: () => atMs,
    capabilities: CAPABILITIES,
  });
  const connector = connectorOf(psp);
  const connectors: PaymentConnectorRegistry = {
    get: (p) => (p === PROVIDER ? connector : undefined),
  };
  const scheduler = new PayoutScheduler({
    transactions: new TestTransactions(atMs),
    connectors,
  });
  return { psp, scheduler };
}

const dueOf = (batchId: string, step: DueBatch['step'], c: Case): DueBatch => ({
  batchId,
  step,
  status: 'ON_HOLD',
  country: c.country,
  currency: c.currency,
  provider: PROVIDER,
});

describe.each(CASES)('RT-L3 versements contre le FAKE ($country, $currency)', (c: Case) => {
  const capture = legsOf(c.journey.capture);

  it('RT-L3-V01 (L3-PM-30) : payouts_enabled = false ⇒ préparation, compensation, libération et versement jouent contre le VRAI stockage PostgreSQL : lot ON_HOLD (PAYOUTS_DISABLED), AUCUN appel du FAKE (payout, releaseLeg, ajustement, lecture), aucun ordre LEG_RELEASE, lot jamais émis', async () => {
    const { trip, end } = await completedTrip(2092, c);
    // état de production : l'interrupteur est fermé (lu en base)
    const probe = await open('app_worker');
    await inTx(probe, {}, async (tx) => {
      expect(await switches(tx, c.country)).toEqual(ALL_CLOSED);
    });
    // fenêtre bien après l'échéance du lot (premier versement : 5ᵉ jour ouvré, 10:00 locale)
    const { psp, scheduler } = rig(end + 14 * DAY);

    expect(await scheduler.prepare(trip)).toBe('PREPARED');
    const [batch, ...others] = await batchesOf(trip);
    expect(others).toEqual([]);
    expect(batch?.status).toBe('ON_HOLD');
    expect(batch?.hold_reasons).toContain('PAYOUTS_DISABLED');
    const id = batch?.id ?? '';

    // chaque étape, plusieurs fois (rejeu, deux travailleurs) : retenue, jamais d'envoi
    const steps: PayoutBatchStep[] = [];
    for (const step of ['NET', 'RELEASE', 'PAYOUT', 'RELEASE', 'PAYOUT', 'NET'] as const) {
      steps.push(await scheduler.process(dueOf(id, step, c)));
    }
    for (const s of steps) expect(['ON_HOLD', 'IDLE'], steps.join()).toContain(s);

    // le compteur d'appels du FAKE : zéro, y compris les lectures
    expect(psp.calls('PAYOUT')).toBe(0);
    expect(psp.calls('RELEASE_LEG')).toBe(0);
    expect(psp.calls('ADJUST_PAYOUT')).toBe(0);
    expect(psp.calls('LOOKUP')).toBe(0);
    expect(psp.totalCalls()).toBe(0);
    // la base : un lot retenu, aucune libération, aucun lot émis
    const after = await batchesOf(trip);
    expect(after.map((b) => [b.id, b.status])).toEqual([[id, 'ON_HOLD']]);
    expect(await releaseOrders(trip)).toBe(0);

    // invariant par jambe du trip (US-217) : Σ capturé = Σ encaissé = Σ jambes des encaissements
    await legInvariant(trip, sum(capture));
  });

  it('RT-L3-V03 (L3-PM-33) : versement doublé — deux préparations CONCURRENTES du même trip (deux travailleurs, deux connexions) ⇒ un seul lot, un seul item ; rejeu ⇒ ALREADY_PREPARED ; compteurs du FAKE à zéro', async () => {
    const { trip, end } = await completedTrip(2093, c);
    const a = rig(end + 14 * DAY);
    const b = rig(end + 14 * DAY);
    const outcomes = await Promise.all([a.scheduler.prepare(trip), b.scheduler.prepare(trip)]);
    expect([...outcomes].sort()).toEqual(['ALREADY_PREPARED', 'PREPARED']);
    // rejeu plus tard, par un troisième ordonnanceur
    expect(await rig(end + 15 * DAY).scheduler.prepare(trip)).toBe('ALREADY_PREPARED');
    expect(await batchesOf(trip)).toHaveLength(1);
    expect(await itemsOf(trip)).toBe(1);
    expect(a.psp.totalCalls() + b.psp.totalCalls()).toBe(0);
  });
});
