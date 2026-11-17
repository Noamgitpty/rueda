/**
 * US-709a (migration 0128, ADR-153) — `host_ledger` minimal : la pénalité de l'hôte qui annule est
 * portée au grand livre de l'hôte comme ajustement de versement, jamais comme jambe (19 US-215
 * critère 2 ; 08 BR-CXL-13, E5, E7 règle 7), dans la MÊME transaction que le règlement et la
 * transition d'annulation (SM-1 invariant 4), en USD (PA) et en PYG sans décimale (PY).
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête) : app_api pour la console et
 * les lectures de l'ops, app_worker pour le travailleur (trip_lifecycle, settlement,
 * payment_command dans UNE transaction, comme `TripCancellationProcessor`). La préparation (trip,
 * capture) et la demande de la console sont VALIDÉES sur des trips et des véhicules neufs ; la
 * transaction du travailleur est ANNULÉE après `SET CONSTRAINTS ALL IMMEDIATE` (comme
 * l0-us215-trip-cancellation). Fichier isolé (`vitest.l0.config.ts`) : compte PSP FAKE ACTIVE du
 * pays partagé (fixture 9800).
 *
 * Attendus : vecteurs de l'export des oracles (`docs/specs/tools/golden_vectors.json`,
 * `@rueda/money/golden-vectors`) — T14 (25,00 USD à T−30 h), T15 (50,00 USD à T−24 h pile, palier
 * « ≤ 24 h »), T48 (200 000 PYG à T−30 h), T03 et T27 (annulation du voyageur : aucune pénalité) ;
 * 08 T62 (unités mineures de la devise du pays). Jamais le code testé : le moteur ne sert qu'à
 * construire la version proposée, que la base rejoue (0054) et lie à la demande (0124).
 */
import { buildSettlementRecord, type CancellationEvent, type SettlementRecord } from '@rueda/money';
import { legVector, settlementVector } from '@rueda/money/golden-vectors';
import { testParams } from '@rueda/money/testing';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { applySignedStatus, caught, legsJson, recordOperation, uuid } from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import {
  golden,
  insertTrip,
  recordAsSettlementWorker,
  recordOfVector,
  tripOfVector,
} from '../support/settlement.ts';
import { newHash } from '../support/golive.ts';
import { createStaff } from '../support/staff.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const MINUTE = 60_000;
const REASON = 'Demande du support, motif de test';
const ACT =
  'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])';
const PENALTY = 'HOST_CANCELLATION_PENALTY';

const PA = COUNTRIES.find((c) => c.currency === 'USD');
const PY = COUNTRIES.find((c) => c.currency === 'PYG');
if (PA === undefined || PY === undefined) throw new Error('pays PA / PY attendus (avl.ts)');

const legsVector = (id: string): Legs => ({ ...legVector(golden, id).legsMinor }) as Legs;
const neg = (l: Legs): Legs => Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
const expected = (id: string) => settlementVector(golden, id).expected;
const iso = (ms: number): string => new Date(ms).toISOString();

/** Instant de la demande à la console : fenêtre virtuelle lointaine (2031), minute ronde. */
const REQUESTED_AT_MS = Date.UTC(2031, 3, 14, 12, 0, 0);

interface World {
  readonly c: CountryCase;
  readonly trip: string;
  readonly org: string;
  readonly requestedAtMs: number;
  readonly vector: string;
  readonly capture: string;
}

/** Trip du vecteur, capturé par les jambes `capture` (webhook signé, soldes reportés). VALIDÉ. */
async function world(worker: Tx, c: CountryCase, vector: string, capture: string): Promise<World> {
  const v = settlementVector(golden, vector);
  if (v.currency !== c.currency) throw new Error(`${vector} n'est pas en ${c.currency}`);
  const at = v.event.requestedAtMinutes;
  if (at === undefined) throw new Error(`${vector} : instant de demande absent`);
  const startAtMs = REQUESTED_AT_MS - at * MINUTE;
  const bookedAtMs = startAtMs + v.trip.bookedAtMinutes * MINUTE;
  const trip = uuid();
  const org = uuid();
  const capLegs = legsVector(capture);
  const total = LEGS.reduce((s, k) => s + capLegs[k], 0n);
  let captureId = '';
  await withTestTransaction(worker, { virtualNow: iso(bookedAtMs), commit: true }, async (tx) => {
    await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
    await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      trip,
      uuid(),
      org,
      uuid(),
      c.country,
      c.currency,
      c.timezone,
      iso(startAtMs),
      iso(startAtMs + v.trip.days * 24 * 60 * MINUTE),
    ]);
    // compte FAKE ACTIVE du pays partagé par les fichiers isolés (fixture 9800)
    const a = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
      c.country,
    ]);
    const op = await recordOperation(tx, {
      tripId: trip,
      accountId: a.rows[0]?.id ?? '',
      kind: 'CAPTURE',
      amountMinor: total,
      currency: c.currency,
      idemPlain: `trip:${trip}:capture:${uuid()}`,
      legs: capLegs,
    });
    captureId = op.operation_id;
    expect(await applySignedStatus(tx, op.operation_id, 'SUCCEEDED')).toBe('APPLIED');
    const moved = await tx.query<{ r: string }>(
      'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
      [op.operation_id],
    );
    expect(moved.rows[0]?.r).toBe('APPLIED');
  });
  return { c, trip, org, requestedAtMs: REQUESTED_AT_MS, vector, capture: captureId };
}

