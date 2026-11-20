/**
 * US-703 — carte enregistrée, consentement MIT et débits post-trip conformes aux réseaux
 * (migration 0169, ADR-189 ; fixture 9916, et 9300, 9940, 9948, 9997 réutilisées). Rôles de
 * PRODUCTION seulement (assertion L0-05 par `withRole`), au Panama (USD) et au Paraguay (PYG sans
 * décimale).
 *
 * Attendus tirés de 19 US-703 (critères 1 à 3), de 16 PAY-015 / PAY-037 (`MIT_CONSENT_MISSING`,
 * `MIT_NOTICE_PERIOD_NOT_ELAPSED`, `MIT_DEADLINE_PASSED` ; dette et restriction `UNPAID_BALANCE`),
 * de 08 BR-PAY-09 bis (REQ-PAY-DMG-05 : préavis Visa de 20 j, accord écrit Mastercard ;
 * REQ-PAY-DMG-07 : 30 j Mastercard), de 08 E4 (`attempt_no` + 1 après un refus reçu seulement) et
 * des vecteurs de l'export des oracles (`@rueda/money/golden-vectors`) : T68 (clés a1, a2, a3,
 * 69,22 débités une fois ; `check_t66_68.py`, `check_verif12_fixes.py`), TJ02a / TJ07a / TJ07b
 * (USD) et TJ11a / TJ17d à TJ17f (PYG) (`check_legs.py`). Jamais du code testé. Le pré-mortem du
 * lot 3 (L3-PM-21 à L3-PM-24, L3-PM-38) et la red team (RT-L3-M01 à M04, RT-L3-H03) fixent les cas
 * hostiles : préavis non écoulé, consentement ou rappel absent, carte changée, ordre MIT hors
 * tentative planifiée, capacité SUPPORTS_MIT inconnue, encaissement partiel.
 *
 * Aucun interrupteur de mise en service n'est écrit. Aucune carte réelle : jeton de test, jamais un
 * PAN (le PAN de test de 08 « 4111… » est REFUSÉ par la base).
 */
import { checksFor, legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { openSession, setVirtualNow } from '../support/iam.ts';
import {
  applySignedStatus,
  applyStatus,
  caught,
  insertAccount,
  payTx,
  recordOperation,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { golden } from '../support/settlement.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const legsOf = (id: string): Legs => ({ ...legVector(golden, id).legsMinor });
const legsJson = (l: Legs): string =>
  JSON.stringify(Object.fromEntries(LEGS.map((k) => [k, l[k].toString()])));

/** Dette de 08 par devise : T29 (jambes TJ02a, USD) ; J3 (jambes TJ11a, PYG). */
const DEBT_LEGS: Readonly<Record<string, string>> = { USD: 'TJ02a', PYG: 'TJ11a' };
/** Encaissements partiels de 08 par devise : TJ07a / TJ07b (USD), TJ17d à TJ17f (PYG). */
const COLLECTIONS: Readonly<Record<string, readonly string[]>> = {
  USD: ['TJ07a', 'TJ07b'],
  PYG: ['TJ17d', 'TJ17e', 'TJ17f'],
};
/** Encaissement du loyer (moyen de carte du trip). */
const CAPTURE_LEGS: Readonly<Record<string, string>> = { USD: 'TJ01', PYG: 'TJ08a' };

const T0 = '2035-03-02T15:00:00.000Z';
const DAY = 86_400_000;
const plus = (iso: string, days: number, ms = 0): string =>
  new Date(Date.parse(iso) + days * DAY + ms).toISOString();

const asPayments = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command', deploymentEnv: 'test', virtualNow: T0 }, fn),
  );

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly psp: string;
  readonly tender: string;
  readonly card: string | null;
}

interface WorldOptions {
  readonly network?: 'VISA' | 'MASTERCARD' | 'AMEX';
  /** `false` : aucune carte ni consentement. */
  readonly consent?: boolean;
  readonly scopes?: readonly string[];
  readonly reminded?: boolean;
  /** Fin effective (transition RETURNED) à l'heure courante. */
  readonly returned?: boolean;
}

/**
 * Compte PSP FAKE ACTIVE du pays (un seul par pays et par transaction) ; SUPPORTS_MIT validée pour
 * la carte si `mit` (sinon inconnue = non).
 */
async function bench(tx: Tx, c: CountryCase, mit = true): Promise<string> {
  const psp = await insertAccount(tx, { country: c.country });
  if (mit) {
    await tx.query(
      `SELECT test_fixture.us024_set_capability('FAKE', $1, 'CARD', 'SUPPORTS_MIT', 'true'::jsonb,
                                                'VALIDATED_SANDBOX', '2035-01-01T00:00:00Z')`,
      [c.country],
    );
  }
  return psp;
}

/** Trip (9300) du voyageur, loyer encaissé par carte (jambes de l'export), carte et consentement. */
async function world(tx: Tx, c: CountryCase, psp: string, o: WorldOptions = {}): Promise<World> {
  const trip = uuid();
  const guest = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    guest,
    uuid(),
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    '2035-02-20T10:00:00Z',
    '2035-02-23T10:00:00Z',
  ]);
  const capture = legsOf(CAPTURE_LEGS[c.currency] ?? '');
  const { operation_id: tender } = await recordOperation(tx, {
    tripId: trip,
    accountId: psp,
    kind: 'CAPTURE',
    amountMinor: sum(capture),
    currency: c.currency,
    idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
    legs: capture,
  });
  expect(await applySignedStatus(tx, tender, 'SUCCEEDED')).toBe('APPLIED');
  let card: string | null = null;
  if (o.consent !== false) {
    card =
      (
        await tx.query<{ id: string }>('SELECT test_fixture.us703_card($1, $2, $3, $4) AS id', [
          guest,
          psp,
          o.network ?? 'VISA',
          `tok_us703_${uuid()}`,
        ])
      ).rows[0]?.id ?? null;
    await tx.query('SELECT test_fixture.us703_consent($1, $2, $3::text[], $4)', [
      trip,
      card,
      o.scopes ?? ['DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE', 'REAUTHORIZATION'],
      o.reminded !== false,
    ]);
  }
  if (o.returned === true) await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
  return { trip, guest, psp, tender, card };
}

interface ChargeInput {
  readonly purpose: string;
  readonly reason: string;
  readonly legs: Legs;
  readonly settlementVersion?: number | null;
  readonly agreed?: boolean;
}

async function notify(tx: Tx, w: World, i: ChargeInput): Promise<string> {
  const id = uuid();
  const { rows } = await tx.query<{ outcome: string; charge_id: string }>(
    `SELECT * FROM core.payment_cmd_notify_post_trip_charge($1, $2, $3, $4, $5, $6, $7, $8,
                                                            $9::bigint, $10::jsonb, $11)`,
    [
      id,
      w.trip,
      i.purpose,
      i.reason,
      'TEST_ORIGIN',
      uuid(),
      i.settlementVersion ?? null,
      w.tender,
      sum(i.legs).toString(),
      legsJson(i.legs),
      i.agreed === true,
    ],
  );
  expect(rows[0]?.outcome).toBe('NOTIFIED');
  return rows[0]?.charge_id ?? '';
}

