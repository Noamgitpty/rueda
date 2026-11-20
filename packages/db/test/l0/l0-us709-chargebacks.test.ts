/**
 * US-709 (migration 0167, ADR-187) — imputation des chargebacks perdus, gel et dégel, garde du
 * host_ledger (19 US-709 critères 1 et 2 ; 08 E5, E7 règle 7 ; N-402, N-415 ; pré-mortem
 * L3-PM-39 à L3-PM-41 ; red team RT-L3-V07, RT-L3-V08), sous les rôles de PRODUCTION (`withRole` :
 * assertion L0-05 en tête), travailleur `payment_command`, en USD (PA) et en PYG sans décimale (PY) ;
 * chaque transaction est ANNULÉE.
 *
 * - Critère 1 : T53 (USD) ⇒ reprise 45,00 sur HOST seule, jambes TJ14a, créance du voyageur 187,44,
 *   perte 24,22 ; T55 (PYG débité en USD, montant perdu ramené à 359 513 PYG par l'ingestion) ⇒
 *   reprise 220 752 PYG au host_ledger PYG, PLATFORM −138 761, AUCUNE écriture dans une autre
 *   devise ; T54 (a) / (b) ⇒ 0,00 / 25,50.
 * - Critère 2 : TJ14b, trip réalisé sans versement émis ⇒ aucune reprise, toute la perte sur
 *   PLATFORM, lot dégelé (motif CHARGEBACK levé), INSURER jamais réduite.
 * - Gel et dégel (N-415) : ouvert ⇒ HOST et INSURER gelées ; gagné ⇒ dégel, sauf autre chargeback
 *   ouvert ; perdu et imputé ⇒ dégel ; faits incomplets (remboursement en vol) ⇒ rien d'imputé,
 *   gel conservé, contrôle FIN CHARGEBACK_UNIMPUTED rouge ; une imputation par chargeback (rejeu).
 * - Garde « crédit ≤ dette » (L3-PM-42) ; aucune commande exécutable par un rôle applicatif.
 *
 * Attendus : contrôles de l'export des oracles (`check_t49plus.py` : T53, T54, T55 ;
 * `check_legs.py` : TJ14a, TJ14b) ; entrées : vecteurs de règlement T03 / T27 et de capture TJ01 /
 * TJ08a de l'export ; jamais le code testé.
 */
import { checksFor, legVector, settlementVector } from '@rueda/money/golden-vectors';
import type { GoldenValue } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  applySignedStatus,
  caught,
  insertAccount,
  insertTrip,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { golden } from '../support/settlement.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const CAPTURE_REF: Readonly<Record<string, string>> = { USD: 'TJ01', PYG: 'TJ08a' };
const SETTLEMENT_REF: Readonly<Record<string, string>> = { USD: 'T03', PYG: 'T27' };

function expected(vectorId: string, label: string): GoldenValue {
  const c = checksFor(golden, vectorId).find((x) => x.vectorId === vectorId && x.label === label);
  if (c === undefined) throw new Error(`contrôle absent : ${vectorId} « ${label} »`);
  return c.expected;
}

const asPayments = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command', deploymentEnv: 'test' }, fn),
  );

interface Freeze {
  readonly frozen: boolean;
  readonly frozen_reason: string | null;
}
async function freezeOf(tx: Tx, trip: string, leg: string): Promise<Freeze | null> {
  const { rows } = await tx.query<Freeze>('SELECT * FROM test_fixture.us222d_leg_freeze($1, $2)', [
    trip,
    leg,
  ]);
  return rows[0] ?? null;
}
const FROZEN: Freeze = { frozen: true, frozen_reason: 'CHARGEBACK' };
const FREE: Freeze = { frozen: false, frozen_reason: null };

interface Imputation {
  readonly earnings_kind: string;
  readonly lost_trip_minor: string;
  readonly clawback_minor: string;
  readonly guest_receivable_minor: string;
  readonly loss_expense_minor: string;
  readonly host_leg_minor: string;
  readonly insurer_leg_minor: string;
  readonly tax_third_party_leg_minor: string;
  readonly platform_leg_minor: string;
  readonly currency: string;
}
async function imputationOf(tx: Tx, op: string): Promise<Imputation | null> {
  const { rows } = await tx.query<Imputation>('SELECT * FROM test_fixture.us709_imputation($1)', [
    op,
  ]);
  return rows[0] ?? null;
}
const legsOfImputation = (i: Imputation | null): Record<string, bigint> => ({
  HOST: BigInt(i?.host_leg_minor ?? 'NaN'),
  INSURER: BigInt(i?.insurer_leg_minor ?? 'NaN'),
  TAX_THIRD_PARTY: BigInt(i?.tax_third_party_leg_minor ?? 'NaN'),
  PLATFORM: BigInt(i?.platform_leg_minor ?? 'NaN'),
});