/** Action de console sous le contexte STAFF de l'API, à l'instant de la demande. VALIDÉE. */
async function act(api: Tx, action: string, w: World): Promise<string> {
  const ops = await createStaff(api, 'OPS_AGENT', [w.c.country], { withFactor: false });
  return withTestTransaction(
    api,
    { virtualNow: iso(w.requestedAtMs), commit: true },
    async (tx) => {
      // session élevée ouverte à l'instant virtuel de la demande (fixture 9650, comme US-215)
      const hash = newHash();
      await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [ops.userId, hash]);
      await setSessionContext(tx, {
        kind: 'STAFF',
        actorId: ops.userId,
        countryScope: [w.c.country],
        sessionTokenHash: hash.toString('hex'),
      });
      const { rows } = await tx.query<{ outcome: string; domain_ref: string | null }>(ACT, [
        hash,
        uuid(),
        action,
        w.trip,
        REASON,
        {},
        [],
      ]);
      expect(rows[0]?.outcome).toBe('DONE');
      return rows[0]?.domain_ref ?? '';
    },
  );
}

interface Facts {
  readonly trip_row_version: number;
  readonly start_at_ms: string;
  readonly booked_at_ms: string;
  readonly requested_reason: string;
  readonly sub_reason: string | null;
  readonly evidence_validated: boolean;
  readonly checkin_validated: boolean;
  readonly requested_at_ms: string;
}

async function begin(tx: Tx, id: string): Promise<Facts> {
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
  const { rows } = await tx.query<Facts>(
    `SELECT trip_row_version, start_at_ms::text AS start_at_ms, booked_at_ms::text AS booked_at_ms,
            requested_reason, sub_reason, evidence_validated, checkin_validated,
            requested_at_ms::text AS requested_at_ms
       FROM core.booking_trip_cancellation_begin($1)`,
    [id],
  );
  const f = rows[0];
  if (f === undefined) throw new Error('demande non ouverte');
  return f;
}

/** Version proposée : trip du vecteur aux instants de la base, paramètres de test de 08. */
function proposal(w: World, f: Facts): SettlementRecord {
  const base = tripOfVector(w.vector);
  const trip = { ...base, startAtMs: Number(f.start_at_ms), bookedAtMs: Number(f.booked_at_ms) };
  const event: CancellationEvent = {
    reason: f.requested_reason,
    requestedAtMs: Number(f.requested_at_ms),
    ...(f.sub_reason === null ? {} : { subReason: f.sub_reason }),
    checkinValidated: f.checkin_validated,
  };
  return buildSettlementRecord(trip, event, testParams(base.currency));
}

interface Entry {
  readonly id: string;
  readonly org_id: string;
  readonly country_code: string;
  readonly currency: string;
  readonly trip_id: string;
  readonly segment_no: number;
  readonly settlement_id: string;
  readonly settlement_version: number;
  readonly reason: string;
  readonly amount_minor: string;
  readonly created_at: Date;
}

async function entriesOf(tx: Tx, trip: string): Promise<Entry[]> {
  const { rows } = await tx.query<Entry>('SELECT * FROM test_fixture.us709_entries($1)', [trip]);
  return rows;
}

/**
 * Transaction du travailleur (ANNULÉE), une minute après la demande : version 1, liaison et
 * transition (`booking_cmd_trip_settle_cancellation`), remboursement intégral du vecteur, puis
 * contrôles différés. `afterSettle` lit l'état juste après la liaison, AVANT les remboursements.
 */
