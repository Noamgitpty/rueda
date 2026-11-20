/**
 * US-708 (migration 0165, ADR-185) — lots de versement à l'hôte depuis la jambe HOST (19 US-708
 * critères 1 à 3 ; 16 PYO-002 ; 08 BR-PAYOUT-02, SM-6 ; 22 OQ-P2P-08), en USD (PA) et en PYG sans
 * décimale (PY). Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête), travailleur
 * `payment_command` ; chaque transaction est ANNULÉE.
 *
 * - Critère 1 : trip terminé un VENDREDI ⇒ `payout_at` = 2ᵉ jour ouvré du pays (mardi, 10:00
 *   locale), 5ᵉ (vendredi suivant) au premier versement ; férié du pays (donnée) décalé ; calendrier
 *   absent ⇒ aucun lot (fail-closed) ; `release_at` posé une fois par le seul écrivain (S-06),
 *   ≥ fin effective + 24 h ; montant = jambe HOST encaissée − dette du `host_ledger`.
 * - Critère 2 : chargeback ouvert ⇒ ON_HOLD (CHARGEBACK) ; litige, compte changé, compte absent.
 * - Critère 3 et red team : RT-L3-V01 (payouts_enabled = false à la préparation, à la compensation,
 *   à l'envoi d'un ordre et au versement, aucun ordre écrit), RT-L3-V02 (variante B refusée avant
 *   tout ordre), RT-L3-V03 (un trip, un lot ; clé, rang et montant de l'item exigés ; lot non READY
 *   refusé), RT-L3-V06 (aucun autre écrivain de `release_at`).
 *
 * Attendus : jambe HOST des vecteurs TJ01 (USD) et TJ08a (PYG) de l'export des oracles
 * (`@rueda/money/golden-vectors`) ; dates : règle R08 de 08 BR-PAYOUT-02 appliquée à la main au
 * calendrier (vendredi 16 janvier 2032 ⇒ mardi 20, vendredi 23 au premier versement ; lundi 19
 * férié ⇒ mercredi 21, lundi 26) ; jamais le code testé. Aucun interrupteur n'est écrit.
 */
import { legVector } from '@rueda/money/golden-vectors';
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
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const CAPTURE_REF: Readonly<Record<string, string>> = { USD: 'TJ01', PYG: 'TJ08a' };

const asPayments = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command', deploymentEnv: 'test' }, fn),
  );

/** Instant ISO (UTC) d'une heure LOCALE du fuseau du trip (conversion de la base). */
async function localInstant(tx: Tx, tz: string, local: string): Promise<string> {
  const { rows } = await tx.query<{ at: string }>(
    `SELECT pg_catalog.to_char(($1::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at`,
    [local, tz],
  );
  return rows[0]?.at ?? '';
}

async function setNow(tx: Tx, iso: string): Promise<void> {
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);
}

interface World {
  readonly trip: string;
  readonly psp: string;
  readonly host: bigint;
  readonly payoutAccount: string | null;
}

interface WorldOptions {
  /** Heure LOCALE de la fin effective (transition RETURNED). */
  readonly endLocal: string;
  /** Fériés du pays (dates locales) ; vide : calendrier absent. */
  readonly holidays: readonly string[];
  readonly account?: 'verified' | 'none' | 'changed';
  /** Un lot déjà payé vers le compte de versement : ce n'est plus le premier versement. */
  readonly paid?: boolean;
  /** Dette de l'hôte au host_ledger (unités mineures). */
  readonly debit?: bigint;
}

/**
 * Trip encaissé (jambes TJ01 / TJ08a) sur le compte PSP `psp` (un seul compte ACTIVE par pays et
 * par transaction), terminé à `endLocal`, prêt à préparer.
 */
