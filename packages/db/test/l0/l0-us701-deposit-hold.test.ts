/**
 * US-701 — caution figée au checkout (`core.payment_deposit_hold`, migration 0146, ADR-169) sous les
 * rôles de PRODUCTION (assertion L0-05 en tête de chaque connexion : withRole), en USD (PA) et en
 * PYG sans décimale (PY), transactions annulées :
 * - `app_api` (voyageur de la session) : contexte du hold (devise et période du devis ENGAGÉ, classe
 *   du véhicule, compte marchand du pays) ; écriture UNIQUE de la décision (`EXISTING` ensuite) ;
 *   revérifications fail-closed de la base : aucune `NOT_REQUIRED` sur une classe déclencheur
 *   (LUXE) ni sur une classe inconnue, montant = `deposit_amount[pays][classe]` (À DÉCIDER dans la
 *   graine ⇒ refus), rail « débit puis remboursement » fermé tant que `funds_holding_enabled` =
 *   false (17 §0.1) ; vue du voyageur SANS `triggers` ni `params_snapshot` (S-7) ; hold d'un autre
 *   voyageur ⇒ `HOLD_NOT_FOUND` ; aucun droit direct sur la table ;
 * - `app_worker` (`payment_command`) : file des ré-autorisations échues (hold converti, rail a) et
 *   transitions `REAUTHORIZED` / `REAUTH_REFUSED` gardées (rang attendu, jamais de décision après
 *   l'expiration) ; autre travailleur ⇒ rien lu, transition refusée.
 * Attendus : 08 BR-PAY-06 (T57 : 300,00 de test, décision à fin + 70 h ; T70 : STANDARD sans
 * caution ; T72 c), 17 §3.2.7 et ADR-108 / la graine (params.json lu comme donnée) — jamais le code
 * testé. Personnes, devis et checkout par les VRAIES commandes (US-208, US-223) ; interrupteurs
 * ouverts par la procédure à deux personnes dans la transaction annulée.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  approveDriver,
  checkoutPerson,
  checkoutQuote,
  failure,
  frozenQuote,
  listedListing,
  openSwitch,
  protectionParams,
  quoteDocs,
  setClock,
  taxGroups,
} from '../support/checkout.ts';
import type { CheckoutVector, Person } from '../support/checkout.ts';
import { payTx } from '../support/pay.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const NOW = '2026-12-01T12:00:00.000Z';
const START = '2026-12-10T15:00:00.000Z';
const H = 3_600_000;

/** Vecteurs du checkout d'US-223 (en-tête de l0-us223-checkout-payment) : devis de 3 jours. */
const VECTORS: Readonly<Record<string, CheckoutVector>> = {
  PA: {
    daily: 4_000,
    schedule: { tiers: [{ maxDays: null, rateBps: 0 }], minMinor: '0' },
    fee: 0,
    taxes: { TRIP_PRICE: 840 },
    host: 9_000,
    total: 15_840,
    basicaPrice: '1/4',
    protection: 3_000,
    insurer: 2_100,
  },
  PY: {
    daily: 333_334,
    schedule: null,
    fee: 150_000,
    taxes: { TRIP_PRICE: 100_000, TRIP_FEE: 15_000 },
    host: 750_001,
    total: 1_415_002,
    basicaPrice: '3/20',
    protection: 150_000,
    insurer: 105_000,
  },
};

/** 300,00 de T57 (valeur de test du mécanisme) à l'exposant de la devise : USD 30 000, PYG 300. */
const DEPOSIT: Readonly<Record<string, bigint>> = { USD: 30_000n, PYG: 300n };
const depositOf = (cc: CountryCase): bigint => {
  const d = DEPOSIT[cc.currency];
  if (d === undefined) throw new Error(`devise sans vecteur : ${cc.currency}`);
  return d;
};

const at = (iso: string, hours: number): string =>
  new Date(Date.parse(iso) + hours * H).toISOString();

function scenario(cc: CountryCase) {
  return (fn: (tx: Tx, groups: Map<string, string>) => Promise<void>) =>
    withRole('app_api', (client) =>
      withTestTransaction(client, { virtualNow: NOW }, async (tx) => {
        await openSwitch(tx, 'p2p_private_hosts_enabled', cc.country);
        await openSwitch(tx, 'insurer_contract_active', cc.country);
        const v = VECTORS[cc.country]!;
        if (v.schedule !== null) {
          await tx.query('SELECT test_fixture.us704_set_trip_fee_schedule($1, $2::jsonb)', [
            cc.country,
            JSON.stringify(v.schedule),
          ]);
        }
        await protectionParams(tx, cc.country, v);
        await tx.query('SELECT test_fixture.us024_psp_account($1)', [cc.country]);
        await fn(tx, await taxGroups(tx, cc));
      }),
    );
}

