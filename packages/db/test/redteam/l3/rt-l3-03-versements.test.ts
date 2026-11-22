/**
 * US-313 — red team du lot 3, axe « versements, chargebacks et grand livre » (19 US-313 critère 3 :
 * scénarios de l'ex-porte LB ; pré-mortem du lot 3, RT-L3-V01, V03, V07, V08, V09 ; risques L3-PM-30,
 * 33, 39, 40, 42). Rôles de PRODUCTION seulement (`withRole` : assertion L0-05 en tête de chaque
 * test), travailleur `payment_command`, USD (PA) et PYG sans décimale (PY) ; chaque transaction est
 * ANNULÉE ; aucun interrupteur n'est écrit (`payouts_enabled` reste à `false`, état de production).
 * TESTS SEULEMENT : aucun correctif, aucune migration, aucune fixture. Rapport :
 * docs/team/redteam/L3-preuves-versements.md. Horloge virtuelle 2095 (chargebacks) et 2096 (lot de versement,
 * vendredi 13 janvier), plage propre à cette passe ; compte PSP FAKE partagé du pays (fixture 9800).
 *
 * NON JOUÉS ICI (raisons au rapport) : RT-L3-V08 « deux travailleurs » (course d'imputation) ;
 * contournements LOGIQUES de V09 (nouveau compte de versement, second compte d'hôte, dette du
 * voyageur compensée sur l'hôte) : le rapport les liste avec leur renvoi ou leur raison.
 *
 * Attendus (jamais le code testé) :
 * - T53 (USD : reprise 45,00 et non 166,85 ; créance du voyageur 187,44 ; perte 24,22) et T55 (PYG :
 *   perdu 359 513, reprise 220 752) : contrôles de l'export des oracles
 *   (`docs/specs/tools/golden_vectors.json`, produit par `check_t49plus.py`, `python -I -X utf8`) ;
 *   entrées : règlements T03 / T27 et captures TJ01 / TJ08a de l'export ; 08 E7 règle 7 ;
 * - 08 BR-PAYOUT-02 et SM-6 (un lot par trip, versement après libération, aucun versement tant que
 *   `payouts_enabled` vaut `false`) ; 17 §0.1 (interrupteur lu en base, absent ⇒ `false`).
 *
 * ATTAQUES NOUVELLES (les preuves L0 d'US-708 et d'US-709 jouent déjà RT-L3-V01 à V03 et le rejeu du
 * même chargeback) : (1) un SECOND chargeback perdu, distinct, pour le même trip (autre événement du
 * PSP, autre clé) ne rouvre pas l'imputation ; (2) un résultat de versement FORGÉ (« SUCCEEDED ») sur
 * un lot retenu ne le marque pas payé ; (3) les rôles applicatifs n'écrivent ni le grand livre, ni son
 * état, ni les lots, ni les items, ni les imputations (solde négatif contourné par écriture directe) ;
 * (4) les commandes de versement se refusent sous un autre travailleur et sous l'API.
 */
import { checksFor, legVector, settlementVector } from '@rueda/money/golden-vectors';
import type { GoldenValue } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../../src/testing/index.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { applySignedStatus, caught, payTx, recordOperation, uuid } from '../../support/pay.ts';
import type { Legs } from '../../support/pay.ts';
import { golden } from '../../support/settlement.ts';
import { failure } from './support-l3.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);

/** Contrôle de l'oracle `check_t49plus.py` d'un vecteur (T53, T55). */
function expected(vectorId: string): GoldenValue {
  const c = checksFor(golden, vectorId).find(
    (x) => x.vectorId === vectorId && x.oracle === 'check_t49plus.py',
  );
  if (c === undefined) throw new Error(`contrôle absent : ${vectorId}`);
  return c.expected;
}

/**
 * Parcours par devise (jamais par pays : le pays est celui que la configuration associe à la devise
 * du vecteur). `lostOf` : montant du chargeback perdu ; `clawOf` : reprise attendue (contrôles de
 * l'export : T53 [reprise, ancienne formule, double remboursement, perte] ; T55 [remboursement en
 * USD, perdu, dû, reprise, plateforme]).
 */
interface Journey {
  readonly settlement: string;
  readonly capture: string;
  readonly lostOf: () => bigint;
  readonly clawOf: () => bigint;
}
const JOURNEYS: readonly Journey[] = [
  {
    settlement: 'T03',
    capture: 'TJ01',
    lostOf: () => settlementVector(golden, 'T03').trip.totalPaidMinor,
    clawOf: () => (expected('T53') as bigint[])[0]!,
  },
  {
    settlement: 'T27',
    capture: 'TJ08a',
    lostOf: () => (expected('T55') as bigint[])[1]!,
    clawOf: () => (expected('T55') as bigint[])[3]!,
  },
];
const journeyOf = (c: CountryCase): Journey => {
  const j = JOURNEYS.find((x) => settlementVector(golden, x.settlement).currency === c.currency);
  if (j === undefined) throw new Error(`aucun parcours en ${c.currency}`);
  return j;
};