async function world(tx: Tx, c: CountryCase, psp: string, o: WorldOptions): Promise<World> {
  const capture: Legs = { ...legVector(golden, CAPTURE_REF[c.currency] ?? '').legsMinor };
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
  for (const d of o.holidays) {
    await tx.query('SELECT test_fixture.us708_holiday($1, $2::date)', [c.country, d]);
  }
  let payoutAccount: string | null = null;
  if (o.account !== 'none') {
    const hold =
      o.account === 'changed' ? await localInstant(tx, c.timezone, '2032-03-01 00:00') : null;
    const a = await tx.query<{ id: string }>(
      'SELECT test_fixture.us708_verified_account($1, $2::timestamptz) AS id',
      [trip, hold],
    );
    payoutAccount = a.rows[0]?.id ?? null;
  }
  if (o.paid === true) {
    await tx.query('SELECT test_fixture.us708_paid_batch($1, $2, $3)', [trip, payoutAccount, psp]);
  }
  if (o.debit !== undefined) {
    await tx.query('SELECT test_fixture.us708_host_debit($1, $2)', [trip, o.debit.toString()]);
  }
  await setNow(tx, await localInstant(tx, c.timezone, o.endLocal));
  await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
  return { trip, psp, host: capture.HOST, payoutAccount };
}

interface Prepared {
  readonly outcome: string;
  readonly batch_id: string | null;
  readonly payout_at: string | null;
  readonly status: string | null;
  readonly hold_reasons: string[] | null;
}