async function guest(tx: Tx, cc: CountryCase): Promise<Person> {
  const p = await checkoutPerson(tx, cc.country);
  await approveDriver(tx, p, cc.country, { birth: '1990-01-01', licenseExpiry: '2030-12-31' });
  return p;
}

/** Devis de 3 jours puis checkout (vraies commandes) ; classe du véhicule imposée. */
async function book(
  tx: Tx,
  cc: CountryCase,
  groups: Map<string, string>,
  p: Person,
  valueClass: 'STANDARD' | 'LUXE' | null,
) {
  const v = VECTORS[cc.country]!;
  const l = await listedListing(tx, cc, v.daily);
  // null : classe inconnue du catalogue (fail-closed : déclencheur CLASS vrai)
  await tx.query('SELECT test_fixture.us108_set_value_class($1, $2)', [l.vehicleId, valueClass]);
  const d = quoteDocs(cc, v, groups, Date.parse(START), Date.parse(NOW));
  const quoteId = await frozenQuote(tx, p, l.listingId, d);
  const r = await checkoutQuote(tx, p, quoteId);
  expect(r.outcome).toBe('DONE');
  return r.hold_id!;
}

const read = async (tx: Tx, hash: Buffer, holdId: string): Promise<Row> =>
  (await tx.query<Row>('SELECT * FROM core.payment_deposit_checkout($1, $2)', [hash, holdId]))
    .rows[0]!;

const record = async (tx: Tx, hash: Buffer, holdId: string, decision: object): Promise<string> =>
  (
    await tx.query<{ r: string }>(
      'SELECT core.payment_cmd_record_deposit_decision($1, $2, $3::jsonb) AS r',
      [hash, holdId, JSON.stringify(decision)],
    )
  ).rows[0]!.r;

const notRequired = {
  mechanism: 'NOT_REQUIRED',
  triggers: [],
  paramsSnapshot: { version: 1, riskEvaluated: false, youngestDriverAge: null },
  amountMinor: '0',
  provider: 'FAKE',
  hRequiredHours: null,
  vHours: null,
  authAt: null,
  releaseAt: null,
  decisionAt: null,
  reauthDueAt: null,
};

/** T57 : pré-autorisation unique, auth_at = début − 24 h, libération fin + 72 h, décision fin + 70 h. */
const preauth = (amount: bigint, mechanism = 'PREAUTH_SINGLE') => ({
  mechanism,
  triggers: ['CLASS'],
  paramsSnapshot: { version: 1, riskEvaluated: false, youngestDriverAge: null },
  amountMinor: amount.toString(),
  provider: 'FAKE',
  hRequiredHours: 168,
  vHours: 168,
  authAt: at(START, -24),
  releaseAt: at(START, 72 + 72),
  decisionAt: at(START, 72 + 70),
  reauthDueAt: null,
});

const amountParam = (tx: Tx, cc: CountryCase, amount: bigint) =>
  tx.query("SELECT test_fixture.us225_param_version('deposit_amount', $1, $2::jsonb)", [
    cc.country,
    JSON.stringify({ LUXE: amount.toString() }),
  ]);