async function settleInWorker<T>(
  worker: Tx,
  w: World,
  id: string,
  refundLegs: Legs,
  inspect: (tx: Tx, settlement: string, afterSettle: Entry[]) => Promise<T>,
): Promise<T> {
  return withTestTransaction(worker, { virtualNow: iso(w.requestedAtMs + MINUTE) }, async (tx) => {
    const f = await begin(tx, id);
    const settlement = await recordAsSettlementWorker(
      tx,
      { tripId: w.trip, version: 1, tripRowVersion: f.trip_row_version },
      proposal(w, f),
    );
    // aucune écriture avant la liaison du règlement à la demande
    expect(await entriesOf(tx, w.trip)).toEqual([]);
    await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
    const settled = await tx.query<{ r: { status?: string } }>(
      'SELECT core.booking_cmd_trip_settle_cancellation($1, $2) AS r',
      [id, settlement],
    );
    expect(settled.rows[0]?.r.status).toMatch(/^CANCELLED_BY_/);
    const afterSettle = await entriesOf(tx, w.trip);
    await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
    const { rows } = await tx.query<{ status: string }>(
      `SELECT status
         FROM core.payment_cmd_plan_refund($1, $2, $3, $4, 1, 'NATIVE_PARTIAL', $5::jsonb, $6, $6)`,
      [uuid(), uuid(), settlement, w.capture, legsJson(refundLegs), `${w.trip}:refund:${uuid()}`],
    );
    expect(rows[0]?.status).toBe('PLANNED');
    await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
    return inspect(tx, settlement, afterSettle);
  });
}

describe('critère 2 d’US-215 — pénalité de l’hôte portée au host_ledger, jamais comme jambe', () => {
  // remboursement intégral (FULL) : −TJ06 au PA (variation du règlement T14, 08 E7), tout
  // l'encaissé TJ08a au PY (16 BKG-032)
  it.each([
    [PA, 'T14', 'TJ01', neg(legsVector('TJ06'))],
    [PA, 'T15', 'TJ01', neg(legsVector('TJ06'))],
    [PY, 'T48', 'TJ08a', legsVector('TJ08a')],
  ] as const)(
    '%s %s : CANCEL_TRIP_HOST réglée ⇒ une écriture de débit = pénalité du vecteur, devise du pays, rattachée au trip, au règlement et à la version 1, à l’heure de la base, dans la transaction du règlement',
    async (c, vector, capture, refundLegs) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          const w = await world(worker, c, vector, capture);
          const id = await act(api, 'CANCEL_TRIP_HOST', w);
          const penalty = expected(vector).hostPenaltyMinor;
          expect(penalty > 0n).toBe(true);
          await settleInWorker(worker, w, id, refundLegs, async (tx, settlement, afterSettle) => {
            // écrite par la liaison du règlement elle-même (même instruction, même transaction)
            expect(afterSettle).toHaveLength(1);
            const entries = await entriesOf(tx, w.trip);
            expect(entries).toHaveLength(1);
            const e = entries[0];
            expect(e).toMatchObject({
              org_id: w.org,
              country_code: c.country,
              currency: c.currency,
              trip_id: w.trip,
              segment_no: 1,
              settlement_id: settlement,
              settlement_version: 1,
              reason: PENALTY,
            });
            // débit de l'hôte (signe négatif), unités mineures de la devise du pays (08 T62)
            expect(BigInt(e?.amount_minor ?? '0')).toBe(-penalty);
            // horodatage de l'annulation réglée = horloge de la base (platform.now())
            expect(e?.created_at.getTime()).toBe(w.requestedAtMs + MINUTE);
            // jamais une jambe : le remboursement du voyageur est intégral (FULL, TJ06 / TJ08a)
            await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
            const s = await tx.query<{ refund: string; pen: string }>(
              `SELECT guest_refund_minor::text AS refund, host_penalty_minor::text AS pen
                   FROM core.settlement_settlement WHERE id = $1`,
              [settlement],
            );
            const full = LEGS.reduce((sum, k) => sum + refundLegs[k], 0n);
            expect(full).toBe(legVector(golden, capture).totalMinor);
            expect(BigInt(s.rows[0]?.refund ?? '-1')).toBe(full);
            expect(BigInt(s.rows[0]?.pen ?? '-1')).toBe(penalty);
            // rejeu de la commande (travailleur trip_lifecycle) : l'écriture d'origine, rien de plus
            await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
            const again = await tx.query<{ id: string }>(
              'SELECT test_fixture.us709_call_post($1) AS id',
              [settlement],
            );
            expect(again.rows[0]?.id).toBe(e?.id);
            expect(await entriesOf(tx, w.trip)).toHaveLength(1);
          });
          // transaction du travailleur annulée : rien ne reste (écriture liée au règlement)
          await withTestTransaction(worker, {}, async (tx) => {
            expect(await entriesOf(tx, w.trip)).toEqual([]);
          });
        });
      });
    },
  );

  it.each([
    [PA, 'T03', 'TJ01', 'TJ02b'],
    [PY, 'T27', 'TJ08a', 'TJ08b'],
  ] as const)(
    '%s %s : annulation du voyageur (aucune pénalité de l’hôte) ⇒ aucune écriture',
    async (c, vector, capture, variation) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          const w = await world(worker, c, vector, capture);
          const id = await act(api, 'CANCEL_TRIP_GUEST', w);
          expect(expected(vector).hostPenaltyMinor).toBe(0n);
          await settleInWorker(
            worker,
            w,
            id,
            neg(legsVector(variation)),
            async (tx, settlement) => {
              expect(await entriesOf(tx, w.trip)).toEqual([]);
              await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
              const r = await tx.query<{ id: string | null }>(
                'SELECT test_fixture.us709_call_post($1) AS id',
                [settlement],
              );
              expect(r.rows[0]?.id).toBeNull();
            },
          );
        });
      });
    },
  );
});