interface Plan {
  readonly outcome: string;
  readonly code: string | null;
  readonly operation_id: string | null;
  readonly attempt: number | null;
}

async function plan(tx: Tx, charge: string): Promise<Plan> {
  const { rows } = await tx.query<Plan>('SELECT * FROM core.payment_cmd_plan_mit_attempt($1, $2)', [
    charge,
    uuid(),
  ]);
  return rows[0] as Plan;
}

async function settle(tx: Tx, charge: string, doNotRetry = false): Promise<Row> {
  const { rows } = await tx.query<Row>(
    'SELECT * FROM core.payment_cmd_settle_mit_attempt($1, $2)',
    [charge, doNotRetry],
  );
  return rows[0] ?? {};
}

async function chargeOf(tx: Tx, charge: string): Promise<Row> {
  const { rows } = await tx.query<Row>('SELECT * FROM test_fixture.us703_charge($1)', [charge]);
  return rows[0] ?? {};
}

async function attemptsOf(tx: Tx, charge: string): Promise<Row[]> {
  const { rows } = await tx.query<Row>('SELECT * FROM test_fixture.us703_attempts($1)', [charge]);
  return rows;
}

async function debtOf(tx: Tx, charge: string): Promise<Row | null> {
  const { rows } = await tx.query<Row>('SELECT * FROM test_fixture.us703_debt($1)', [charge]);
  return rows[0] ?? null;
}

async function mitOps(tx: Tx, trip: string): Promise<{ n: number; succeeded: bigint }> {
  const { rows } = await tx.query<{ n: number; s: string }>(
    `SELECT count(*)::int AS n,
            COALESCE(sum(amount_minor) FILTER (WHERE status = 'SUCCEEDED'), 0)::text AS s
       FROM core.payment_payment_operation WHERE trip_id = $1 AND kind = 'MIT_CHARGE'`,
    [trip],
  );
  return { n: rows[0]?.n ?? -1, succeeded: BigInt(rows[0]?.s ?? '-1') };
}

async function unpaid(tx: Tx, user: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT test_fixture.us703_unpaid_restrictions($1) AS n',
    [user],
  );
  return rows[0]?.n ?? -1;
}

const damageLegs = (c: CountryCase): Legs => legsOf(DEBT_LEGS[c.currency] ?? '');