describe.each(COUNTRIES)('US-701 — caution figée au checkout ($country, $currency)', (cc) => {
  const run = scenario(cc);

  it('T70 : STANDARD ⇒ contexte lu (devise et période du devis engagé), NOT_REQUIRED figé une fois, vue sans champ [C2]', async () => {
    await run(async (tx, groups) => {
      const p = await guest(tx, cc);
      const hold = await book(tx, cc, groups, p, 'STANDARD');
      const ctx = await read(tx, p.hash, hold);
      expect(ctx).toMatchObject({
        outcome: 'DONE',
        country_code: cc.country,
        currency: cc.currency,
        value_class: 'STANDARD',
        provider: 'FAKE',
        mechanism: null,
      });
      expect((ctx['scheduled_start'] as Date).toISOString()).toBe(START);
      expect((ctx['scheduled_end'] as Date).toISOString()).toBe(at(START, 72));
      expect((ctx['now'] as Date).toISOString()).toBe(NOW);
      expect(await record(tx, p.hash, hold, notRequired)).toBe('RECORDED');
      expect(await record(tx, p.hash, hold, notRequired)).toBe('EXISTING');
      const after = await read(tx, p.hash, hold);
      expect(after).toMatchObject({
        outcome: 'DONE',
        mechanism: 'NOT_REQUIRED',
        amount_minor: '0',
        currency: cc.currency,
        release_at: null,
      });
      // S-7 : jamais les déclencheurs ni l'instantané des paramètres dans la lecture du voyageur
      expect(Object.keys(after).sort()).toEqual([
        'amount_minor',
        'country_code',
        'currency',
        'mechanism',
        'now',
        'outcome',
        'provider',
        'release_at',
        'scheduled_end',
        'scheduled_start',
        'value_class',
      ]);
    });
  });

  it('fail-closed : NOT_REQUIRED refusé sur une classe déclencheur (LUXE) et sur une classe inconnue ; rien n’est écrit', async () => {
    await run(async (tx, groups) => {
      for (const cls of ['LUXE', null] as const) {
        const p = await guest(tx, cc);
        const hold = await book(tx, cc, groups, p, cls);
        const e = await failure(
          tx,
          'SELECT core.payment_cmd_record_deposit_decision($1, $2, $3::jsonb)',
          [p.hash, hold, JSON.stringify(notRequired)],
        );
        expect(e).toMatchObject({ code: '23514', constraint: 'deposit_decision_mismatch' });
        expect(translateDbError(e ?? {}).code).toBe('INVARIANT_VIOLATION');
        expect((await read(tx, p.hash, hold))['mechanism']).toBeNull();
      }
    });
  });

  it('T72 c / montant unique : LUXE sans deposit_amount (À DÉCIDER) refusé ; avec 300,00 de test ⇒ T57 figé ; autre montant refusé', async () => {
    await run(async (tx, groups) => {
      const p = await guest(tx, cc);
      const hold = await book(tx, cc, groups, p, 'LUXE');
      const sql = 'SELECT core.payment_cmd_record_deposit_decision($1, $2, $3::jsonb)';
      const deposit = depositOf(cc);
      expect(
        await failure(tx, sql, [p.hash, hold, JSON.stringify(preauth(deposit))]),
      ).toMatchObject({ code: '23514', constraint: 'deposit_decision_mismatch' });
      await amountParam(tx, cc, deposit);
      expect(
        await failure(tx, sql, [p.hash, hold, JSON.stringify(preauth(deposit + 1n))]),
      ).toMatchObject({ code: '23514', constraint: 'deposit_decision_mismatch' });
      expect(await record(tx, p.hash, hold, preauth(deposit))).toBe('RECORDED');
      const after = await read(tx, p.hash, hold);
      expect(after).toMatchObject({
        mechanism: 'PREAUTH_SINGLE',
        amount_minor: deposit.toString(),
        currency: cc.currency,
      });
      expect((after['release_at'] as Date).toISOString()).toBe(at(START, 144));
    });
  });

  it('17 §0.1 : rail « débit puis remboursement » refusé tant que funds_holding_enabled = false', async () => {
    await run(async (tx, groups) => {
      const p = await guest(tx, cc);
      const hold = await book(tx, cc, groups, p, 'LUXE');
      await amountParam(tx, cc, depositOf(cc));
      const e = await failure(
        tx,
        'SELECT core.payment_cmd_record_deposit_decision($1, $2, $3::jsonb)',
        [p.hash, hold, JSON.stringify(preauth(depositOf(cc), 'CHARGE_THEN_REFUND'))],
      );
      expect(e).toMatchObject({ code: '55000', constraint: 'deposit_rail_closed' });
      expect(translateDbError(e ?? {}).code).toBe('FORBIDDEN');
    });
  });

  it('IDOR et droits : hold d’un autre voyageur ⇒ HOLD_NOT_FOUND (lecture et écriture) ; session absente ⇒ AUTH_REQUIRED ; aucun droit direct ni sur les fonctions du travailleur', async () => {
    await run(async (tx, groups) => {
      const owner = await guest(tx, cc);
      const other = await guest(tx, cc);
      const hold = await book(tx, cc, groups, owner, 'STANDARD');
      expect((await read(tx, other.hash, hold))['outcome']).toBe('HOLD_NOT_FOUND');
      expect(await record(tx, other.hash, hold, notRequired)).toBe('HOLD_NOT_FOUND');
      expect((await read(tx, Buffer.alloc(32), hold))['outcome']).toBe('AUTH_REQUIRED');
      for (const sql of [
        'SELECT 1 FROM core.payment_deposit_hold',
        'SELECT * FROM core.payment_deposit_reauth_due(10)',
        `SELECT core.payment_cmd_deposit_transition('${uuid()}', 'REAUTHORIZED', 0, NULL, NULL, NULL, NULL)`,
      ]) {
        expect(await failure(tx, sql, []), sql).toMatchObject({ code: '42501' });
      }
    });
  });
});