describe('commande et table : gardes, immuabilité, aucun droit applicatif', () => {
  it('commande réservée au travailleur trip_lifecycle, règlement d’annulation v1 connu ; table immuable', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await world(worker, PA, 'T14', 'TJ01');
        const id = await act(api, 'CANCEL_TRIP_HOST', w);
        await settleInWorker(worker, w, id, neg(legsVector('TJ06')), async (tx, settlement) => {
          const entry = (await entriesOf(tx, w.trip))[0]?.id ?? '';
          for (const name of ['settlement', 'payment_command', 'payout']) {
            await setSessionContext(tx, { kind: 'WORKER', workerName: name });
            const e = await caught(tx, () =>
              tx.query('SELECT test_fixture.us709_call_post($1)', [settlement]),
            );
            expect(e, name).toMatchObject({
              code: '42501',
              constraint: 'host_ledger_command_forbidden',
            });
          }
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
          const unknown = await caught(tx, () =>
            tx.query('SELECT test_fixture.us709_call_post($1)', [uuid()]),
          );
          expect(unknown).toMatchObject({
            code: '23000',
            constraint: 'host_ledger_settlement_unknown',
          });
          // immuable, même sous le propriétaire de la table (contre-passation : US-709)
          for (const sql of [
            'SELECT test_fixture.us709_try_update($1)',
            'SELECT test_fixture.us709_try_delete($1)',
          ]) {
            const e = await caught(tx, () => tx.query(sql, [entry]));
            expect(e, sql).toMatchObject({ code: '23000', constraint: 'settlement_immutable' });
          }
          const t = await caught(tx, () => tx.query('SELECT test_fixture.us709_try_truncate()'));
          expect(t).toMatchObject({ code: '23000', constraint: 'settlement_immutable' });
        });
      });
    });
  });

  it('app_api et app_worker : ni écriture de la table, ni EXECUTE de la commande ou du déclencheur (42501)', async () => {
    for (const role of ['app_api', 'app_worker'] as const) {
      await withRole(role, async (client) => {
        for (const sql of [
          `INSERT INTO core.settlement_host_ledger_entry (id, org_id, country_code, currency, trip_id,
             segment_no, settlement_id, settlement_version, reason, amount_minor)
           VALUES ('${uuid()}', '${uuid()}', 'PA', 'USD', '${uuid()}', 1, '${uuid()}', 1,
                   '${PENALTY}', -1)`,
          `UPDATE core.settlement_host_ledger_entry SET amount_minor = -2`,
          `DELETE FROM core.settlement_host_ledger_entry`,
          `SELECT core.settlement_cmd_post_host_penalty('${uuid()}')`,
          'SELECT core.settlement_post_cancellation_penalty()',
        ]) {
          await expect(client.query(sql), `${role} ${sql}`).rejects.toMatchObject({
            code: '42501',
          });
        }
      });
    }
    // app_worker ne lit pas le host_ledger (aucun consommateur avant les versements, lot C)
    await withRole('app_worker', async (client) => {
      for (const rel of ['settlement_host_ledger_entry', 'settlement_host_ledger_balance_v']) {
        await expect(client.query(`SELECT count(*) FROM core.${rel}`), rel).rejects.toMatchObject({
          code: '42501',
        });
      }
    });
  });
});