describe.each(COUNTRIES)('US-703 — débits post-trip MIT — $country ($currency)', (c) => {
  it('critère 1 : notification envoyée il y a 15 j (Visa) ⇒ MIT_NOTICE_PERIOD_NOT_ELAPSED, aucun ordre ; à 20 j ⇒ tentative a1 planifiée', async () => {
    await asPayments(async (tx) => {
      const w = await world(tx, c, await bench(tx, c), { network: 'VISA', returned: true });
      const charge = await notify(tx, w, {
        purpose: 'DAMAGE',
        reason: 'DAMAGE_SEPARATE',
        legs: damageLegs(c),
      });
      await setVirtualNow(tx, plus(T0, 15));
      expect(await plan(tx, charge)).toMatchObject({
        outcome: 'NOT_DUE',
        code: 'MIT_NOTICE_PERIOD_NOT_ELAPSED',
        operation_id: null,
      });
      expect(await attemptsOf(tx, charge)).toEqual([]);
      expect((await mitOps(tx, w.trip)).n).toBe(0);
      // préavis de 20 j (480 h, REQ-PAY-DMG-05) : borne — 1 ms avant, refus ; à l'échéance, débit
      await setVirtualNow(tx, plus(T0, 20, -1));
      expect((await plan(tx, charge)).code).toBe('MIT_NOTICE_PERIOD_NOT_ELAPSED');
      await setVirtualNow(tx, plus(T0, 20));
      const p = await plan(tx, charge);
      expect(p).toMatchObject({ outcome: 'PLANNED', attempt: 1 });
      expect((await mitOps(tx, w.trip)).n).toBe(1);
      expect(await chargeOf(tx, charge)).toMatchObject({ status: 'CHARGING', network: 'VISA' });
    });
  });

  it('Mastercard (dommage) : sans accord écrit ⇒ MIT_AGREEMENT_REQUIRED ; avec accord ⇒ débit tout de suite ; au-delà de 30 j depuis le retour ⇒ MIT_DEADLINE_PASSED, dette', async () => {
    await asPayments(async (tx) => {
      const w = await world(tx, c, await bench(tx, c), { network: 'MASTERCARD', returned: true });
      const noAgreement = await notify(tx, w, {
        purpose: 'DAMAGE',
        reason: 'DAMAGE_SEPARATE',
        legs: damageLegs(c),
      });
      expect(await plan(tx, noAgreement)).toMatchObject({
        outcome: 'NOT_DUE',
        code: 'MIT_AGREEMENT_REQUIRED',
      });
      const agreed = await notify(tx, w, {
        purpose: 'DAMAGE',
        reason: 'DAMAGE_SEPARATE',
        legs: damageLegs(c),
        agreed: true,
      });
      expect((await plan(tx, agreed)).outcome).toBe('PLANNED');
      const late = await notify(tx, w, {
        purpose: 'DAMAGE',
        reason: 'DAMAGE_SEPARATE',
        legs: damageLegs(c),
        agreed: true,
      });
      await setVirtualNow(tx, plus(T0, 30, 1));
      expect(await plan(tx, late)).toMatchObject({ outcome: 'DEBT', code: 'MIT_DEADLINE_PASSED' });
      expect(await debtOf(tx, late)).toMatchObject({
        status: 'OPEN',
        opened_reason: 'MIT_DEADLINE_PASSED',
      });
    });
  });

  it('RT-L3-M01 : sans consentement, sans rappel à la remise, hors portée, après un changement de carte ⇒ aucun ordre, dette et restriction UNPAID_BALANCE', async () => {
    await asPayments(async (tx) => {
      const cases: readonly [WorldOptions, string][] = [
        [{ consent: false }, 'MIT_CONSENT_MISSING'],
        [{ reminded: false }, 'MIT_CONSENT_MISSING'],
        [{ scopes: ['NO_SHOW'] }, 'MIT_CONSENT_MISSING'],
      ];
      const psp = await bench(tx, c);
      for (const [opts, code] of cases) {
        const w = await world(tx, c, psp, { ...opts, returned: true });
        const charge = await notify(tx, w, {
          purpose: 'INCIDENTAL',
          reason: 'DELAYED_CHARGES',
          legs: damageLegs(c),
        });
        await setVirtualNow(tx, plus(T0, 4));
        expect(await plan(tx, charge), JSON.stringify(opts)).toMatchObject({
          outcome: 'DEBT',
          code,
        });
        expect((await mitOps(tx, w.trip)).n).toBe(0);
        expect(await unpaid(tx, w.guest)).toBe(1);
        await setVirtualNow(tx, T0);
      }
      // carte changée après le consentement : la carte consentie est REMPLACÉE
      const w = await world(tx, c, psp, { returned: true });
      await tx.query('SELECT test_fixture.us703_card($1, $2, $3, $4)', [
        w.guest,
        w.psp,
        'VISA',
        `tok_us703_${uuid()}`,
      ]);
      const charge = await notify(tx, w, {
        purpose: 'INCIDENTAL',
        reason: 'DELAYED_CHARGES',
        legs: damageLegs(c),
      });
      await setVirtualNow(tx, plus(T0, 4));
      expect(await plan(tx, charge)).toMatchObject({
        outcome: 'DEBT',
        code: 'MIT_INSTRUMENT_CHANGED',
      });
      expect((await mitOps(tx, w.trip)).n).toBe(0);
    });
  });

  it('RT-L3-H03 / critère 3 : SUPPORTS_MIT inconnue (non validée) ⇒ aucun ordre, MIT_RAIL_UNAVAILABLE', async () => {
    await asPayments(async (tx) => {
      const w = await world(tx, c, await bench(tx, c, false), { returned: true });
      const charge = await notify(tx, w, {
        purpose: 'INCIDENTAL',
        reason: 'DELAYED_CHARGES',
        legs: damageLegs(c),
      });
      await setVirtualNow(tx, plus(T0, 4));
      expect(await plan(tx, charge)).toMatchObject({
        outcome: 'BLOCKED',
        code: 'MIT_RAIL_UNAVAILABLE',
      });
      expect((await mitOps(tx, w.trip)).n).toBe(0);
    });
  });

  it('RT-L3-M02 : aucun ordre MIT_CHARGE ni DEBT_COLLECTION hors d’une tentative planifiée (même travailleur, même clé)', async () => {
    await asPayments(async (tx) => {
      const w = await world(tx, c, await bench(tx, c));
      const legs = damageLegs(c);
      for (const kind of ['MIT_CHARGE', 'DEBT_COLLECTION']) {
        const err = await caught(tx, () =>
          recordOperation(tx, {
            tripId: w.trip,
            accountId: w.psp,
            kind,
            purpose: 'RENT_SHORTFALL',
            amountMinor: sum(legs),
            currency: c.currency,
            idemPlain: `${w.trip}:1:v1:${kind}:${w.tender}:i1:a1`,
            legs,
          }),
        );
        expect(err?.constraint, kind).toBe('mit_operation_unplanned');
      }
      expect((await mitOps(tx, w.trip)).n).toBe(0);
    });
  });

  it('T68 : refus à J0, timeout puis refus confirmé à J+3, accepté à J+7 ⇒ une instance i1, clés a1, a2, a3, débité une fois', async () => {
    const expected = checksFor(golden, 'T68');
    const once = expected.find(
      (x) => x.oracle === 'check_t66_68.py' && x.label === 'T68 débité une fois',
    );
    const suffixes = expected.find((x) => x.label === 'T68 clés de tentative')?.expected;
    expect(suffixes).toEqual(['a1', 'a2', 'a3']);
    await asPayments(async (tx) => {
      // retenue non encaissée (T29) : motif NO_SHOW ; délai de TEST de la règle (08 n'en donne
      // aucun pour une retenue : la règle de production est inconnue, aucun débit)
      await tx.query(`SELECT test_fixture.us703_rule($1, 'VISA', 'NO_SHOW', 0, 90, 'NOTICE')`, [
        c.country,
      ]);
      const w = await world(tx, c, await bench(tx, c));
      const legs = legsOf(DEBT_LEGS[c.currency] ?? '');
      const charge = await notify(tx, w, {
        purpose: 'RENT_SHORTFALL',
        reason: 'NO_SHOW',
        legs,
        settlementVersion: 1,
      });
      // J0 : a1 refusée (refus REÇU)
      const a1 = await plan(tx, charge);
      expect(a1).toMatchObject({ outcome: 'PLANNED', attempt: 1 });
      expect(await applyStatus(tx, a1.operation_id ?? '', 'FAILED', 'API_RESPONSE')).toBe(
        'APPLIED',
      );
      expect(await settle(tx, charge)).toMatchObject({ outcome: 'RETRY_DUE' });
      await setVirtualNow(tx, plus(T0, 1));
      expect(await plan(tx, charge)).toMatchObject({
        outcome: 'NOT_DUE',
        code: 'MIT_RETRY_NOT_DUE',
      });
      // J+3 : a2 sans réponse (timeout) : aucune nouvelle tentative tant qu'elle est sans statut
      await setVirtualNow(tx, plus(T0, 3));
      const a2 = await plan(tx, charge);
      expect(a2).toMatchObject({ outcome: 'PLANNED', attempt: 2 });
      expect(await applyStatus(tx, a2.operation_id ?? '', 'UNKNOWN', 'API_RESPONSE')).toBe(
        'APPLIED',
      );
      expect(await settle(tx, charge)).toMatchObject({ outcome: 'IN_FLIGHT' });
      expect(await plan(tx, charge)).toMatchObject({
        outcome: 'IN_FLIGHT',
        operation_id: a2.operation_id,
        attempt: 2,
      });
      // rejeu de la MÊME clé a2 : refus confirmé à la lecture
      expect(await applyStatus(tx, a2.operation_id ?? '', 'FAILED', 'POLL')).toBe('APPLIED');
      expect(await plan(tx, charge)).toMatchObject({ outcome: 'SETTLE', attempt: 2 });
      expect(await settle(tx, charge)).toMatchObject({ outcome: 'RETRY_DUE' });
      // J+7 : a3 acceptée (webhook signé)
      await setVirtualNow(tx, plus(T0, 7));
      const a3 = await plan(tx, charge);
      expect(a3).toMatchObject({ outcome: 'PLANNED', attempt: 3 });
      expect(await applySignedStatus(tx, a3.operation_id ?? '', 'SUCCEEDED')).toBe('APPLIED');
      expect(await settle(tx, charge)).toMatchObject({ outcome: 'CHARGED' });
      expect(await settle(tx, charge)).toMatchObject({ outcome: 'CHARGED' });
      expect(await plan(tx, charge)).toMatchObject({ outcome: 'DONE', code: 'CHARGED' });

      const attempts = await attemptsOf(tx, charge);
      const prefix = `${w.trip}:1:v1:MIT_CHARGE:${w.tender}:i1:`;
      expect(attempts.map((a) => a['idem_plain'])).toEqual(
        (suffixes as string[]).map((s) => `${prefix}${s}`),
      );
      expect(attempts.map((a) => a['settled'])).toEqual(['FAILED', 'FAILED', 'SUCCEEDED']);
      const ops = await mitOps(tx, w.trip);
      expect(ops.n).toBe(3);
      // débité UNE fois : le montant dû (USD : T68 de l'export ; PYG : jambes TJ11a)
      if (c.currency === 'USD') expect(ops.succeeded).toBe(once?.expected);
      expect(ops.succeeded).toBe(sum(legs));
      expect(await chargeOf(tx, charge)).toMatchObject({ status: 'CHARGED', leg_reported: true });
      expect(await debtOf(tx, charge)).toBeNull();
    });
  });

  it('refus « ne pas réessayer » (carte volée) ⇒ aucune relance, dette directe (T68, 08 E4)', async () => {
    const stop = checksFor(golden, 'T68').find((x) =>
      x.label.startsWith("T68 refus 'ne pas reessayer'"),
    )?.expected;
    expect(stop).toEqual([1n, 0n]);
    await asPayments(async (tx) => {
      await tx.query(`SELECT test_fixture.us703_rule($1, 'VISA', 'NO_SHOW', 0, 90, 'NOTICE')`, [
        c.country,
      ]);
      const w = await world(tx, c, await bench(tx, c));
      const charge = await notify(tx, w, {
        purpose: 'RENT_SHORTFALL',
        reason: 'NO_SHOW',
        legs: legsOf(DEBT_LEGS[c.currency] ?? ''),
        settlementVersion: 1,
      });
      const a1 = await plan(tx, charge);
      await applyStatus(tx, a1.operation_id ?? '', 'FAILED', 'API_RESPONSE');
      expect(await settle(tx, charge, true)).toMatchObject({
        outcome: 'DEBT',
        code: 'MIT_DO_NOT_RETRY',
      });
      await setVirtualNow(tx, plus(T0, 7));
      expect(await plan(tx, charge)).toMatchObject({ outcome: 'DONE', code: 'UNPAID' });
      // 1 tentative, 0 relance
      expect([
        BigInt((await mitOps(tx, w.trip)).n),
        BigInt((await attemptsOf(tx, charge)).length - 1),
      ]).toEqual(stop);
      expect(await unpaid(tx, w.guest)).toBe(1);
    });
  });

  it('critère 2 : dette aux jambes de 08 payée en plusieurs fois ⇒ jambes de l’export à chaque encaissement, aucun incrément négatif, cumul = jambes dues, restriction levée au solde', async () => {
    await asPayments(async (tx) => {
      const w = await world(tx, c, await bench(tx, c), { consent: false });
      const due = legsOf(DEBT_LEGS[c.currency] ?? '');
      const charge = await notify(tx, w, {
        purpose: 'RENT_SHORTFALL',
        reason: 'NO_SHOW',
        legs: due,
        settlementVersion: 1,
      });
      expect(await plan(tx, charge)).toMatchObject({ outcome: 'DEBT' });
      const debt = await debtOf(tx, charge);
      expect(debt).toMatchObject({ status: 'OPEN', amount_minor: sum(due).toString() });
      expect(await unpaid(tx, w.guest)).toBe(1);
      const steps = COLLECTIONS[c.currency] ?? [];
      let seq = 0;
      for (const id of steps) {
        const v = legVector(golden, id);
        const { rows } = await tx.query<{
          outcome: string;
          collection_id: string;
          operation_id: string;
          legs: Record<string, string>;
        }>('SELECT * FROM core.payment_cmd_plan_debt_collection($1, $2, $3, $4::bigint)', [
          debt?.['id'],
          uuid(),
          uuid(),
          v.totalMinor.toString(),
        ]);
        const r = rows[0];
        expect(r?.outcome, id).toBe('PLANNED');
        const got = Object.fromEntries(LEGS.map((k) => [k, BigInt(r?.legs[k] ?? '-1')]));
        expect(got, id).toEqual({ ...v.legsMinor });
        for (const k of LEGS) expect((got[k] ?? -1n) >= 0n, `${id} ${k}`).toBe(true);
        // un seul encaissement planifié à la fois
        const again = await tx.query<{ outcome: string }>(
          'SELECT * FROM core.payment_cmd_plan_debt_collection($1, $2, $3, $4::bigint)',
          [debt?.['id'], uuid(), uuid(), '1'],
        );
        expect(again.rows[0]?.outcome).toBe('PENDING_COLLECTION');
        expect(await applySignedStatus(tx, r?.operation_id ?? '', 'SUCCEEDED')).toBe('APPLIED');
        const s = await tx.query<{ outcome: string; debt_status: string }>(
          'SELECT * FROM core.payment_cmd_settle_debt_collection($1)',
          [r?.collection_id],
        );
        seq += 1;
        expect(s.rows[0]?.outcome).toBe('COLLECTED');
        expect(s.rows[0]?.debt_status).toBe(seq === steps.length ? 'PAID' : 'PARTIALLY_PAID');
      }
      const paid = await debtOf(tx, charge);
      expect({
        HOST: BigInt(String(paid?.['paid_host_minor'])),
        INSURER: BigInt(String(paid?.['paid_insurer_minor'])),
        TAX_THIRD_PARTY: BigInt(String(paid?.['paid_tax_third_party_minor'])),
        PLATFORM: BigInt(String(paid?.['paid_platform_minor'])),
      }).toEqual(due);
      expect(paid?.['collection_seq']).toBe(steps.length);
      expect(await unpaid(tx, w.guest)).toBe(0);
      // encaissement au-delà du reste dû ou sur une dette payée : refus sans écriture
      const after = await tx.query<{ outcome: string }>(
        'SELECT * FROM core.payment_cmd_plan_debt_collection($1, $2, $3, $4::bigint)',
        [paid?.['id'], uuid(), uuid(), '1'],
      );
      expect(after.rows[0]?.outcome).toBe('PAID');
    });
  });

  it('encaissement refusé ⇒ rien n’est porté ; montant hors bornes ⇒ AMOUNT_INVALID', async () => {
    await asPayments(async (tx) => {
      const w = await world(tx, c, await bench(tx, c), { consent: false });
      const due = legsOf(DEBT_LEGS[c.currency] ?? '');
      const charge = await notify(tx, w, {
        purpose: 'RENT_SHORTFALL',
        reason: 'NO_SHOW',
        legs: due,
        settlementVersion: 1,
      });
      await plan(tx, charge);
      const debt = await debtOf(tx, charge);
      const over = await tx.query<{ outcome: string }>(
        'SELECT * FROM core.payment_cmd_plan_debt_collection($1, $2, $3, $4::bigint)',
        [debt?.['id'], uuid(), uuid(), (sum(due) + 1n).toString()],
      );
      expect(over.rows[0]?.outcome).toBe('AMOUNT_INVALID');
      const { rows } = await tx.query<{ collection_id: string; operation_id: string }>(
        'SELECT * FROM core.payment_cmd_plan_debt_collection($1, $2, $3, $4::bigint)',
        [debt?.['id'], uuid(), uuid(), '1'],
      );
      await applyStatus(tx, rows[0]?.operation_id ?? '', 'FAILED', 'API_RESPONSE');
      const s = await tx.query<{ outcome: string }>(
        'SELECT * FROM core.payment_cmd_settle_debt_collection($1)',
        [rows[0]?.collection_id],
      );
      expect(s.rows[0]?.outcome).toBe('FAILED');
      expect(await debtOf(tx, charge)).toMatchObject({ status: 'OPEN', paid_host_minor: '0' });
    });
  });

  it('jambes explicites : Σ ≠ montant ou jambe négative refusées ; même origine, autre contenu ⇒ conflit ; registres immuables', async () => {
    await asPayments(async (tx) => {
      const w = await world(tx, c, await bench(tx, c));
      const legs = damageLegs(c);
      const call = (amount: bigint, l: string, origin: string) =>
        tx.query(
          `SELECT * FROM core.payment_cmd_notify_post_trip_charge($1, $2, 'INCIDENTAL',
             'DELAYED_CHARGES', 'TEST_ORIGIN', $3, NULL, $4, $5::bigint, $6::jsonb, false)`,
          [uuid(), w.trip, origin, w.tender, amount.toString(), l],
        );
      const origin = uuid();
      expect(
        (await caught(tx, () => call(sum(legs) + 1n, legsJson(legs), origin)))?.constraint,
      ).toBe('mit_charge_legs_sum');
      const negative = JSON.stringify({
        HOST: '-1',
        INSURER: '0',
        TAX_THIRD_PARTY: '0',
        PLATFORM: '2',
      });
      expect((await caught(tx, () => call(1n, negative, origin)))?.constraint).toBe(
        'payment_operation_leg_negative',
      );
      await call(sum(legs), legsJson(legs), origin);
      const replay = await call(sum(legs), legsJson(legs), origin);
      expect((replay.rows[0] as Row)['outcome']).toBe('REPLAYED');
      const other = { ...legs, HOST: legs.HOST - 1n, PLATFORM: legs.PLATFORM + 1n };
      expect((await caught(tx, () => call(sum(other), legsJson(other), origin)))?.constraint).toBe(
        'mit_charge_conflict',
      );
      const charge = await notify(tx, w, {
        purpose: 'INCIDENTAL',
        reason: 'DELAYED_CHARGES',
        legs,
      });
      expect(
        (
          await caught(tx, () =>
            tx.query("SELECT test_fixture.us703_try_write('CHARGE_AMOUNT', $1)", [charge]),
          )
        )?.constraint,
      ).toBe('mit_charge_immutable');
      expect(
        (
          await caught(tx, () =>
            tx.query("SELECT test_fixture.us703_try_write('RULE', $1)", [w.trip]),
          )
        )?.constraint,
      ).toBe('mit_record_immutable');
    });
  });

  it('carte enregistrée : jeton seulement (un PAN est refusé), carte précédente remplacée, consentement lié une seule fois', async () => {
    await asPayments(async (tx) => {
      const guest = uuid();
      await tx.query('SELECT test_fixture.ensure_party($1, NULL, $2)', [guest, c.country]);
      const hold = (
        await tx.query<{ id: string }>(
          'SELECT test_fixture.us703_paying_hold($1, $2, $3, $4, $5::bigint) AS id',
          [c.country, guest, '2035-08-01T15:00:00Z', '2035-08-03T15:00:00Z', c.rentMinor],
        )
      ).rows[0]?.id;
      await tx.query('SELECT test_fixture.us703_hold_consent($1)', [hold]);
      const psp = await insertAccount(tx, { country: c.country });
      const record = (token: string, last4: string) =>
        tx.query<{ instrument_id: string; bound: boolean; replayed: boolean }>(
          `SELECT * FROM core.payment_cmd_record_instrument($1, $2, $3, $4, 'VISA', 'CREDIT', $5,
                                                            12, 2034, 'ntx-1', NULL)`,
          [uuid(), hold, psp, token, last4],
        );
      // PAN de test (Luhn valide) : jamais stocké, ni cité dans l'erreur (revue sécurité n° 6)
      const pan = '4111111111111111';
      const refused = (await caught(tx, () => record(pan, '1111'))) as {
        constraint?: string;
        message?: string;
        detail?: string;
      } | null;
      expect(refused?.constraint).toBe('payment_instrument_token_no_pan');
      expect(`${refused?.message ?? ''} ${refused?.detail ?? ''}`).not.toContain(pan);
      expect(`${refused?.message ?? ''} ${refused?.detail ?? ''}`).not.toContain('1111');
      const first = (await record('tok_us703_first_card', '4242')).rows[0];
      expect(first).toMatchObject({ bound: true, replayed: false });
      expect((await record('tok_us703_first_card', '4242')).rows[0]).toMatchObject({
        instrument_id: first?.instrument_id,
        replayed: true,
      });
      // revue argent n° 4 (delta 20b) : autre jeton pour un hold DÉJÀ lié ⇒ aucun effet (aucune
      // carte créée, la carte liée reste ACTIVE ; avant : la nouvelle carte remplaçait l'ancienne)
      expect((await record('tok_us703_second_card', '0005')).rows[0]).toMatchObject({
        instrument_id: null,
        bound: false,
        replayed: true,
      });
      const cardsOf = async (): Promise<string[]> =>
        (
          await tx.query<{ status: string; last4: string }>(
            'SELECT status, last4 FROM test_fixture.us703_cards($1)',
            [guest],
          )
        ).rows
          .map((r) => `${r.last4}:${r.status}`)
          .sort();
      expect(await cardsOf()).toEqual(['4242:ACTIVE']);
      const consent = await tx.query<{ id: string; instrument_id: string }>(
        'SELECT * FROM test_fixture.us703_consent_of_hold($1)',
        [hold],
      );
      expect(consent.rows[0]?.instrument_id).toBe(first?.instrument_id);
      expect(
        (
          await caught(tx, () =>
            tx.query("SELECT test_fixture.us703_try_write('CONSENT_REBIND', $1)", [
              consent.rows[0]?.id,
            ]),
          )
        )?.constraint,
      ).toBe('mit_consent_immutable');

      const recordOn = (h: string | undefined, token: string, last4: string) =>
        tx.query<{ instrument_id: string | null; bound: boolean; replayed: boolean }>(
          `SELECT * FROM core.payment_cmd_record_instrument($1, $2, $3, $4, 'VISA', 'CREDIT', $5,
                                                            12, 2034, 'ntx-2', NULL)`,
          [uuid(), h, psp, token, last4],
        );
      const newHold = async (start: string, end: string): Promise<string | undefined> => {
        const id = (
          await tx.query<{ id: string }>(
            'SELECT test_fixture.us703_paying_hold($1, $2, $3, $4, $5::bigint) AS id',
            [c.country, guest, start, end, c.rentMinor],
          )
        ).rows[0]?.id;
        await tx.query('SELECT test_fixture.us703_hold_consent($1)', [id]);
        return id;
      };
      // second hold payé avec une NOUVELLE carte : elle est créée, liée, l'ancienne est remplacée
      const hold2 = await newHold('2035-09-01T15:00:00Z', '2035-09-03T15:00:00Z');
      const second = (await recordOn(hold2, 'tok_us703_second_card', '0005')).rows[0];
      expect(second).toMatchObject({ bound: true, replayed: false });
      expect(await cardsOf()).toEqual(['0005:ACTIVE', '4242:REPLACED']);
      // revue argent n° 5 : voyageur qui revient. Hold payé avec la carte ACTIVE déjà enregistrée
      // (même jeton) : son consentement est lié à cette carte
      const hold3 = await newHold('2035-10-01T15:00:00Z', '2035-10-03T15:00:00Z');
      expect((await recordOn(hold3, 'tok_us703_second_card', '0005')).rows[0]).toMatchObject({
        instrument_id: second?.instrument_id,
        bound: true,
        replayed: true,
      });
      // hold payé avec l'ANCIENNE carte (REPLACED) : elle redevient la carte courante, l'autre est
      // remplacée ; le consentement du hold lui est lié
      const hold4 = await newHold('2035-11-01T15:00:00Z', '2035-11-03T15:00:00Z');
      expect((await recordOn(hold4, 'tok_us703_first_card', '4242')).rows[0]).toMatchObject({
        instrument_id: first?.instrument_id,
        bound: true,
        replayed: true,
      });
      expect(await cardsOf()).toEqual(['0005:REPLACED', '4242:ACTIVE']);
      // revue argent n° 4 / qa n° 6 (delta 20b) : rejeu TARDIF d'un ancien hold (travailleur relancé,
      // webhook rejoué) avec sa carte devenue REPLACED : aucune carte ne bascule
      expect((await recordOn(hold2, 'tok_us703_second_card', '0005')).rows[0]).toMatchObject({
        instrument_id: second?.instrument_id,
        bound: true,
        replayed: true,
      });
      expect((await recordOn(hold3, 'tok_us703_second_card', '0005')).rows[0]).toMatchObject({
        replayed: true,
      });
      expect(await cardsOf()).toEqual(['0005:REPLACED', '4242:ACTIVE']);
      // hold déjà lié, jeton d'une autre carte connue : aucun effet, liaison inchangée
      expect((await recordOn(hold4, 'tok_us703_second_card', '0005')).rows[0]).toMatchObject({
        bound: false,
        replayed: true,
      });
      expect(await cardsOf()).toEqual(['0005:REPLACED', '4242:ACTIVE']);
      for (const [h, card] of [
        [hold, first?.instrument_id],
        [hold2, second?.instrument_id],
        [hold3, second?.instrument_id],
        [hold4, first?.instrument_id],
      ] as const) {
        const k = await tx.query<{ instrument_id: string }>(
          'SELECT * FROM test_fixture.us703_consent_of_hold($1)',
          [h],
        );
        expect(k.rows[0]?.instrument_id).toBe(card);
      }
    });
  });

  it('revue argent n° 5 : carte connue liée au consentement du nouveau trip ⇒ le débit est TENTÉ sur la carte (jamais une dette MIT_CONSENT_MISSING)', async () => {
    await asPayments(async (tx) => {
      const psp = await bench(tx, c);
      const w = await world(tx, c, psp, { returned: true });
      // second trip du même voyageur, consentement donné, carte pas encore liée
      const trip2 = uuid();
      await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
        trip2,
        w.guest,
        uuid(),
        uuid(),
        c.country,
        c.currency,
        c.timezone,
        '2035-02-24T10:00:00Z',
        '2035-02-26T10:00:00Z',
      ]);
      const capture = legsOf(CAPTURE_LEGS[c.currency] ?? '');
      const { operation_id: tender2 } = await recordOperation(tx, {
        tripId: trip2,
        accountId: psp,
        kind: 'CAPTURE',
        amountMinor: sum(capture),
        currency: c.currency,
        idemPlain: `trip:${trip2}:CAPTURE:${uuid()}`,
        legs: capture,
      });
      expect(await applySignedStatus(tx, tender2, 'SUCCEEDED')).toBe('APPLIED');
      // la carte du premier trip est celle du second (fixture : consentement lié à cette carte)
      await tx.query('SELECT test_fixture.us703_consent($1, $2, $3::text[], true)', [
        trip2,
        w.card,
        ['DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE', 'REAUTHORIZATION'],
      ]);
      await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip2]);
      const charge = await notify(
        tx,
        { ...w, trip: trip2, tender: tender2 },
        { purpose: 'INCIDENTAL', reason: 'DELAYED_CHARGES', legs: damageLegs(c) },
      );
      await setVirtualNow(tx, plus(T0, 4));
      expect(await plan(tx, charge)).toMatchObject({ outcome: 'PLANNED', attempt: 1 });
    });
  });

  it('revue code n° 3 / qa n° 4 : file des débits sans famine — plus de 50 débits en cours repoussés à leur prochaine relecture ⇒ le débit échu suivant est servi', async () => {
    await asPayments(async (tx) => {
      const psp = await bench(tx, c);
      const w = await world(tx, c, psp, { returned: true });
      const due = async (): Promise<string[]> =>
        (
          await tx.query<{ charge_id: string }>(
            'SELECT charge_id FROM core.payment_post_trip_charges_due(50)',
          )
        ).rows.map((r) => r.charge_id);
      const stuck: string[] = [];
      for (let i = 0; i < 51; i += 1) {
        stuck.push(
          await notify(tx, w, {
            purpose: 'INCIDENTAL',
            reason: 'DELAYED_CHARGES',
            legs: damageLegs(c),
          }),
        );
      }
      // préavis de 72 h écoulé : chaque débit a une tentative en vol (CHARGING)
      await setVirtualNow(tx, plus(T0, 4));
      for (const id of stuck) expect((await plan(tx, id)).outcome).toBe('PLANNED');
      // un débit échu notifié après eux
      await setVirtualNow(tx, plus(T0, 4, 1000));
      const fresh = await notify(tx, w, {
        purpose: 'INCIDENTAL',
        reason: 'DELAYED_CHARGES',
        legs: damageLegs(c),
      });
      // 51 débits en cours plus anciens : sans relecture différée, le débit échu attendrait
      expect(await due()).not.toContain(fresh);
      for (const id of stuck) {
        const r = await tx.query<{ r: string }>(
          'SELECT core.payment_cmd_defer_mit_charge($1, $2) AS r',
          [id, 'NO_INSTRUMENT'],
        );
        expect(r.rows[0]?.r).toBe('DEFERRED');
      }
      const served = await due();
      expect(served).toContain(fresh);
      expect(served.filter((id) => stuck.includes(id))).toEqual([]);
      expect(await chargeOf(tx, stuck[0] ?? '')).toMatchObject({ outcome_code: 'NO_INSTRUMENT' });
      // un débit terminé n'est jamais repoussé
      expect(
        (
          await tx.query<{ r: string }>('SELECT core.payment_cmd_defer_mit_charge($1, $2) AS r', [
            fresh,
            'X_CODE',
          ])
        ).rows[0]?.r,
      ).toBe('UNCHANGED');
      // 15 min plus tard : les débits en cours reviennent, et des passes successives de la file
      // (taille réelle 50) les servent TOUS. Les 51 ont la même échéance (départagés par un UUID
      // aléatoire) : on ne présume d'aucun ordre entre eux. Chaque passe repousse ce qu'elle sert,
      // comme le travailleur ; `fresh`, terminé pour la file de relance (UNCHANGED), n'est pas repoussé.
      await setVirtualNow(tx, plus(T0, 4, 16 * 60_000));
      const seen = new Set<string>();
      let passes = 0;
      while (seen.size < stuck.length && passes < 3) {
        passes += 1;
        const rows = await due();
        expect(rows.length).toBeLessThanOrEqual(50);
        const fromStuck = rows.filter((id) => stuck.includes(id) && !seen.has(id));
        // pas de famine : chaque passe sert au moins un débit encore jamais servi
        expect(fromStuck.length).toBeGreaterThan(0);
        for (const id of fromStuck) {
          seen.add(id);
          const r = await tx.query<{ r: string }>(
            'SELECT core.payment_cmd_defer_mit_charge($1, $2) AS r',
            [id, 'NO_INSTRUMENT'],
          );
          expect(r.rows[0]?.r).toBe('DEFERRED');
        }
      }
      // 51 débits pour des passes de 50 : deux passes exactement, chaque débit de `stuck` servi
      expect(passes).toBe(2);
      expect([...seen].sort()).toEqual([...stuck].sort());
    });
  });

  it('revue architecture n° 1 : la graine des règles des réseaux concorde avec les paramètres du pays de 0009 (visa_objection_days, damage_charge_deadline_days, invoice_guest_response_h)', async () => {
    await asPayments(async (tx) => {
      const rule = async (network: string, reason: string) =>
        (
          await tx.query<{ notice_hours: number | null; deadline_days: number | null }>(
            'SELECT notice_hours, deadline_days FROM test_fixture.us703_rule_of($1, $2, $3)',
            [c.country, network, reason],
          )
        ).rows[0];
      const param = async (key: string, network: string | null) =>
        (
          await tx.query<{ v: number }>(
            `SELECT (value #>> '{}')::integer AS v FROM test_fixture.us703_param($1, $2, $3)`,
            [key, c.country, network],
          )
        ).rows[0]?.v;
      expect((await rule('VISA', 'DAMAGE_SEPARATE'))?.notice_hours).toBe(
        ((await param('visa_objection_days', null)) ?? -1) * 24,
      );
      for (const network of ['VISA', 'MASTERCARD', 'AMEX']) {
        expect((await rule(network, 'DAMAGE_SEPARATE'))?.deadline_days, network).toBe(
          await param('damage_charge_deadline_days', network),
        );
        expect((await rule(network, 'DELAYED_CHARGES'))?.notice_hours, network).toBe(
          await param('invoice_guest_response_h', null),
        );
      }
    });
  });

  it('commandes du travailleur : refusées hors de payment_command (42501)', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'settlement', deploymentEnv: 'test' }, async (tx) => {
        for (const sql of [
          'SELECT * FROM core.payment_cmd_plan_mit_attempt($1, $1)',
          'SELECT * FROM core.payment_mit_attempt_for_send($1)',
          'SELECT * FROM core.payment_cmd_settle_mit_attempt($1, false)',
          'SELECT * FROM core.payment_cmd_settle_debt_collection($1)',
        ]) {
          const err = await caught(tx, () => tx.query(sql, [uuid()]));
          expect(err?.code, sql).toBe('42501');
        }
      }),
    );
  });
});