async function prepare(tx: Tx, trip: string): Promise<Prepared> {
  const { rows } = await tx.query<Prepared>(
    `SELECT outcome, batch_id, payout_at::text AS payout_at, status, hold_reasons
       FROM core.payout_cmd_prepare_trip($1)`,
    [trip],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('préparation sans résultat');
  return row;
}

/** `payout_at` en heure locale du fuseau du trip (formatage seulement). */
async function localOf(tx: Tx, tz: string, at: string | null): Promise<string> {
  const { rows } = await tx.query<{ l: string }>(
    `SELECT pg_catalog.to_char($1::timestamptz AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS l`,
    [at, tz],
  );
  return rows[0]?.l ?? '';
}

interface BatchRow {
  readonly id: string;
  readonly status: string;
  readonly first_payout: boolean;
  readonly gross_minor: string;
  readonly netted_minor: string;
  readonly net_minor: string;
  readonly hold_reasons: string[];
  readonly netted_at: string | null;
  readonly variant: string;
  readonly next_check_at: string | null;
  readonly row_version: number;
}

async function batchesOf(tx: Tx, trip: string): Promise<BatchRow[]> {
  const { rows } = await tx.query<BatchRow>(
    `SELECT id, status, first_payout, gross_minor::text, netted_minor::text, net_minor::text,
            hold_reasons, netted_at::text, variant, next_check_at::text, row_version
       FROM test_fixture.us708_batches($1)`,
    [trip],
  );
  return rows;
}

async function releaseAt(tx: Tx, trip: string, leg = 'HOST'): Promise<string | null> {
  const { rows } = await tx.query<{ r: string | null }>(
    `SELECT release_at::text AS r FROM core.settlement_trip_leg_balance
      WHERE trip_id = $1 AND segment_no = 1 AND leg = $2`,
    [trip, leg],
  );
  return rows[0]?.r ?? null;
}

async function releaseOps(tx: Tx, trip: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM core.payment_payment_operation
      WHERE trip_id = $1 AND kind = 'LEG_RELEASE'`,
    [trip],
  );
  return rows[0]?.n ?? -1;
}

/** Ordre LEG_RELEASE de la jambe HOST, par la vraie commande du travailleur. */
function recordRelease(
  tx: Tx,
  w: World,
  c: CountryCase,
  key: string,
  amount: bigint,
  attempt = 1,
): Promise<{ code?: string; constraint?: string } | null> {
  return caught(tx, () =>
    recordOperation(tx, {
      tripId: w.trip,
      accountId: w.psp,
      kind: 'LEG_RELEASE',
      amountMinor: amount,
      currency: c.currency,
      attemptNo: attempt,
      idemPlain: key,
      legs: { ...ZERO, HOST: amount },
    }),
  );
}

const FRIDAY = '2032-01-16 15:00';
const CALENDAR = ['2032-01-01'];

describe.each(COUNTRIES)('US-708 — lots de versement à l’hôte — $country ($currency)', (c) => {
  it('critère 1 : trip terminé un vendredi ⇒ premier versement J+5 (vendredi), sinon J+2 (mardi), à 10:00 locale ; release_at posé une fois, ≥ fin + 24 h', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      // premier versement (aucun lot émis vers le compte) : 5ᵉ jour ouvré
      const first = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR });
      const p1 = await prepare(tx, first.trip);
      expect(p1.outcome).toBe('PREPARED');
      expect(await localOf(tx, c.timezone, p1.payout_at)).toBe('2032-01-23 10:00');
      expect(await releaseAt(tx, first.trip)).toBe(p1.payout_at);
      // les autres jambes ne sont pas écrites par la préparation
      expect(await releaseAt(tx, first.trip, 'PLATFORM')).toBeNull();
      const [b1] = await batchesOf(tx, first.trip);
      expect(b1?.first_payout).toBe(true);

      // versement suivant (un lot payé vers le compte) : 2ᵉ jour ouvré
      const next = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR, paid: true });
      const p2 = await prepare(tx, next.trip);
      expect(p2.outcome).toBe('PREPARED');
      expect(await localOf(tx, c.timezone, p2.payout_at)).toBe('2032-01-20 10:00');
      const { rows } = await tx.query<{ ok: boolean }>(
        `SELECT $1::timestamptz >= $2::timestamptz + interval '24 hours' AS ok`,
        [p2.payout_at, await localInstant(tx, c.timezone, FRIDAY)],
      );
      expect(rows[0]?.ok).toBe(true);
      const batches = await batchesOf(tx, next.trip);
      expect(batches.find((b) => b.id === p2.batch_id)?.first_payout).toBe(false);

      // rejeu : rien n'est réécrit, un seul item
      const again = await prepare(tx, next.trip);
      expect(again).toMatchObject({ outcome: 'ALREADY_PREPARED', batch_id: p2.batch_id });
      expect(await releaseAt(tx, next.trip)).toBe(p2.payout_at);
      const items = await tx.query('SELECT * FROM test_fixture.us708_items($1)', [next.trip]);
      expect(items.rowCount).toBe(1);
    });
  });

  it('critère 1 : montant du lot = jambe HOST encaissée − dette du host_ledger (TJ01 / TJ08a), jamais négatif', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const plain = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR });
      await prepare(tx, plain.trip);
      const [b] = await batchesOf(tx, plain.trip);
      expect(BigInt(b?.gross_minor ?? '-1')).toBe(plain.host);
      expect(BigInt(b?.netted_minor ?? '-1')).toBe(0n);
      expect(BigInt(b?.net_minor ?? '-1')).toBe(plain.host);

      const debt = plain.host / 4n;
      const owed = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR, debit: debt });
      const po = await prepare(tx, owed.trip);
      const bo = (await batchesOf(tx, owed.trip)).find((x) => x.id === po.batch_id);
      expect(BigInt(bo?.gross_minor ?? '-1')).toBe(owed.host);
      expect(BigInt(bo?.netted_minor ?? '-1')).toBe(debt);
      expect(BigInt(bo?.net_minor ?? '-1')).toBe(owed.host - debt);

      // dette supérieure à la jambe : tout est compensé, net nul (jamais négatif)
      const deep = await world(tx, c, psp, {
        endLocal: FRIDAY,
        holidays: CALENDAR,
        debit: owed.host * 2n,
      });
      const pd = await prepare(tx, deep.trip);
      const bd = (await batchesOf(tx, deep.trip)).find((x) => x.id === pd.batch_id);
      expect(BigInt(bd?.netted_minor ?? '-1')).toBe(deep.host);
      expect(BigInt(bd?.net_minor ?? '-1')).toBe(0n);
    });
  });

  it('fériés du pays (données) : lundi férié ⇒ J+2 mercredi, J+5 lundi suivant ; calendrier absent ⇒ CALENDAR_MISSING, rien n’est écrit', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const holidays = ['2032-01-01', '2032-01-19'];
      const next = await world(tx, c, psp, { endLocal: FRIDAY, holidays, paid: true });
      expect(await localOf(tx, c.timezone, (await prepare(tx, next.trip)).payout_at)).toBe(
        '2032-01-21 10:00',
      );
      const first = await world(tx, c, psp, { endLocal: FRIDAY, holidays });
      expect(await localOf(tx, c.timezone, (await prepare(tx, first.trip)).payout_at)).toBe(
        '2032-01-26 10:00',
      );

      // 2034 : aucun férié du pays dans le calendrier ⇒ aucun lot, release_at absent
      const none = await world(tx, c, psp, { endLocal: '2034-03-03 15:00', holidays: [] });
      expect((await prepare(tx, none.trip)).outcome).toBe('CALENDAR_MISSING');
      expect(await releaseAt(tx, none.trip)).toBeNull();
      expect(await batchesOf(tx, none.trip)).toEqual([]);
    });
  });

  it('critère 2 : chargeback ouvert ⇒ lot ON_HOLD (CHARGEBACK) ; payouts_enabled = false ⇒ PAYOUTS_DISABLED ; compte absent ou changé ⇒ retenue', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const { rows } = await tx.query<{ on: boolean }>(
        `SELECT core.config_go_live('payouts_enabled', $1) AS on`,
        [c.country],
      );
      expect(rows[0]?.on).toBe(false);

      const cb = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR });
      await recordOperation(tx, {
        tripId: cb.trip,
        accountId: cb.psp,
        kind: 'CHARGEBACK',
        amountMinor: cb.host,
        currency: c.currency,
        idemPlain: `trip:${cb.trip}:CHARGEBACK:${uuid()}`,
        legs: null,
      });
      const p = await prepare(tx, cb.trip);
      expect(p.status).toBe('ON_HOLD');
      expect(p.hold_reasons).toEqual(expect.arrayContaining(['CHARGEBACK', 'PAYOUTS_DISABLED']));

      const none = await world(tx, c, psp, {
        endLocal: FRIDAY,
        holidays: CALENDAR,
        account: 'none',
      });
      expect((await prepare(tx, none.trip)).hold_reasons).toEqual(
        expect.arrayContaining(['PAYOUT_ACCOUNT_MISSING', 'PAYOUTS_DISABLED']),
      );
      const changed = await world(tx, c, psp, {
        endLocal: FRIDAY,
        holidays: CALENDAR,
        account: 'changed',
      });
      const pc = await prepare(tx, changed.trip);
      expect(pc.hold_reasons).toEqual(expect.arrayContaining(['PAYOUT_ACCOUNT_CHANGE_HOLD']));
      expect(pc.hold_reasons).not.toContain('CHARGEBACK');
    });
  });

  it('RT-L3-V01 : à l’échéance, payouts_enabled = false ⇒ compensation refusée (ON_HOLD) ; lot forcé READY : motifs relus à l’envoi, LEG_RELEASE refusé, INITIATED refusé même sous migrator ; aucun ordre', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const w = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR, paid: true });
      const p = await prepare(tx, w.trip);
      await setNow(tx, await localInstant(tx, c.timezone, '2032-01-20 11:00'));
      const due = await tx.query<{ batch_id: string; step: string }>(
        'SELECT batch_id, step FROM core.payout_batches_due(500)',
      );
      expect(due.rows).toEqual(
        expect.arrayContaining([expect.objectContaining({ batch_id: p.batch_id, step: 'NET' })]),
      );
      const net = await tx.query<{ outcome: string; hold_reasons: string[] }>(
        'SELECT outcome, hold_reasons FROM core.payout_cmd_net_batch($1)',
        [p.batch_id],
      );
      expect(net.rows[0]?.outcome).toBe('ON_HOLD');
      expect(net.rows[0]?.hold_reasons).toContain('PAYOUTS_DISABLED');
      const held = (await batchesOf(tx, w.trip)).find((b) => b.id === p.batch_id);
      expect(held?.status).toBe('ON_HOLD');
      expect(held?.netted_at).toBeNull();

      // l'envoi direct par la commande du travailleur, sur un lot forcé READY
      await tx.query(`SELECT test_fixture.us708_force_batch($1, 'READY')`, [p.batch_id]);
      await tx.query('SELECT test_fixture.us049_activate_submerchant($1, $2)', [w.psp, w.trip]);
      const key = `release:${w.trip}:1:HOST:i1`;
      const refused = await recordRelease(tx, w, c, key, w.host);
      expect(refused).toMatchObject({ code: '55000', constraint: 'leg_release_payouts_disabled' });
      expect(translateDbError(refused).code).toBe('FORBIDDEN');
      expect(await releaseOps(tx, w.trip)).toBe(0);
      // versement : aucune libération faite ⇒ rien à émettre
      const init = await tx.query<{ outcome: string }>(
        'SELECT outcome FROM core.payout_cmd_initiate_batch($1)',
        [p.batch_id],
      );
      expect(init.rows[0]?.outcome).toBe('RELEASE_PENDING');
      // motifs relus avant l'envoi : READY ⇒ ON_HOLD
      const re = await tx.query<{ outcome: string; hold_reasons: string[] }>(
        'SELECT outcome, hold_reasons FROM core.payout_cmd_recheck_batch($1)',
        [p.batch_id],
      );
      expect(re.rows[0]?.outcome).toBe('ON_HOLD');
      expect(re.rows[0]?.hold_reasons).toContain('PAYOUTS_DISABLED');
      // aucune émission, par aucun rôle (garde de la table, migrator compris)
      const initiated = await caught(tx, () =>
        tx.query(`SELECT test_fixture.us708_force_batch($1, 'INITIATED')`, [p.batch_id]),
      );
      expect(initiated).toMatchObject({
        code: '55000',
        constraint: 'payout_batch_payouts_disabled',
      });
    });
  });

  it('critère 3 / RT-L3-V03 : l’ordre LEG_RELEASE d’un item porte sa clé release:{trip}:1:HOST:i1, son rang et son montant, lot READY ; sinon refus avant les gardes de 0054', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const w = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR, paid: true });
      const p = await prepare(tx, w.trip);
      await setNow(tx, await localInstant(tx, c.timezone, '2032-01-20 11:00'));
      const key = `release:${w.trip}:1:HOST:i1`;
      // lot ON_HOLD (non READY) : refusé
      expect(await recordRelease(tx, w, c, key, w.host)).toMatchObject({
        code: '55000',
        constraint: 'payout_release_batch_not_ready',
      });
      await tx.query(`SELECT test_fixture.us708_force_batch($1, 'READY')`, [p.batch_id]);
      // autre rang (nouvelle valeur de i{n}), autre montant, autre clé : refusés
      for (const [k, amount, attempt] of [
        [`release:${w.trip}:1:HOST:i2`, w.host, 2],
        [key, w.host - 1n, 1],
        [`trip:${w.trip}:LEG_RELEASE:${uuid()}`, w.host, 1],
      ] as const) {
        const err = await recordRelease(tx, w, c, k, amount, attempt);
        expect(err, k).toMatchObject({ code: '55000', constraint: 'payout_release_item_mismatch' });
        expect(translateDbError(err).code).toBe('INVARIANT_VIOLATION');
      }
      expect(await releaseOps(tx, w.trip)).toBe(0);
      const [item] = (
        await tx.query<{ release_attempt: number; release_operation_id: null }>(
          'SELECT release_attempt, release_operation_id FROM test_fixture.us708_items($1)',
          [w.trip],
        )
      ).rows;
      expect(item).toEqual({ release_attempt: 0, release_operation_id: null });
    });
  });

  it('RT-L3-V02 : variante B (PLATFORM_MOR) — compte refusé par la base ; lot B forgé : funds_holding_enabled = false ⇒ FUNDS_HOLDING_DISABLED, refus avant tout ordre', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const { rows } = await tx.query<{ on: boolean }>(
        `SELECT core.config_go_live('funds_holding_enabled', $1) AS on`,
        [c.country],
      );
      expect(rows[0]?.on).toBe(false);
      // aucun compte PSP en variante B n'existe (CHECK de 0028) : aucun lot B ne naît d'une préparation
      const mor = await caught(tx, () =>
        tx.query(`SELECT test_fixture.us708_set_collection_mode($1, 'PLATFORM_MOR')`, [psp]),
      );
      expect(mor).toMatchObject({ constraint: 'psp_account_platform_mor_closed' });
      // défense en profondeur : un lot B forgé (READY) reste refusé avant tout ordre
      const w = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR, paid: true });
      await setNow(tx, await localInstant(tx, c.timezone, '2032-01-20 11:00'));
      const forged = await tx.query<{ id: string }>(
        'SELECT test_fixture.us708_variant_b_batch($1, $2) AS id',
        [w.trip, psp],
      );
      const batch = forged.rows[0]?.id ?? '';
      expect(await recordRelease(tx, w, c, `release:${w.trip}:1:HOST:i1`, w.host)).toMatchObject({
        code: '55000',
        constraint: 'payout_batch_funds_holding_disabled',
      });
      expect(await releaseOps(tx, w.trip)).toBe(0);
      const re = await tx.query<{ outcome: string; hold_reasons: string[] }>(
        'SELECT outcome, hold_reasons FROM core.payout_cmd_recheck_batch($1)',
        [batch],
      );
      expect(re.rows[0]?.outcome).toBe('ON_HOLD');
      expect(re.rows[0]?.hold_reasons).toEqual(
        expect.arrayContaining(['FUNDS_HOLDING_DISABLED', 'VARIANT_B_UNAVAILABLE']),
      );
    });
  });

  it('RT-L3-V06 : release_at n’a qu’un écrivain (inventaire des fonctions de production) ; aucun rôle applicatif ne l’écrit', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const { rows } = await tx.query<{ f: string }>(
        `SELECT p.proname AS f
           FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
          WHERE n.nspname IN ('core', 'app', 'platform')
            AND p.prosrc ~* 'update\\s+core\\.settlement_trip_leg_balance[^;]*\\mrelease_at\\s*='
          ORDER BY 1`,
      );
      expect(rows.map((r) => r.f)).toEqual(['payout_cmd_prepare_trip']);
      const w = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR });
      const err = await caught(tx, () =>
        tx.query(
          `UPDATE core.settlement_trip_leg_balance SET release_at = platform.now()
            WHERE trip_id = $1 AND leg = 'HOST'`,
          [w.trip],
        ),
      );
      expect(err?.code).toBe('42501');
    });
  });

  it('MAJEUR 2 (file) : plus de 50 trips au calendrier absent ne bloquent pas la file ; différés, ils ne reviennent pas avant leur prochaine tentative', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const held: string[] = [];
      for (let i = 0; i < 51; i += 1) {
        held.push((await world(tx, c, psp, { endLocal: '2034-03-03 15:00', holidays: [] })).trip);
      }
      const good = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR });
      const due = async (): Promise<string[]> =>
        (
          await tx.query<{ trip_id: string }>(
            'SELECT trip_id FROM core.payout_trips_to_prepare(50)',
          )
        ).rows.map((r) => r.trip_id);
      let prepared = false;
      // passes complètes : chaque trip tenté est différé, la file avance au-delà des 50 premiers
      for (let pass = 0; pass < 3; pass += 1) {
        for (const trip of await due()) {
          const p = await prepare(tx, trip);
          if (trip === good.trip && p.outcome === 'PREPARED') prepared = true;
        }
      }
      expect(prepared).toBe(true);
      // les trips différés ne reviennent pas avant leur prochaine tentative (15 min)
      const again = await due();
      expect(held.filter((t) => again.includes(t))).toEqual([]);
      await setNow(tx, await localInstant(tx, c.timezone, '2034-03-03 15:20'));
      const later = await due();
      expect(held.filter((t) => later.includes(t)).length).toBeGreaterThan(0);
    });
  });

  it('MAJEUR 2 (lots) / MOYEN : un lot échu retenu revient à sa prochaine relecture seulement ; sans changement, ni compensation ni écriture des trips', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const w = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR, paid: true });
      const p = await prepare(tx, w.trip);
      const batch = async () => (await batchesOf(tx, w.trip)).find((b) => b.id === p.batch_id);
      const born = await batch();
      // une seconde préparation (rejeu) n'écrit rien
      await prepare(tx, w.trip);
      expect((await batch())?.row_version).toBe(born?.row_version);
      await setNow(tx, await localInstant(tx, c.timezone, '2032-01-20 11:00'));
      const dueIds = async () =>
        (
          await tx.query<{ batch_id: string }>('SELECT batch_id FROM core.payout_batches_due(500)')
        ).rows.map((r) => r.batch_id);
      expect(await dueIds()).toContain(p.batch_id);
      await tx.query('SELECT outcome FROM core.payout_cmd_net_batch($1)', [p.batch_id]);
      const held = await batch();
      expect(held?.status).toBe('ON_HOLD');
      expect(held?.next_check_at).not.toBeNull();
      expect(await dueIds()).not.toContain(p.batch_id);
      await setNow(tx, await localInstant(tx, c.timezone, '2032-01-20 11:16'));
      expect(await dueIds()).toContain(p.batch_id);
    });
  });

  it('MOYEN : payout_at jamais avant fin effective + 24 h (N = 1, fin jeudi 23:30 ⇒ lundi, pas vendredi 10:00)', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      await tx.query(
        `SELECT test_fixture.us708_param_version('payout_business_day_offset', $1, '1'::jsonb)`,
        [c.country],
      );
      const w = await world(tx, c, psp, {
        endLocal: '2032-01-15 23:30',
        holidays: CALENDAR,
        paid: true,
      });
      const p = await prepare(tx, w.trip);
      expect(p.outcome).toBe('PREPARED');
      expect(await localOf(tx, c.timezone, p.payout_at)).toBe('2032-01-19 10:00');
      expect(await releaseAt(tx, w.trip)).toBe(p.payout_at);
    });
  });

  it('S-06 / RT-L3-V06 : un autre écrivain de release_at (cmd_money_owner) est refusé : seconde écriture, autre jambe, trip non terminé, avant fin + 24 h', async () => {
    await asPayments(async (tx) => {
      const psp = await insertAccount(tx, { country: c.country });
      const write = (trip: string, leg: string, at: string) =>
        caught(tx, () =>
          tx.query('SELECT test_fixture.us708_write_release_at($1, $2, $3::timestamptz)', [
            trip,
            leg,
            at,
          ]),
        );
      const guarded = { code: '23000', constraint: 'trip_leg_balance_release_at_guarded' };
      const done = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR });
      const p = await prepare(tx, done.trip);
      const far = await localInstant(tx, c.timezone, '2032-02-20 10:00');
      // seconde écriture après la préparation
      expect(await write(done.trip, 'HOST', far)).toMatchObject(guarded);
      expect(await releaseAt(tx, done.trip)).toBe(p.payout_at);
      // autre jambe
      expect(await write(done.trip, 'PLATFORM', far)).toMatchObject(guarded);
      // avant fin effective + 24 h, sur un trip terminé jamais préparé
      const fresh = await world(tx, c, psp, { endLocal: FRIDAY, holidays: CALENDAR });
      expect(
        await write(fresh.trip, 'HOST', await localInstant(tx, c.timezone, '2032-01-17 10:00')),
      ).toMatchObject(guarded);
      // trip non terminé (litige)
      await tx.query(`SELECT test_fixture.us708_set_trip_status($1, 'IN_DISPUTE')`, [fresh.trip]);
      expect(await write(fresh.trip, 'HOST', far)).toMatchObject(guarded);
      expect(await releaseAt(tx, fresh.trip)).toBeNull();
      expect(translateDbError(await write(fresh.trip, 'HOST', far)).code).toBe(
        'INVARIANT_VIOLATION',
      );
    });
  });
});