interface Entry {
  readonly reason: string;
  readonly amount_minor: string;
  readonly currency: string;
  readonly chargeback_operation_id: string | null;
  readonly payout_batch_id: string | null;
}
async function ledgerOf(tx: Tx, trip: string): Promise<Entry[]> {
  const { rows } = await tx.query<Entry>(
    `SELECT reason, amount_minor, currency, chargeback_operation_id, payout_batch_id
       FROM test_fixture.us709_ledger($1)`,
    [trip],
  );
  return rows;
}
interface State {
  readonly currency: string;
  readonly state: string;
  readonly balance_minor: string;
  readonly next_action_set: boolean;
}
async function stateOf(tx: Tx, trip: string): Promise<State[]> {
  const { rows } = await tx.query<State>(
    'SELECT currency, state, balance_minor, next_action_set FROM test_fixture.us709_state($1)',
    [trip],
  );
  return rows;
}

/** Faits du contrôle FIN (travailleur reconciliation), dans un point de sauvegarde. */
async function unimputed(tx: Tx, country: string): Promise<number> {
  await tx.query('SAVEPOINT us709_fin');
  await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'reconciliation', true)`);
  const { rows } = await tx.query<{ n: number }>(
    `SELECT pg_catalog.count(*)::int AS n FROM core.finance_chargeback_facts()
      WHERE country_code = $1 AND NOT imputed`,
    [country],
  );
  await tx.query('ROLLBACK TO SAVEPOINT us709_fin');
  return rows[0]?.n ?? -1;
}

interface World {
  readonly trip: string;
  readonly psp: string;
}

/**
 * Trip encaissé par les vraies commandes (une capture aux jambes données) sur le compte PSP `psp`
 * (un seul compte ACTIVE par pays et par transaction).
 */
async function capturedTrip(tx: Tx, c: CountryCase, capture: Legs, psp: string): Promise<World> {
  const trip = await insertTrip(tx, c);
  const { operation_id: op } = await recordOperation(tx, {
    tripId: trip,
    accountId: psp,
    kind: 'CAPTURE',
    amountMinor: sum(capture),
    currency: c.currency,
    idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
    legs: capture,
  });
  expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
  const moved = await tx.query<{ r: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
    [op],
  );
  expect(moved.rows[0]?.r).toBe('APPLIED');
  return { trip, psp };
}

async function chargeback(tx: Tx, w: World, amount: bigint, currency: string): Promise<string> {
  const { operation_id: id } = await recordOperation(tx, {
    tripId: w.trip,
    accountId: w.psp,
    kind: 'CHARGEBACK',
    amountMinor: amount,
    currency,
    idemPlain: `trip:${w.trip}:CHARGEBACK:${uuid()}`,
    legs: null,
  });
  return id;
}

/**
 * Trip annulé par le voyageur (règlement T03 / T27 de l'export), encaissé (TJ01 / TJ08a),
 * remboursé, part de l'hôte `paid` déjà versée par un lot PAYÉ (0 : aucun lot).
 */
async function cancelledTrip(tx: Tx, c: CountryCase, paid: bigint, psp: string): Promise<World> {
  const s = settlementVector(golden, SETTLEMENT_REF[c.currency] ?? '');
  const capture: Legs = { ...legVector(golden, CAPTURE_REF[c.currency] ?? '').legsMinor };
  const w = await capturedTrip(tx, c, capture, psp);
  await tx.query('SELECT test_fixture.us709_settlement($1, $2, $3, $4, $5)', [
    w.trip,
    'CANCELLATION',
    s.trip.totalPaidMinor.toString(),
    s.expected.guestRefundMinor.toString(),
    s.expected.hostFromGuestMinor.toString(),
  ]);
  await tx.query('SELECT test_fixture.us709_refunded($1, $2)', [
    w.trip,
    s.expected.guestRefundMinor.toString(),
  ]);
  if (paid > 0n) {
    await tx.query('SELECT test_fixture.us709_paid_item($1, $2, $3)', [
      w.trip,
      w.psp,
      paid.toString(),
    ]);
  }
  return w;
}

describe('US-709 — critère 1 : T53 (USD) — chargeback perdu sur la capture entière après remboursement', () => {
  const c = COUNTRIES.find((x) => x.currency === 'USD');
  if (c === undefined) throw new Error('aucun pays en USD');
  const s = settlementVector(golden, 'T03');
  const [clawback, oldFormula, guest, loss] = expected(
    'T53',
    'T53 reprise / ancienne / double remb / perte',
  ) as bigint[];

  it('reprise 45,00 (et non 166,85) sur HOST seule, jambes TJ14a, créance du voyageur 187,44, perte 24,22 ; dégel ; une seule imputation au rejeu', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const w = await cancelledTrip(tx, c, s.expected.hostFromGuestMinor, psp);
      const before = await unimputed(tx, c.country);
      const cb = await chargeback(tx, w, s.trip.totalPaidMinor, c.currency);
      for (const leg of ['HOST', 'INSURER'])
        expect(await freezeOf(tx, w.trip, leg)).toEqual(FROZEN);
      for (const leg of ['TAX_THIRD_PARTY', 'PLATFORM']) {
        expect(await freezeOf(tx, w.trip, leg)).toEqual(FREE);
      }
      expect(await applySignedStatus(tx, cb, 'SUCCEEDED')).toBe('APPLIED');

      const i = await imputationOf(tx, cb);
      expect(i).toMatchObject({ earnings_kind: 'CANCELLATION', currency: c.currency });
      expect(BigInt(i?.clawback_minor ?? '-1')).toBe(clawback);
      expect(BigInt(i?.clawback_minor ?? '-1')).not.toBe(oldFormula);
      expect(BigInt(i?.guest_receivable_minor ?? '-1')).toBe(guest);
      expect(BigInt(i?.loss_expense_minor ?? '-1')).toBe(loss);
      expect(legsOfImputation(i)).toEqual({ ...legVector(golden, 'TJ14a').legsMinor });

      // reprise au host_ledger[hôte][USD] seulement ; la créance du voyageur n'y est jamais
      expect(await ledgerOf(tx, w.trip)).toEqual([
        {
          reason: 'CHARGEBACK_CLAWBACK',
          amount_minor: (-clawback!).toString(),
          currency: c.currency,
          chargeback_operation_id: cb,
          payout_batch_id: null,
        },
      ]);
      expect(await stateOf(tx, w.trip)).toEqual([
        {
          currency: c.currency,
          state: 'NEGATIVE',
          balance_minor: (-clawback!).toString(),
          next_action_set: true,
        },
      ]);
      // décidé : HOST et INSURER dégelées ; contrôle FIN : imputé
      for (const leg of ['HOST', 'INSURER']) expect(await freezeOf(tx, w.trip, leg)).toEqual(FREE);
      expect(await unimputed(tx, c.country)).toBe(before);

      // rejeu de la preuve (webhook rejoué, refusé ou sans effet) : aucune seconde imputation
      await caught(tx, () => applySignedStatus(tx, cb, 'SUCCEEDED'));
      expect(await ledgerOf(tx, w.trip)).toHaveLength(1);
    });
  });

  it('T54 : chargeback perdu sur le second paiement de 39,22 ⇒ (a) lot non émis : reprise 0,00 ; (b) lot versé : reprise 25,50', async () => {
    const owed = s.trip.totalPaidMinor - s.expected.guestRefundMinor;
    const [notPaid] = expected(
      'T54a',
      'T54a reprise (lot non emis) / ancienne formule',
    ) as bigint[];
    const paidBack = expected('T54b', 'T54b reprise (lot verse)') as bigint;
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      for (const [paid, reprise] of [
        [0n, notPaid],
        [s.expected.hostFromGuestMinor, paidBack],
      ] as const) {
        // le voyageur a payé la retenue (30,00 puis 39,22 : encaissé 69,22, aucun remboursement)
        const w = await capturedTrip(
          tx,
          c,
          {
            HOST: s.expected.hostFromGuestMinor,
            INSURER: 0n,
            TAX_THIRD_PARTY: 0n,
            PLATFORM: owed - s.expected.hostFromGuestMinor,
          },
          psp,
        );
        await tx.query('SELECT test_fixture.us709_settlement($1, $2, $3, $4, $5)', [
          w.trip,
          'CANCELLATION',
          s.trip.totalPaidMinor.toString(),
          s.expected.guestRefundMinor.toString(),
          s.expected.hostFromGuestMinor.toString(),
        ]);
        if (paid > 0n) {
          await tx.query('SELECT test_fixture.us709_paid_item($1, $2, $3)', [
            w.trip,
            w.psp,
            paid.toString(),
          ]);
        }
        const cb = await chargeback(tx, w, owed - 3000n, c.currency);
        expect(await applySignedStatus(tx, cb, 'SUCCEEDED')).toBe('APPLIED');
        const i = await imputationOf(tx, cb);
        expect(BigInt(i?.clawback_minor ?? '-1'), `versé ${paid}`).toBe(reprise);
        expect(BigInt(i?.clawback_minor ?? '-1')).toBeLessThanOrEqual(paid);
        const ledger = await ledgerOf(tx, w.trip);
        expect(ledger.map((e) => e.amount_minor)).toEqual(
          reprise === 0n ? [] : [(-reprise!).toString()],
        );
      }
    });
  });
});

describe('US-709 — critère 1 : T55 (PYG débité en USD) — aucune écriture entre devises', () => {
  const c = COUNTRIES.find((x) => x.currency === 'PYG');
  if (c === undefined) throw new Error('aucun pays en PYG');
  const s = settlementVector(golden, 'T27');
  const [, lost, , clawback, platform] = expected(
    'T55',
    'T55 remb USD / perdu PYG / owed / reprise / plateforme',
  ) as bigint[];

  it('perdu 359 513 PYG (ramené par l’ingestion au ratio de la capture) ⇒ reprise 220 752 PYG au host_ledger PYG, PLATFORM −138 761 ; aucune écriture en USD', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const w = await cancelledTrip(tx, c, s.expected.hostFromGuestMinor, psp);
      const cb = await chargeback(tx, w, lost!, c.currency);
      expect(await applySignedStatus(tx, cb, 'SUCCEEDED')).toBe('APPLIED');
      const i = await imputationOf(tx, cb);
      expect(i?.currency).toBe('PYG');
      expect(BigInt(i?.clawback_minor ?? '-1')).toBe(clawback);
      expect(legsOfImputation(i)).toEqual({
        HOST: -clawback!,
        INSURER: 0n,
        TAX_THIRD_PARTY: 0n,
        PLATFORM: -platform!,
      });
      const ledger = await ledgerOf(tx, w.trip);
      expect(ledger.map((e) => [e.reason, e.amount_minor, e.currency])).toEqual([
        ['CHARGEBACK_CLAWBACK', (-clawback!).toString(), 'PYG'],
      ]);
      expect((await stateOf(tx, w.trip)).map((x) => x.currency)).toEqual(['PYG']);
    });
  });
});

describe.each(COUNTRIES)('US-709 — critère 2, gel et dégel — $country ($currency)', (c) => {
  const capture: Legs = { ...legVector(golden, CAPTURE_REF[c.currency] ?? '').legsMinor };
  const total = sum(capture);

  it('TJ14b : trip réalisé, aucun versement émis, chargeback perdu ⇒ aucune reprise, toute la perte sur PLATFORM, INSURER et TAX à 0, aucune écriture de l’hôte ; HOST et INSURER dégelées', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const w = await capturedTrip(tx, c, capture, psp);
      const cb = await chargeback(tx, w, total, c.currency);
      expect(await freezeOf(tx, w.trip, 'INSURER')).toEqual(FROZEN);
      expect(await applySignedStatus(tx, cb, 'SUCCEEDED')).toBe('APPLIED');
      const i = await imputationOf(tx, cb);
      expect(i?.earnings_kind).toBe('REALIZED');
      expect(BigInt(i?.clawback_minor ?? '-1')).toBe(0n);
      // TJ14b (USD) de l'export ; en PYG, même méthode sur TJ08a (N-402 : −1 438 050)
      const tj14b = legVector(golden, 'TJ14b');
      expect(legsOfImputation(i)).toEqual(
        c.currency === tj14b.currency
          ? { ...tj14b.legsMinor }
          : { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: -total },
      );
      expect(await ledgerOf(tx, w.trip)).toEqual([]);
      for (const leg of ['HOST', 'INSURER']) expect(await freezeOf(tx, w.trip, leg)).toEqual(FREE);
    });
  });

  it('chargeback gagné (FAILED) ⇒ dégel de HOST et INSURER ; deux chargebacks : le premier gagné, le second encore ouvert ⇒ gel conservé, puis levé', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const w = await capturedTrip(tx, c, capture, psp);
      const one = await chargeback(tx, w, total, c.currency);
      expect(await applySignedStatus(tx, one, 'FAILED')).toBe('APPLIED');
      for (const leg of ['HOST', 'INSURER']) expect(await freezeOf(tx, w.trip, leg)).toEqual(FREE);

      const w2 = await capturedTrip(tx, c, capture, psp);
      const a = await chargeback(tx, w2, total, c.currency);
      const b = await chargeback(tx, w2, total, c.currency);
      expect(await applySignedStatus(tx, a, 'FAILED')).toBe('APPLIED');
      for (const leg of ['HOST', 'INSURER'])
        expect(await freezeOf(tx, w2.trip, leg)).toEqual(FROZEN);
      expect(await applySignedStatus(tx, b, 'FAILED')).toBe('APPLIED');
      for (const leg of ['HOST', 'INSURER']) expect(await freezeOf(tx, w2.trip, leg)).toEqual(FREE);
      expect(await imputationOf(tx, a)).toBeNull();
    });
  });

  it('faits incomplets (remboursement en vol) ⇒ rien d’imputé, gel conservé, contrôle FIN CHARGEBACK_UNIMPUTED signale l’écart', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const w = await cancelledTrip(tx, c, 0n, psp);
      // un remboursement PLANNED du règlement (fixture 9961)
      await tx.query('SELECT test_fixture.us224c_insert_refund_instance($1, $2, $3)', [
        uuid(),
        uuid(),
        w.trip,
      ]);
      const before = await unimputed(tx, c.country);
      const cb = await chargeback(tx, w, total, c.currency);
      expect(await applySignedStatus(tx, cb, 'SUCCEEDED')).toBe('APPLIED');
      expect(await imputationOf(tx, cb)).toBeNull();
      expect(await ledgerOf(tx, w.trip)).toEqual([]);
      for (const leg of ['HOST', 'INSURER'])
        expect(await freezeOf(tx, w.trip, leg)).toEqual(FROZEN);
      expect(await unimputed(tx, c.country)).toBe(before + 1);
      // le gel ne se lève pas tant que le chargeback n'est pas décidé, même sous migrator
      const lift = await caught(tx, () =>
        tx.query('SELECT test_fixture.us222d_set_leg_freeze($1, $2, false, NULL)', [
          w.trip,
          'HOST',
        ]),
      );
      expect(lift).toMatchObject({
        code: '23000',
        constraint: 'trip_leg_balance_freeze_forbidden',
      });
    });
  });

  it('garde du host_ledger : un crédit au-delà de la dette de (hôte, devise) ⇒ 23000 host_ledger_credit_exceeds_debt ; à hauteur de la dette ⇒ BALANCED', async () => {
    await asPayments(async (tx) => {
      const s = settlementVector(golden, SETTLEMENT_REF[c.currency] ?? '');
      const psp = await insertAccount(tx, { country: c.country });
      const w = await cancelledTrip(tx, c, s.expected.hostFromGuestMinor, psp);
      const cb = await chargeback(tx, w, s.trip.totalPaidMinor, c.currency);
      expect(await applySignedStatus(tx, cb, 'SUCCEEDED')).toBe('APPLIED');
      const debt = -BigInt((await stateOf(tx, w.trip))[0]?.balance_minor ?? '0');
      expect(debt).toBeGreaterThan(0n);
      const paid = await tx.query<{ id: string }>(
        `SELECT id FROM test_fixture.us708_batches($1) WHERE status = 'PAID'`,
        [w.trip],
      );
      const batch = paid.rows[0]?.id ?? '';
      const over = await caught(tx, () =>
        tx.query('SELECT test_fixture.us709_try_netting($1, $2)', [batch, (debt + 1n).toString()]),
      );
      expect(over).toMatchObject({ code: '23000', constraint: 'host_ledger_credit_exceeds_debt' });
      expect(translateDbError(over).code).toBe('INVARIANT_VIOLATION');
      await tx.query('SELECT test_fixture.us709_try_netting($1, $2)', [batch, debt.toString()]);
      expect(await stateOf(tx, w.trip)).toEqual([
        { currency: c.currency, state: 'BALANCED', balance_minor: '0', next_action_set: false },
      ]);
    });
  });

  it('aucune commande du grand livre n’est exécutable par un rôle applicatif (42501)', async () => {
    await asPayments(async (tx) => {
      for (const sql of [
        `SELECT core.settlement_cmd_impute_chargeback('${uuid()}')`,
        `SELECT core.settlement_refresh_host_ledger_state('${uuid()}', '${c.currency}')`,
        `SELECT core.settlement_release_chargeback_freeze('${uuid()}')`,
        `SELECT core.settlement_trip_chargeback_open('${uuid()}')`,
      ]) {
        expect(await caught(tx, () => tx.query(sql)), sql).toMatchObject({ code: '42501' });
      }
      for (const sql of [
        'SELECT 1 FROM core.settlement_chargeback_imputation',
        'SELECT 1 FROM core.settlement_host_ledger_state',
      ]) {
        expect(await caught(tx, () => tx.query(sql)), sql).toMatchObject({ code: '42501' });
      }
    });
  });
});