describe('lecture de l’ops : solde par compte d’hôte et par devise, FINANCE / ADMIN du pays seulement', () => {
  it.each([
    [PA, PY, 'T14', 'T15'],
    [PY, PA, 'T48', 'T48'],
  ] as const)(
    '%s : deux pénalités d’un même hôte ⇒ solde = −Σ, deux écritures ; OPS, l’autre pays et sans session : rien',
    async (c, other, first, second) => {
      const org = uuid();
      const trips: string[] = [];
      const debits = [expected(first).hostPenaltyMinor, expected(second).hostPenaltyMinor];
      // deux règlements v1 VALIDÉS d'un même compte d'hôte (comme la matrice d'US-043), puis une
      // écriture par règlement (fixture 9949 : la commande n'écrit que sous la liaison d'une
      // annulation, prouvée ci-dessus)
      await withRole('app_worker', async (worker) => {
        await withTestTransaction(worker, { commit: true }, async (tx) => {
          for (const [i, vector] of [first, second].entries()) {
            const t = await insertTrip(tx, c, 60 + i, org);
            trips.push(t.id);
            await recordAsSettlementWorker(
              tx,
              { tripId: t.id, version: 1 },
              recordOfVector(vector),
            );
          }
        });
        await withTestTransaction(worker, { commit: true }, async (tx) => {
          for (const [i, trip] of trips.entries()) {
            await tx.query('SELECT test_fixture.us709_insert_entry($1, $2, $3::bigint)', [
              uuid(),
              trip,
              (debits[i] ?? 0n).toString(),
            ]);
          }
        });
      });
      await withRole('app_api', async (api) => {
        const staff = {
          FINANCE: await createStaff(api, 'FINANCE', [c.country], { withFactor: false }),
          ADMIN: await createStaff(api, 'ADMIN', [c.country], { withFactor: false }),
          OPS_AGENT: await createStaff(api, 'OPS_AGENT', [c.country], { withFactor: false }),
          SUPPORT_AGENT: await createStaff(api, 'SUPPORT_AGENT', [c.country], {
            withFactor: false,
          }),
          FINANCE_other: await createStaff(api, 'FINANCE', [other.country], { withFactor: false }),
        };
        const read = async (
          userId: string,
          scope: readonly string[],
          elevated = true,
        ): Promise<{ balance: string | null; entries: number; rows: number }> =>
          withTestTransaction(api, {}, async (tx) => {
            const hash = newHash();
            if (elevated) {
              await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [
                userId,
                hash,
              ]);
            }
            await setSessionContext(tx, {
              kind: 'STAFF',
              actorId: userId,
              countryScope: scope,
              sessionTokenHash: hash.toString('hex'),
            });
            const b = await tx.query<{ balance: string; entries: number }>(
              `SELECT balance_minor::text AS balance, entries
                 FROM core.settlement_host_ledger_balance_v WHERE org_id = $1 AND currency = $2`,
              [org, c.currency],
            );
            const e = await tx.query(
              'SELECT id FROM core.settlement_host_ledger_entry WHERE org_id = $1',
              [org],
            );
            return {
              balance: b.rows[0]?.balance ?? null,
              entries: b.rows[0]?.entries ?? 0,
              rows: e.rowCount ?? 0,
            };
          });
        const total = -(debits[0] ?? 0n) - (debits[1] ?? 0n);
        for (const who of ['FINANCE', 'ADMIN'] as const) {
          expect(await read(staff[who].userId, [c.country]), who).toEqual({
            balance: total.toString(),
            entries: 2,
            rows: 2,
          });
        }
        const none = { balance: null, entries: 0, rows: 0 };
        for (const who of ['OPS_AGENT', 'SUPPORT_AGENT'] as const) {
          expect(await read(staff[who].userId, [c.country]), who).toEqual(none);
        }
        // FINANCE de l'autre pays, même en posant les deux pays dans son contexte : rien
        expect(await read(staff.FINANCE_other.userId, [other.country, c.country])).toEqual(none);
        // FINANCE sans session élevée : rien
        expect(await read(staff.FINANCE.userId, [c.country], false)).toEqual(none);
      });
    },
  );
});