describe.each(COUNTRIES)(
  'US-703 — consentement du voyageur (S05, S09) — $country ($currency)',
  (c) => {
    const START = '2035-06-11T10:00:00.000Z';
    const END = '2035-06-14T10:00:00.000Z';
    const LINES = JSON.stringify([{ type: 'TRIP_PRICE', amountMinor: c.rentMinor }]);

    async function guestTrip(tx: Tx): Promise<{ trip: string; guest: string; holder: string }> {
      const guest = uuid();
      const { rows } = await tx.query<{ trip_id: string; holder_id: string }>(
        `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                             $5::jsonb)`,
        [c.country, guest, START, END, LINES],
      );
      return { trip: rows[0]?.trip_id ?? '', guest, holder: rows[0]?.holder_id ?? '' };
    }

    it('S05 : consentement au checkout du voyageur du hold, une fois ; autre personne, hold converti ⇒ refus', async () => {
      await withRole('app_api', (client) =>
        withTestTransaction(client, { virtualNow: '2035-05-01T10:00:00.000Z' }, async (tx) => {
          const w = await guestTrip(tx);
          const { rows } = await tx.query<{ hold_id: string }>(
            `SELECT * FROM test_fixture.us214_request($1, $2, 'Luis', 'Benítez', 'Ciudad de prueba',
                                                    $3, $4, $5::bigint, $6, 'IN_FLIGHT')`,
            [
              c.country,
              w.guest,
              '2035-08-01T15:00:00Z',
              '2035-08-03T15:00:00Z',
              c.rentMinor,
              '2035-05-02T10:00:00Z',
            ],
          );
          const hold = rows[0]?.hold_id;
          const g = await openSession(tx, w.guest);
          const h = await openSession(tx, w.holder);
          const accept = (hash: Buffer, id: unknown, locale = 'es') =>
            tx.query<{ outcome: string; consent_id: string | null }>(
              'SELECT * FROM core.payment_cmd_accept_mit_consent($1, $2::uuid, $3, 104)',
              [hash, id, locale],
            );
          expect((await accept(h.hash, hold)).rows[0]?.outcome).toBe('NOT_FOUND');
          expect((await accept(g.hash, hold, 'xx_YY')).rows[0]?.outcome).toBe('REQUEST_INVALID');
          const mode = await tx.query<{ mode: string }>(
            'SELECT mode FROM core.payment_mit_consent_mode_of_hold($1, $2::uuid)',
            [g.hash, hold],
          );
          // DEC-FONDATEUR-22 : mention au bouton par défaut (paramètre du pays à false)
          expect(mode.rows).toEqual([{ mode: 'NOTICE' }]);
          expect(
            (
              await tx.query(
                'SELECT mode FROM core.payment_mit_consent_mode_of_hold($1, $2::uuid)',
                [h.hash, hold],
              )
            ).rowCount,
          ).toBe(0);
          const a = (await accept(g.hash, hold)).rows[0];
          expect(a?.outcome).toBe('ACCEPTED');
          expect((await accept(g.hash, hold, 'pt-BR')).rows[0]).toEqual({
            outcome: 'ALREADY_ACCEPTED',
            consent_id: a?.consent_id,
          });
        }),
      );
    });

    it('forme du consentement (ADR-189 n° 15) : faux ⇒ mention enregistrée, vrai ⇒ case enregistrée, absent ⇒ BLOCKED et aucun consentement (fail_mode BLOCK)', async () => {
      await withRole('app_api', (client) =>
        withTestTransaction(client, { virtualNow: '2035-05-01T10:00:00.000Z' }, async (tx) => {
          const payingHold = async (): Promise<{ hold: string | undefined; hash: Buffer }> => {
            const w = await guestTrip(tx);
            const { rows } = await tx.query<{ hold_id: string }>(
              `SELECT * FROM test_fixture.us214_request($1, $2, 'Luis', 'Benítez',
                                                      'Ciudad de prueba', $3, $4, $5::bigint, $6,
                                                      'IN_FLIGHT')`,
              [
                c.country,
                w.guest,
                '2035-08-01T15:00:00Z',
                '2035-08-03T15:00:00Z',
                c.rentMinor,
                '2035-05-02T10:00:00Z',
              ],
            );
            return { hold: rows[0]?.hold_id, hash: (await openSession(tx, w.guest)).hash };
          };
          const modeOf = async (p: { hold: string | undefined; hash: Buffer }) =>
            (
              await tx.query<{ mode: string }>(
                'SELECT mode FROM core.payment_mit_consent_mode_of_hold($1, $2::uuid)',
                [p.hash, p.hold],
              )
            ).rows[0]?.mode;
          const accept = async (p: { hold: string | undefined; hash: Buffer }) =>
            (
              await tx.query<{ outcome: string; consent_id: string | null }>(
                "SELECT * FROM core.payment_cmd_accept_mit_consent($1, $2::uuid, 'fr', 104)",
                [p.hash, p.hold],
              )
            ).rows[0];
          const consentOf = async (hold: string | undefined) =>
            (
              await tx.query<{ shown_text: string; catalog_version: number; locale: string }>(
                'SELECT consent_key AS shown_text, catalog_version, locale FROM test_fixture.us703_consent_of_hold($1)',
                [hold],
              )
            ).rows;
          // graine du pays (faux, DEC-FONDATEUR-22) : mention au bouton, clé de la mention
          const notice = await payingHold();
          expect(await modeOf(notice)).toBe('NOTICE');
          expect((await accept(notice))?.outcome).toBe('ACCEPTED');
          expect(await consentOf(notice.hold)).toEqual([
            { shown_text: 'web.s05.mitConsentNotice', catalog_version: 104, locale: 'fr' },
          ]);
          // paramètre du pays à vrai : branche CHECKBOX de la base, clé de la case séparée
          await tx.query("SELECT test_fixture.us703_set_consent_param($1, 'true'::jsonb)", [
            c.country,
          ]);
          const checkbox = await payingHold();
          expect(await modeOf(checkbox)).toBe('CHECKBOX');
          expect((await accept(checkbox))?.outcome).toBe('ACCEPTED');
          expect(await consentOf(checkbox.hold)).toEqual([
            { shown_text: 'web.s05.mitConsent', catalog_version: 104, locale: 'fr' },
          ]);
          // le consentement déjà donné garde la clé du texte affiché alors (jamais réécrit)
          expect((await consentOf(notice.hold))[0]?.shown_text).toBe('web.s05.mitConsentNotice');
          // paramètre ABSENT (pays ajouté sans valeur) : fail_mode BLOCK, des deux côtés ; le site
          // lit BLOCKED et n'offre pas le paiement, la base refuse le consentement sans écrire
          // une heure plus tard : la version posée ci-dessus se ferme après son début (valid_to > valid_from)
          await setVirtualNow(tx, '2035-05-01T11:00:00.000Z');
          await tx.query('SELECT test_fixture.us703_set_consent_param($1, NULL)', [c.country]);
          const missing = await payingHold();
          expect(await modeOf(missing)).toBe('BLOCKED');
          expect(await accept(missing)).toEqual({ outcome: 'PARAM_MISSING', consent_id: null });
          expect(await consentOf(missing.hold)).toEqual([]);
        }),
      );
    });

    it('S09 : rappel à la remise par le voyageur du trip pendant CHECKIN_OPEN seulement ; vue : marque et 4 derniers chiffres, jamais le jeton', async () => {
      await withRole('app_api', (client) =>
        withTestTransaction(client, { virtualNow: '2035-06-10T12:00:00.000Z' }, async (tx) => {
          const w = await guestTrip(tx);
          const g = await openSession(tx, w.guest);
          const h = await openSession(tx, w.holder);
          const ack = (hash: Buffer) =>
            tx.query<{ outcome: string }>(
              "SELECT * FROM core.payment_cmd_ack_mit_reminder($1, $2::uuid, 'fr', 104)",
              [hash, w.trip],
            );
          const view = (hash: Buffer) =>
            tx.query<Row>('SELECT * FROM core.payment_mit_consent_view($1, $2::uuid)', [
              hash,
              w.trip,
            ]);
          expect((await ack(g.hash)).rows[0]?.outcome).toBe('NO_CONSENT');
          expect((await view(g.hash)).rows[0]).toMatchObject({ consented: false });
          await tx.query('SELECT test_fixture.us703_consent($1, NULL, $2::text[], false)', [
            w.trip,
            ['DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE', 'REAUTHORIZATION'],
          ]);
          expect((await ack(g.hash)).rows[0]?.outcome).toBe('CHECKIN_NOT_OPEN');
          await tx.query("SELECT test_fixture.us207_force_status($1, 'CHECKIN_OPEN')", [w.trip]);
          expect((await ack(h.hash)).rows[0]?.outcome).toBe('NOT_FOUND');
          expect((await ack(g.hash)).rows[0]?.outcome).toBe('ACKNOWLEDGED');
          expect((await ack(g.hash)).rows[0]?.outcome).toBe('ALREADY_ACKNOWLEDGED');
          const v = (await view(g.hash)).rows[0] ?? {};
          expect(v).toMatchObject({
            consented: true,
            network: null,
            last4: null,
            card_active: false,
          });
          expect(v['reminded_at']).not.toBeNull();
          expect(Object.keys(v).sort()).toEqual(
            ['accepted_at', 'card_active', 'consented', 'last4', 'network', 'reminded_at'].sort(),
          );
          expect((await view(h.hash)).rowCount).toBe(0);
        }),
      );
    });

    it('aucun droit applicatif sur les tables de 0169 : lecture et écriture directes refusées (42501)', async () => {
      await withRole('app_api', (client) =>
        withTestTransaction(client, {}, async (tx) => {
          for (const t of [
            'payment_payment_instrument',
            'payment_mit_consent',
            'payment_mit_consent_reminder',
            'payment_mit_network_rule',
            'payment_post_trip_charge',
            'payment_post_trip_charge_attempt',
            'payment_debt_balance',
            'payment_debt_collection',
          ]) {
            const err = await caught(tx, () => tx.query(`SELECT 1 FROM core.${t} LIMIT 1`));
            expect(err?.code, t).toBe('42501');
          }
        }),
      );
    });
  },
);