describe.each(COUNTRIES)('US-701 — minuterie de ré-autorisation ($country, $currency)', (cc) => {
  /** T59 en rail (a) : autorisée à début − 24 h (expiration début + 144 h), libération + 144 h 25. */
  const start = '2031-08-01T10:00:00.000Z';
  const expiry = at(start, 144);
  const release = new Date(Date.parse(start) + (144 * 60 + 25) * 60_000).toISOString();
  const reauthDue = at(start, 120);
  const seed = async (tx: Tx) =>
    (
      await tx.query<Row>(
        `SELECT * FROM test_fixture.us701_converted_deposit($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          cc.country,
          cc.currency,
          cc.timezone,
          start,
          at(start, 72),
          depositOf(cc).toString(),
          expiry,
          release,
          release,
          reauthDue,
          `fake-${uuid()}`,
        ],
      )
    ).rows[0]!;
  const transition = (
    tx: Tx,
    id: unknown,
    event: string,
    seq: number,
    exp: string,
    decision: string,
    due: string | null,
  ) =>
    tx.query<{ r: string }>(
      'SELECT core.payment_cmd_deposit_transition($1, $2, $3, $4, $5, $6, NULL) AS r',
      [id, event, seq, exp, decision, due],
    );

  it('file : échue seulement à l’heure de la base, sans champ [C2] ; acceptée ⇒ nouvelle expiration, plus dans la file ; rang périmé ⇒ STALE', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: at(start, 119) }, async (tx) => {
        const s = await seed(tx);
        const dueOf = async () =>
          (await tx.query<Row>('SELECT * FROM core.payment_deposit_reauth_due(500)')).rows.filter(
            (r) => r['deposit_id'] === s['deposit_id'],
          );
        expect(await dueOf()).toEqual([]);
        await setClock(tx, reauthDue);
        const due = await dueOf();
        expect(due).toHaveLength(1);
        expect(due[0]).toMatchObject({
          trip_id: s['trip_id'],
          segment_id: s['segment_id'],
          tender_id: s['tender_id'],
          country_code: cc.country,
          currency: cc.currency,
          provider: 'FAKE',
          reauth_seq: 0,
        });
        expect(Object.keys(due[0]!)).not.toContain('triggers');
        expect(Object.keys(due[0]!)).not.toContain('params_snapshot');
        // acceptée à +120 h (V = 168 h) : expiration +288 h, décision à la libération
        const ok = await transition(
          tx,
          s['deposit_id'],
          'REAUTHORIZED',
          0,
          at(start, 288),
          release,
          null,
        );
        expect(ok.rows[0]!.r).toBe('APPLIED');
        expect(await dueOf()).toEqual([]);
        // rejeu tardif avec l'ancien rang : rien n'est écrit
        const stale = await transition(
          tx,
          s['deposit_id'],
          'REAUTHORIZED',
          0,
          at(start, 288),
          release,
          null,
        );
        expect(stale.rows[0]!.r).toBe('STALE');
      }),
    );
  });

  it('refusée ⇒ REAUTH_REFUSED : décision avant l’expiration en cours, plus de minuterie ; décision après l’expiration refusée par la base', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: reauthDue }, async (tx) => {
        const s = await seed(tx);
        const late = await failure(
          tx,
          'SELECT core.payment_cmd_deposit_transition($1, $2, $3, $4, $5, $6, NULL)',
          [s['deposit_id'], 'REAUTH_REFUSED', 0, expiry, release, null],
        );
        expect(late).toMatchObject({ code: '23514', constraint: 'deposit_hold_decision_window' });
        // 08 BR-PAY-06 : décision = expiration − deposit_safety_h (2 h)
        const r = await transition(
          tx,
          s['deposit_id'],
          'REAUTH_REFUSED',
          0,
          expiry,
          at(start, 142),
          null,
        );
        expect(r.rows[0]!.r).toBe('APPLIED');
        const again = await tx.query<Row>('SELECT * FROM core.payment_deposit_reauth_due(500)');
        expect(again.rows.filter((x) => x['deposit_id'] === s['deposit_id'])).toEqual([]);
      }),
    );
  });

  it('autre travailleur : file vide, transition refusée (42501)', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: reauthDue }, async (tx) => {
        const s = await seed(tx);
        await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'settlement', true)`);
        const due = await tx.query<Row>('SELECT * FROM core.payment_deposit_reauth_due(500)');
        expect(due.rows).toEqual([]);
        const e = await failure(
          tx,
          'SELECT core.payment_cmd_deposit_transition($1, $2, $3, $4, $5, $6, NULL)',
          [s['deposit_id'], 'REAUTHORIZED', 0, at(start, 288), release, null],
        );
        expect(e).toMatchObject({ code: '42501', constraint: 'deposit_hold_command_forbidden' });
      }),
    );
  });
});