const asPayments = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) =>
    payTx(
      client,
      { worker: 'payment_command', deploymentEnv: 'test', virtualNow: '2095-02-01T12:00:00.000Z' },
      fn,
    ),
  );

/**
 * Compte PSP FAKE ACTIVE du pays (fixture 9800), partagé : un seul compte ACTIVE par pays
 * (`psp_account_one_active`) et le groupe `l0-redteam` en voit déjà un, validé par un autre fichier.
 */
async function pspAccount(tx: Tx, country: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    'SELECT test_fixture.us024_psp_account($1) AS id',
    [country],
  );
  return rows[0]!.id;
}

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

interface Imputation {
  readonly clawback_minor: string;
  readonly currency: string;
}
async function imputationOf(tx: Tx, op: string): Promise<Imputation | null> {
  const { rows } = await tx.query<Imputation>('SELECT * FROM test_fixture.us709_imputation($1)', [
    op,
  ]);
  return rows[0] ?? null;
}

interface Entry {
  readonly reason: string;
  readonly amount_minor: string;
  readonly currency: string;
}
async function ledgerOf(tx: Tx, trip: string): Promise<Entry[]> {
  const { rows } = await tx.query<Entry>(
    'SELECT reason, amount_minor, currency FROM test_fixture.us709_ledger($1)',
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

/** Trip de fixture dans la plage virtuelle propre à cette passe (2095), jamais celle d'US-708 / 709. */
async function insertTrip(tx: Tx, c: CountryCase): Promise<string> {
  const id = uuid();
  await tx.query('SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
    id,
    uuid(),
    uuid(),
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    '2095-02-20T10:00:00Z',
    '2095-02-23T10:00:00Z',
  ]);
  return id;
}

interface World {
  readonly trip: string;
  readonly psp: string;
}

/** Trip encaissé par les vraies commandes (une capture aux jambes données). */
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

/** Trip annulé par le voyageur (règlement de l'export), encaissé, remboursé, part de l'hôte versée. */
async function cancelledTrip(tx: Tx, c: CountryCase, psp: string): Promise<World> {
  const j = journeyOf(c);
  const s = settlementVector(golden, j.settlement);
  const capture: Legs = { ...legVector(golden, j.capture).legsMinor };
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
  await tx.query('SELECT test_fixture.us709_paid_item($1, $2, $3)', [
    w.trip,
    w.psp,
    s.expected.hostFromGuestMinor.toString(),
  ]);
  return w;
}

describe.each(COUNTRIES)('RT-L3 chargeback et grand livre ($country, $currency)', (c) => {
  const j = journeyOf(c);

  it('RT-L3-V07 / V08 (L3-PM-39, L3-PM-40) : T53 / T55 — reprise de l’oracle (jamais 166,85) ; un SECOND chargeback perdu, distinct, pour le même trip ne rouvre pas l’imputation : une seule reprise au grand livre, solde inchangé', async () => {
    await asPayments(async (tx) => {
      const psp = await pspAccount(tx, c.country);
      const w = await cancelledTrip(tx, c, psp);
      const claw = j.clawOf();
      const total = settlementVector(golden, j.settlement).trip.totalPaidMinor;

      // premier chargeback perdu : reprise de l'oracle sur la jambe HOST, une écriture du grand livre
      const cb1 = await chargeback(tx, w, j.lostOf(), c.currency);
      expect(await applySignedStatus(tx, cb1, 'SUCCEEDED')).toBe('APPLIED');
      const first = await imputationOf(tx, cb1);
      expect(BigInt(first?.clawback_minor ?? '-1')).toBe(claw);
      expect(first?.currency).toBe(c.currency);
      const ledger = await ledgerOf(tx, w.trip);
      expect(ledger.map((e) => [e.reason, e.amount_minor, e.currency])).toEqual([
        ['CHARGEBACK_CLAWBACK', (-claw).toString(), c.currency],
      ]);
      const state = [
        {
          currency: c.currency,
          state: 'NEGATIVE',
          balance_minor: (-claw).toString(),
          next_action_set: true,
        },
      ];
      expect(await stateOf(tx, w.trip)).toEqual(state);

      // attaque : le PSP notifie un AUTRE chargeback (autre événement, autre clé) du montant payé en
      // entier : plus que ce qu'il reste d'encaissé après la première perte. Issue déterministe :
      // enregistré et appliqué SANS erreur, aucune imputation (`LOST_EXCEEDS_COLLECTED`)
      const cb2 = await chargeback(tx, w, total, c.currency);
      expect(await applySignedStatus(tx, cb2, 'SUCCEEDED')).toBe('APPLIED');
      expect(await imputationOf(tx, cb2)).toBeNull();
      // grand livre et solde inchangés : une seule reprise, aucune écriture entre devises
      expect(await ledgerOf(tx, w.trip)).toEqual(ledger);
      expect(await stateOf(tx, w.trip)).toEqual(state);
      // CONSTAT F-L3-PRE-03 (observation) : le déclencheur regèle HOST ET INSURER, l'imputation sort
      // avant le dégel ; le chargeback reste ouvert (gel CHARGEBACK) sans issue (voir l'it.fails)
      for (const leg of ['HOST', 'INSURER'])
        expect(await freezeOf(tx, w.trip, leg)).toEqual(FROZEN);
      // rejeu du premier chargeback (webhook rejoué) : aucune seconde reprise
      await caught(tx, () => applySignedStatus(tx, cb1, 'SUCCEEDED'));
      expect(await ledgerOf(tx, w.trip)).toEqual(ledger);
    });
  });

  // CONSTAT F-L3-PRE-03 → suite (US-709) : décision FINANCE à deux personnes qui solde un chargeback
  // non imputable (`LOST_EXCEEDS_COLLECTED`) et dégèle HOST et INSURER ; aujourd'hui les actions
  // FINANCE sont ISSUE_BORDEREAU, DECIDE_ADVANCE, WRITE_OFF_RECEIVABLE : aucune issue
  const FINANCE_ACTIONS = `SELECT pg_catalog.pg_get_constraintdef(k.oid) AS def
       FROM pg_catalog.pg_constraint AS k
      WHERE k.conrelid = 'core.settlement_finance_approval'::regclass AND k.contype = 'c'
        AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%ISSUE_BORDEREAU%'`;
  const financeActions = () =>
    asPayments(async (tx) => (await tx.query<{ def: string }>(FINANCE_ACTIONS)).rows);

  it('RT-L3-V08 — observation F-L3-PRE-03 : les actions de la décision FINANCE sont celles de 0036 / 0123, aucune ne solde un chargeback', async () => {
    const rows = await financeActions();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.def.includes('WRITE_OFF_RECEIVABLE'))).toBe(true);
    expect(rows.some((r) => r.def.includes('CHARGEBACK'))).toBe(false);
  });

  it.fails(
    'RT-L3-V08 — CONSTAT F-L3-PRE-03 : une décision FINANCE existe pour solder un chargeback non imputable',
    async () => {
      const rows = await financeActions();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.def.includes('CHARGEBACK'))).toBe(true);
    },
  );

  it('RT-L3-V09 (L3-PM-42) : solde négatif contourné par écriture directe — aucun rôle applicatif n’écrit le grand livre, son état, les imputations, les lots ni les items', async () => {
    const attacks: readonly string[] = [
      // crédit d'effacement de la dette, sans décision FINANCE à deux personnes
      `INSERT INTO core.settlement_host_ledger_entry
              (id, org_id, country_code, currency, trip_id, segment_no, reason, amount_minor)
       VALUES (gen_random_uuid(), gen_random_uuid(), '${c.country}', '${c.currency}',
               gen_random_uuid(), 1, 'RECEIVABLE_WRITE_OFF', 1)`,
      `INSERT INTO core.settlement_host_ledger_entry
              (id, org_id, country_code, currency, trip_id, segment_no, reason, amount_minor)
       VALUES (gen_random_uuid(), gen_random_uuid(), '${c.country}', '${c.currency}',
               gen_random_uuid(), 1, 'PAYOUT_NETTING', 1)`,
      'DELETE FROM core.settlement_host_ledger_entry',
      `UPDATE core.settlement_host_ledger_state SET state = 'BALANCED', balance_minor = 0`,
      'DELETE FROM core.settlement_host_ledger_state',
      'UPDATE core.settlement_chargeback_imputation SET clawback_minor = 0',
      'DELETE FROM core.settlement_chargeback_imputation',
      `UPDATE core.payout_payout_batch SET status = 'PAID'`,
      'DELETE FROM core.payout_payout_batch',
      'UPDATE core.payout_payout_item SET amount_minor = amount_minor * 2',
      'DELETE FROM core.payout_payout_item',
    ];
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        // transaction ANNULÉE : si une écriture passait, elle ne serait jamais validée (aucun
        // autocommit) ; chaque refus attendu est jugé par son SQLSTATE
        await client.query('BEGIN');
        try {
          for (const sql of attacks) {
            const refused = await failure(client, sql);
            expect(refused?.code, `${role} : ${sql.slice(0, 60)}`).toBe('42501');
          }
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }
  });

  it('RT-L3-V01 / V03 (L3-PM-30, L3-PM-33) : payouts_enabled = false — la préparation retient le lot ; un résultat de versement FORGÉ ne le marque pas payé ; envoi direct refusé ; un trip, un lot, un item ; commandes fermées sous un autre travailleur et sous l’API', async () => {
    await asPayments(async (tx) => {
      const psp = await pspAccount(tx, c.country);
      // l'interrupteur est lu en base, fermé (état de production)
      const sw = await tx.query<{ on: boolean }>(
        `SELECT core.config_go_live('payouts_enabled', $1) AS on`,
        [c.country],
      );
      expect(sw.rows[0]?.on).toBe(false);

      // trip terminé, encaissé, compte de versement vérifié (aides d'US-708)
      const capture: Legs = { ...legVector(golden, j.capture).legsMinor };
      const trip = await insertTrip(tx, c);
      const op = await recordOperation(tx, {
        tripId: trip,
        accountId: psp,
        kind: 'CAPTURE',
        amountMinor: sum(capture),
        currency: c.currency,
        idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
        legs: capture,
      });
      expect(await applySignedStatus(tx, op.operation_id, 'SUCCEEDED')).toBe('APPLIED');
      await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [op.operation_id]);
      await tx.query('SELECT test_fixture.us708_holiday($1, $2::date)', [c.country, '2096-01-01']);
      await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [trip]);
      const friday = await tx.query<{ at: string }>(
        `SELECT pg_catalog.to_char(($1::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at`,
        ['2096-01-13 15:00', c.timezone],
      );
      await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
        friday.rows[0]?.at ?? '',
      ]);
      await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);

      const prepare = async () =>
        (
          await tx.query<{ outcome: string; batch_id: string | null; status: string | null }>(
            'SELECT outcome, batch_id, status FROM core.payout_cmd_prepare_trip($1)',
            [trip],
          )
        ).rows[0];
      const first = await prepare();
      expect(first).toMatchObject({ outcome: 'PREPARED', status: 'ON_HOLD' });
      const batch = first?.batch_id ?? '';
      // V03 : rejeu de la préparation ⇒ le même lot, aucun second item
      const again = await prepare();
      expect(again).toMatchObject({ outcome: 'ALREADY_PREPARED', batch_id: batch });
      const items = await tx.query('SELECT * FROM test_fixture.us708_items($1)', [trip]);
      expect(items.rowCount).toBe(1);

      // V01 : résultat de versement FORGÉ (« SUCCEEDED ») sur un lot retenu : sans effet
      const forged = await tx.query<{ r: string }>(
        `SELECT core.payout_cmd_record_payout_result($1, 'SUCCEEDED', 'forged_ref') AS r`,
        [batch],
      );
      expect(forged.rows[0]?.r).toBe('ON_HOLD');
      // émission demandée sur un lot retenu : rien n'est émis (l'issue est l'état du lot)
      const init = await tx.query<{ outcome: string }>(
        'SELECT outcome FROM core.payout_cmd_initiate_batch($1)',
        [batch],
      );
      expect(init.rows[0]?.outcome).toBe('ON_HOLD');
      const rows = await tx.query<{ id: string; status: string; hold_reasons: string[] }>(
        'SELECT id, status, hold_reasons FROM test_fixture.us708_batches($1)',
        [trip],
      );
      expect(rows.rows.map((r) => [r.id, r.status])).toEqual([[batch, 'ON_HOLD']]);
      expect(rows.rows[0]?.hold_reasons).toContain('PAYOUTS_DISABLED');
      const released = await tx.query<{ n: number }>(
        `SELECT pg_catalog.count(*)::int AS n FROM core.payment_payment_operation
          WHERE trip_id = $1 AND kind = 'LEG_RELEASE'`,
        [trip],
      );
      expect(released.rows[0]?.n).toBe(0);

      // les commandes de versement ne s'exécutent que sous le travailleur payment_command
      await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'reconciliation', true)`);
      for (const sql of [
        `SELECT * FROM core.payout_cmd_prepare_trip('${trip}')`,
        `SELECT * FROM core.payout_cmd_initiate_batch('${batch}')`,
        `SELECT core.payout_cmd_record_payout_result('${batch}', 'SUCCEEDED', 'forged_ref')`,
      ]) {
        const refused = await caught(tx, () => tx.query(sql));
        expect(refused, sql).toMatchObject({ code: '42501' });
      }
    });
    // sous l'API : aucun EXECUTE
    await withRole('app_api', async (client) => {
      for (const sql of [
        `SELECT * FROM core.payout_cmd_prepare_trip('${uuid()}')`,
        `SELECT * FROM core.payout_cmd_initiate_batch('${uuid()}')`,
        `SELECT core.payout_cmd_record_payout_result('${uuid()}', 'SUCCEEDED', 'x')`,
      ]) {
        await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      }
    });
  });
});
