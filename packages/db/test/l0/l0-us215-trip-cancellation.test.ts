/**
 * US-215 (partie 215a, migration 0123, ADR-148) — annulations du voyageur, de l'hôte et de la
 * plateforme déclenchées par l'ops : demande par la console (cadre d'US-101), règlement par le
 * moteur unique DANS la transaction de la transition (invariant 4 de SM-1), remboursements par les
 * ordres bornés d'US-224a (0121), en USD (PA) et en PYG sans décimale (PY).
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête) : app_api pour la console
 * (staff enrôlé et élevé par les vraies commandes), app_worker pour le travailleur (trip_lifecycle,
 * settlement, payment_command dans UNE transaction). La préparation (trip, capture) et la demande
 * de la console sont VALIDÉES (deux rôles) sur des trips et des véhicules neufs ; la transaction du
 * travailleur est ANNULÉE après `SET CONSTRAINTS ALL IMMEDIATE` (contrôles différés exécutés).
 * Fichier isolé (`vitest.l0.config.ts`) : compte PSP FAKE ACTIVE du pays partagé (fixture 9800).
 *
 * Attendus : vecteurs de l'export des oracles (`docs/specs/tools/golden_vectors.json`,
 * `@rueda/money/golden-vectors`) — T03 / TJ02b (critère 1), T14 / TJ06, T15, T76 (critère 2), T19,
 * T22, T16 (critère 3), T07 / T08 (critère 4), T27 / TJ08a / TJ08b (critère 5, PYG) ; 08 T61 (a)
 * (paramètre absent ⇒ compensation 0,00) ; 16 BKG-032 / BKG-035 (remboursement intégral, pénalité
 * hors jambes, `cost_bearer`) ; paramètres de test de 08 (graine 0009). Jamais le code testé : le
 * moteur ne sert qu'à construire la version proposée, que la base rejoue (0054) et LIE à la demande.
 */
import {
  buildSettlementRecord,
  canonicalJson,
  type CancellationEvent,
  type SettlementRecord,
} from '@rueda/money';
import { legVector, settlementVector } from '@rueda/money/golden-vectors';
import { testParams } from '@rueda/money/testing';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { applySignedStatus, caught, recordOperation, uuid } from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { golden, legsOf, recordAsSettlementWorker, tripOfVector } from '../support/settlement.ts';
import { newHash } from '../support/golive.ts';
import { elevatedStaff, installTestProofKey } from '../support/staff.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const MINUTE = 60_000;
const REASON = 'Demande du support, motif de test';
const ACT =
  'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])';

const PA = COUNTRIES.find((c) => c.currency === 'USD');
const PY = COUNTRIES.find((c) => c.currency === 'PYG');
if (PA === undefined || PY === undefined) throw new Error('pays PA / PY attendus (avl.ts)');

const legsVector = (id: string): Legs => ({ ...legVector(golden, id).legsMinor }) as Legs;
const neg = (l: Legs): Legs => Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
const expected = (id: string) => settlementVector(golden, id).expected;
const iso = (ms: number): string => new Date(ms).toISOString();

beforeAll(async () => {
  await withRole('app_api', (client) => installTestProofKey(client));
});

interface Staff {
  readonly userId: string;
  readonly hash: Buffer;
}

interface World {
  readonly c: CountryCase;
  readonly trip: string;
  readonly account: string;
  /** Instant de la demande à la console (minute ronde, juste après l'heure réelle). */
  readonly requestedAtMs: number;
  readonly startAtMs: number;
  readonly vector: string;
}

/**
 * Instant de la demande à la console : fenêtre virtuelle lointaine (2031), une minute ronde ; la
 * session de staff est ouverte à cet instant (fixture 9650), comme les preuves d'US-108.
 */
const REQUESTED_AT_MS = Date.UTC(2031, 2, 10, 12, 0, 0);

/**
 * Trip du vecteur `vector` dont le départ est `startAtMs` (réservation au décalage du vecteur),
 * capturé par les jambes `capture` (vrai webhook signé, report sur les soldes). VALIDÉ.
 */
async function worldAt(
  worker: Tx,
  c: CountryCase,
  vector: string,
  capture: string,
  startAtMs: number,
  options: { readonly checkinOpen?: boolean; readonly status?: string } = {},
): Promise<World> {
  const v = settlementVector(golden, vector);
  if (v.currency !== c.currency) throw new Error(`${vector} n'est pas en ${c.currency}`);
  const bookedAtMs = startAtMs + v.trip.bookedAtMinutes * MINUTE;
  const trip = uuid();
  const capLegs = legsVector(capture);
  const total = LEGS.reduce((s, k) => s + capLegs[k], 0n);
  let account = '';
  await withTestTransaction(worker, { virtualNow: iso(bookedAtMs), commit: true }, async (tx) => {
    await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
    await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      trip,
      uuid(),
      uuid(),
      uuid(),
      c.country,
      c.currency,
      c.timezone,
      iso(startAtMs),
      iso(startAtMs + v.trip.days * 24 * 60 * MINUTE),
    ]);
    // compte FAKE ACTIVE du pays partagé par les fichiers isolés (fixture 9800 : réutilisé s'il
    // existe, un seul compte ACTIVE par pays) ; jamais un nouveau compte ACTIVE validé
    const a = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
      c.country,
    ]);
    account = a.rows[0]?.id ?? '';
    const op = await recordOperation(tx, {
      tripId: trip,
      accountId: account,
      kind: 'CAPTURE',
      amountMinor: total,
      currency: c.currency,
      idemPlain: `trip:${trip}:capture:${uuid()}`,
      legs: capLegs,
    });
    expect(await applySignedStatus(tx, op.operation_id, 'SUCCEEDED')).toBe('APPLIED');
    const moved = await tx.query<{ r: string }>(
      'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
      [op.operation_id],
    );
    expect(moved.rows[0]?.r).toBe('APPLIED');
    if (options.checkinOpen === true) {
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
      await tx.query(
        `SELECT core.booking_cmd_trip_transition($1, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED', NULL)`,
        [trip],
      );
    }
    if (options.status !== undefined) {
      await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [trip, options.status]);
    }
  });
  return { c, trip, account, requestedAtMs: REQUESTED_AT_MS, startAtMs, vector };
}

/** Trip du vecteur : la demande tombe au décalage du vecteur avant (ou après) le départ. */
function world(
  worker: Tx,
  c: CountryCase,
  vector: string,
  capture: string,
  options: { readonly checkinOpen?: boolean; readonly status?: string } = {},
): Promise<World> {
  const at = settlementVector(golden, vector).event.requestedAtMinutes;
  if (at === undefined) throw new Error(`${vector} : instant de demande absent`);
  return worldAt(worker, c, vector, capture, REQUESTED_AT_MS - at * MINUTE, options);
}

interface Outcome {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}

/** Action de console sous le contexte STAFF de l'API, à l'instant de la demande. VALIDÉE. */
async function act(
  api: Tx,
  staff: Staff,
  action: string,
  w: World,
  options: {
    readonly input?: Record<string, unknown>;
    readonly evidence?: readonly string[];
    readonly requestId?: string;
  } = {},
): Promise<Outcome> {
  return withTestTransaction(
    api,
    { virtualNow: iso(w.requestedAtMs), commit: true },
    async (tx) => {
      // session élevée ouverte à l'instant virtuel de la demande (fixture 9650, comme US-108)
      const hash = newHash();
      await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [staff.userId, hash]);
      await setSessionContext(tx, {
        kind: 'STAFF',
        actorId: staff.userId,
        countryScope: [w.c.country],
        sessionTokenHash: hash.toString('hex'),
      });
      const { rows } = await tx.query<Outcome>(ACT, [
        hash,
        options.requestId ?? uuid(),
        action,
        w.trip,
        REASON,
        options.input ?? {},
        options.evidence ?? [],
      ]);
      return rows[0] ?? { outcome: '', action_id: null, domain_ref: null, detail: null };
    },
  );
}

async function evidenceFile(api: Tx): Promise<string> {
  const id = uuid();
  await api.query('SELECT test_fixture.us101_insert_file($1, $2)', [id, 'PRIVATE_EVIDENCE']);
  return id;
}

interface Facts {
  readonly cancellation_id: string;
  readonly trip_id: string;
  readonly segment_id: string;
  readonly trip_row_version: number;
  readonly start_at_ms: string;
  readonly booked_at_ms: string;
  readonly requested_reason: string;
  readonly sub_reason: string | null;
  readonly evidence_validated: boolean;
  readonly checkin_validated: boolean;
  readonly requested_at_ms: string;
  readonly params: unknown;
}

async function begin(tx: Tx, id: string): Promise<Facts | undefined> {
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
  const { rows } = await tx.query<Facts>(
    `SELECT cancellation_id, trip_id, segment_id, trip_row_version,
            start_at_ms::text AS start_at_ms, booked_at_ms::text AS booked_at_ms,
            requested_reason, sub_reason, evidence_validated, checkin_validated,
            requested_at_ms::text AS requested_at_ms, params
       FROM core.booking_trip_cancellation_begin($1)`,
    [id],
  );
  return rows[0];
}

/** Événement de la demande, dans la forme que la base contrôle (ADR-148). */
function eventOf(f: Facts, over: Partial<CancellationEvent> = {}): CancellationEvent {
  return {
    reason: f.requested_reason,
    requestedAtMs: Number(f.requested_at_ms),
    ...(f.sub_reason === null ? {} : { subReason: f.sub_reason }),
    ...(f.requested_reason === 'HOST_CANCELLED_DUE_TO_GUEST'
      ? { evidenceValidated: f.evidence_validated }
      : {}),
    checkinValidated: f.checkin_validated,
    ...over,
  };
}

/** Version proposée : trip du vecteur aux instants de la base, paramètres de test de 08. */
function proposal(
  w: World,
  f: Facts,
  over: { readonly event?: Partial<CancellationEvent>; readonly startShiftMs?: number } = {},
): SettlementRecord {
  const base = tripOfVector(w.vector);
  const trip = {
    ...base,
    startAtMs: Number(f.start_at_ms) + (over.startShiftMs ?? 0),
    bookedAtMs: Number(f.booked_at_ms),
  };
  return buildSettlementRecord(trip, eventOf(f, over.event), testParams(base.currency));
}

async function settle(tx: Tx, cancellation: string, settlement: string): Promise<unknown> {
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
  const { rows } = await tx.query<{ r: unknown }>(
    'SELECT core.booking_cmd_trip_cancel_settle($1, $2) AS r',
    [cancellation, settlement],
  );
  return rows[0]?.r;
}

async function refund(
  tx: Tx,
  w: World,
  settlement: string,
  legs: Legs,
): Promise<{ operation_id: string }> {
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
  return recordOperation(tx, {
    tripId: w.trip,
    accountId: w.account,
    kind: 'REFUND',
    amountMinor: LEGS.reduce((s, k) => s + legs[k], 0n),
    currency: w.c.currency,
    idemPlain: `${w.trip}:refund:${uuid()}`,
    legs,
    settlement: { id: settlement, version: 1 },
  });
}

const constraintOf = (e: { constraint?: string } | null): string | undefined => e?.constraint;

/** Transaction du travailleur (ANNULÉE), une minute après la demande. */
async function asWorker<T>(worker: Tx, w: World, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTestTransaction(worker, { virtualNow: iso(w.requestedAtMs + MINUTE) }, fn);
}

async function cancellationRow(tx: Tx, id: string) {
  const { rows } = await tx.query<{
    trip_id: string;
    action_code: string;
    requested_reason: string;
    initiator: string;
    sub_reason: string | null;
    status: string;
    settlement_id: string | null;
    cost_bearer: string | null;
    outcome_code: string | null;
    requested_at: Date;
    requested_by: string;
    decided: boolean;
  }>('SELECT * FROM test_fixture.us215_cancellation($1)', [id]);
  return rows[0];
}

/** Règlement complet d'une demande valide : version, transition, remboursement du vecteur. */
async function settleFully(
  tx: Tx,
  w: World,
  id: string,
  variation: Legs,
): Promise<{ settlement: string; result: Record<string, unknown>; record: SettlementRecord }> {
  const f = await begin(tx, id);
  if (f === undefined) throw new Error('demande non ouverte');
  const record = proposal(w, f);
  const settlement = await recordAsSettlementWorker(
    tx,
    { tripId: w.trip, version: 1, tripRowVersion: f.trip_row_version },
    record,
  );
  const result = (await settle(tx, id, settlement)) as Record<string, unknown>;
  if (record.guestRefundMinor > 0n) await refund(tx, w, settlement, neg(variation));
  await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
  return { settlement, result, record };
}

async function staffOf(api: Tx, c: CountryCase, role = 'OPS_AGENT'): Promise<Staff> {
  const s = await elevatedStaff(api, role, [c.country]);
  return { userId: s.userId, hash: s.hash };
}

describe('critère 1 — annulation du voyageur (T03, PA) et variante PYG (T27, critère 5)', () => {
  it.each([
    [PA, 'T03', 'TJ01', 'TJ02b'],
    [PY, 'T27', 'TJ08a', 'TJ08b'],
  ] as const)(
    '%s : CANCEL_TRIP_GUEST ⇒ demande (motif et initiateur dérivés) ; règlement dans la transition, remboursement par jambe du vecteur, sans saisie de montant',
    async (c, vector, capture, variation) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          const w = await world(worker, c, vector, capture);
          const ops = await staffOf(api, c);
          const r = await act(api, ops, 'CANCEL_TRIP_GUEST', w);
          expect(r.outcome).toBe('DONE');
          const id = r.domain_ref ?? '';
          expect(id).toBe(r.action_id);

          await asWorker(worker, w, async (tx) => {
            const row = await cancellationRow(tx, id);
            expect(row).toMatchObject({
              trip_id: w.trip,
              action_code: 'CANCEL_TRIP_GUEST',
              requested_reason: 'GUEST_CANCELLED',
              initiator: 'GUEST',
              sub_reason: null,
              status: 'PENDING',
              requested_by: ops.userId,
              decided: false,
            });
            expect(row?.requested_at.getTime()).toBe(w.requestedAtMs);
            const f = await begin(tx, id);
            // paramètres du pays en base = paramètres de test de 08 (graine 0009)
            expect(f?.params).toEqual(
              JSON.parse(canonicalJson(testParams(tripOfVector(vector).currency))),
            );
            expect(Number(f?.requested_at_ms)).toBe(w.requestedAtMs);
            expect(Number(f?.start_at_ms)).toBe(w.startAtMs);

            const { settlement, result, record } = await settleFully(
              tx,
              w,
              id,
              legsVector(variation),
            );
            expect(record.guestRefundMinor).toBe(expected(vector).guestRefundMinor);
            expect(result).toMatchObject({
              status: 'CANCELLED_BY_GUEST',
              reason: 'GUEST_CANCELLED',
              origin: 'EVENT',
              settlementId: settlement,
              costBearer: 'GUEST',
              replayed: false,
            });
            // jambes de la version = variation du vecteur (jamais un prorata)
            await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
            const legs = Object.fromEntries(
              (await legsOf(tx, settlement)).map((l) => [l.leg, l.variation]),
            );
            expect(legs).toEqual(legsVector(variation));
            // invariant 4 : settlement_id au journal et dans trip.status_changed
            const log = await tx.query<{ to_status: string; settlement_id: string | null }>(
              'SELECT to_status, settlement_id FROM test_fixture.us207_state_log($1)',
              [w.trip],
            );
            expect(log.rows.at(-1)).toEqual({
              to_status: 'CANCELLED_BY_GUEST',
              settlement_id: settlement,
            });
            const ev = await tx.query<{ type: string; payload: Record<string, unknown> }>(
              'SELECT type, payload FROM test_fixture.us207_events($1)',
              [w.trip],
            );
            expect(
              ev.rows.filter((e) => e.type === 'trip.status_changed').at(-1)?.payload,
            ).toMatchObject({
              to: 'CANCELLED_BY_GUEST',
              settlement_id: settlement,
            });
            // créneau libéré dans la même transaction ; initiateur et heure de la DEMANDE
            const occ = await tx.query<{
              vehicle_active: boolean;
              guest_active: boolean;
              cancel_initiator: string;
              cancel_requested_at: Date;
            }>('SELECT * FROM test_fixture.us215_occupancy($1)', [w.trip]);
            expect(occ.rows[0]).toMatchObject({
              vehicle_active: false,
              guest_active: false,
              cancel_initiator: 'GUEST',
            });
            expect(occ.rows[0]?.cancel_requested_at.getTime()).toBe(w.requestedAtMs);
            expect(await cancellationRow(tx, id)).toMatchObject({
              status: 'SETTLED',
              settlement_id: settlement,
              cost_bearer: 'GUEST',
              decided: true,
            });
          });
        });
      });
    },
  );
});

describe('critère 2 — annulation de l’hôte : remboursement intégral, pénalité hors jambes', () => {
  it.each([
    [PA, 'T14', 'TJ01', 'TJ06'],
    [PA, 'T15', 'TJ01', 'TJ06'],
    [PA, 'T76', 'TJ01', 'TJ06'],
  ] as const)(
    '%s %s : CANCEL_TRIP_HOST ⇒ CANCELLED_BY_HOST, remboursement intégral (TJ06), pénalité du palier au règlement',
    async (c, vector, capture, variation) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          const w = await world(worker, c, vector, capture);
          const r = await act(api, await staffOf(api, c), 'CANCEL_TRIP_HOST', w);
          expect(r.outcome).toBe('DONE');
          await asWorker(worker, w, async (tx) => {
            const { settlement, result, record } = await settleFully(
              tx,
              w,
              r.domain_ref ?? '',
              legsVector(variation),
            );
            expect(result).toMatchObject({ status: 'CANCELLED_BY_HOST', costBearer: 'HOST' });
            expect(record.guestRefundMinor).toBe(expected(vector).guestRefundMinor);
            await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
            const s = await tx.query<{ pen: string; refund: string }>(
              `SELECT host_penalty_minor::text AS pen, guest_refund_minor::text AS refund
                 FROM core.settlement_settlement WHERE id = $1`,
              [settlement],
            );
            // 08 E7 règle 7 : pénalité portée par le règlement (ajustement du host_ledger), en
            // unités mineures de la devise du pays (T62), jamais par une jambe
            expect(BigInt(s.rows[0]?.pen ?? '-1')).toBe(expected(vector).hostPenaltyMinor);
            const legs = Object.fromEntries(
              (await legsOf(tx, settlement)).map((l) => [l.leg, l.variation]),
            );
            expect(legs).toEqual(legsVector(variation));
          });
        });
      });
    },
  );

  it('PY (PYG) : même annulation de l’hôte à T−30 h sur le trip D ⇒ remboursement intégral (−TJ08a), pénalité cxlEarly du barème de test de 08', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        // trip D (T27) ; la demande est faite 30 h avant le départ (comme T14 au PA)
        const d = await worldAt(worker, PY, 'T27', 'TJ08a', REQUESTED_AT_MS + 1800 * MINUTE);
        const r = await act(api, await staffOf(api, PY), 'CANCEL_TRIP_HOST', d);
        expect(r.outcome).toBe('DONE');
        await asWorker(worker, d, async (tx) => {
          const capture = legsVector('TJ08a');
          const { settlement, result, record } = await settleFully(
            tx,
            d,
            r.domain_ref ?? '',
            neg(capture),
          );
          expect(result).toMatchObject({ status: 'CANCELLED_BY_HOST', costBearer: 'HOST' });
          // FULL (16 BKG-032) : tout l'encaissé est rendu
          expect(record.guestRefundMinor).toBe(legVector(golden, 'TJ08a').totalMinor);
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          const s = await tx.query<{ pen: string }>(
            'SELECT host_penalty_minor::text AS pen FROM core.settlement_settlement WHERE id = $1',
            [settlement],
          );
          const schedule = testParams(tripOfVector('T27').currency).hostPenalty;
          expect(BigInt(s.rows[0]?.pen ?? '-1')).toBe(schedule?.cxlEarly.amountMinor);
        });
      });
    });
  });
});

describe('critère 3 — annulation de la plateforme : cost_bearer renseigné, T61 (a)', () => {
  it.each([
    ['T19', 'PLATFORM_TRUST_SAFETY', 'PLATFORM'],
    ['T22', 'HOST_ACCOUNT_CLOSED', 'HOST'],
    ['T16', 'PLATFORM_INCOMPLETE_STEPS', 'GUEST'],
  ] as const)(
    'PA %s (%s) : CANCELLED_BY_PLATFORM, remboursement du vecteur, gains de l’hôte du vecteur, porteur du coût %s',
    async (vector, platformReason, bearer) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          const w = await world(worker, PA, vector, 'TJ01');
          const r = await act(api, await staffOf(api, PA), 'CANCEL_TRIP_PLATFORM', w, {
            input: { platformReason },
          });
          expect(r.outcome).toBe('DONE');
          await asWorker(worker, w, async (tx) => {
            const f = await begin(tx, r.domain_ref ?? '');
            if (f === undefined) throw new Error('demande non ouverte');
            const record = proposal(w, f);
            expect(record.guestRefundMinor).toBe(expected(vector).guestRefundMinor);
            expect(record.hostEarningsMinor).toBe(expected(vector).hostEarningsMinor);
            const settlement = await recordAsSettlementWorker(
              tx,
              { tripId: w.trip, version: 1, tripRowVersion: f.trip_row_version },
              record,
            );
            const result = await settle(tx, r.domain_ref ?? '', settlement);
            expect(result).toMatchObject({
              status: 'CANCELLED_BY_PLATFORM',
              reason: platformReason,
              costBearer: bearer,
            });
            await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
            const legs = await legsOf(tx, settlement);
            await refund(
              tx,
              w,
              settlement,
              Object.fromEntries(legs.map((l) => [l.leg, -l.variation])) as unknown as Legs,
            );
            await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
            expect(await cancellationRow(tx, r.domain_ref ?? '')).toMatchObject({
              status: 'SETTLED',
              cost_bearer: bearer,
            });
          });
        });
      });
    },
  );

  it('PA T61 (a) : PLATFORM_REVIEW_DELAY à T−2 h, paramètre de compensation absent ⇒ compensation 0,00 et remboursement intégral', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await worldAt(worker, PA, 'T03', 'TJ01', REQUESTED_AT_MS + 120 * MINUTE);
        const r = await act(api, await staffOf(api, PA), 'CANCEL_TRIP_PLATFORM', w, {
          input: { platformReason: 'PLATFORM_REVIEW_DELAY' },
        });
        expect(r.outcome).toBe('DONE');
        await asWorker(worker, w, async (tx) => {
          const f = await begin(tx, r.domain_ref ?? '');
          if (f === undefined) throw new Error('demande non ouverte');
          // DEC-FONDATEUR-01 : aucune valeur du paramètre en base (option B)
          expect(f.params).not.toHaveProperty('platformFundedHostCompensation');
          const { settlement, result, record } = await settleFully(
            tx,
            w,
            r.domain_ref ?? '',
            neg(legsVector('TJ01')),
          );
          expect(result).toMatchObject({ costBearer: 'PLATFORM' });
          expect(record.hostCompensationMinor).toBe(0n);
          expect(record.guestRefundMinor).toBe(legVector(golden, 'TJ01').totalMinor);
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          const s = await tx.query<{ comp: string }>(
            `SELECT host_compensation_minor::text AS comp FROM core.settlement_settlement
              WHERE id = $1`,
            [settlement],
          );
          expect(s.rows[0]?.comp).toBe('0');
        });
      });
    });
  });

  it('motif plateforme absent ⇒ CANCEL_REASON_REQUIRED journalisé, rien d’écrit ; montant saisi ⇒ 22023', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await world(worker, PA, 'T19', 'TJ01');
        const ops = await staffOf(api, PA);
        expect(await act(api, ops, 'CANCEL_TRIP_PLATFORM', w)).toMatchObject({
          outcome: 'REFUSED',
          detail: 'CANCEL_REASON_REQUIRED',
        });
        for (const input of [
          { refundMinor: 'PLATFORM_TRUST_SAFETY' },
          { platformReason: 'PLATFORM_TRUST_SAFETY', amount: 'X' },
          { platformReason: '18744' },
          { platformReason: 'GUEST_CANCELLED' },
        ]) {
          await expect(
            act(api, ops, 'CANCEL_TRIP_PLATFORM', w, { input }),
            JSON.stringify(input),
          ).rejects.toMatchObject({ code: '22023' });
        }
        await expect(
          act(api, ops, 'CANCEL_TRIP_GUEST', w, { input: { subReason: 'INVALID_LICENSE' } }),
        ).rejects.toMatchObject({ code: '22023' });
      });
    });
  });
});

describe('critère 4 — « à cause du voyageur » : la qualification dépend de la preuve validée', () => {
  it('PA T07 : sous-motif et pièce jointe ⇒ NO_SHOW_GUEST, remboursement du vecteur ; T08 : sans pièce ⇒ CANCELLED_BY_HOST (REQUALIFIED_NO_EVIDENCE), pénalité', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        // avec la pièce (T07)
        const w7 = await world(worker, PA, 'T07', 'TJ01', { checkinOpen: true });
        const proof = await evidenceFile(api);
        const r7 = await act(api, await staffOf(api, PA), 'CANCEL_TRIP_HOST', w7, {
          input: { subReason: 'INVALID_LICENSE' },
          evidence: [proof],
        });
        expect(r7.outcome).toBe('DONE');
        await asWorker(worker, w7, async (tx) => {
          const f = await begin(tx, r7.domain_ref ?? '');
          expect(f).toMatchObject({
            requested_reason: 'HOST_CANCELLED_DUE_TO_GUEST',
            sub_reason: 'INVALID_LICENSE',
            evidence_validated: true,
          });
          if (f === undefined) throw new Error('demande non ouverte');
          const record = proposal(w7, f);
          expect(record.reason).toBe(expected('T07').qualifiedReason);
          expect(record.guestRefundMinor).toBe(expected('T07').guestRefundMinor);
          const settlement = await recordAsSettlementWorker(
            tx,
            { tripId: w7.trip, version: 1, tripRowVersion: f.trip_row_version },
            record,
          );
          expect(await settle(tx, r7.domain_ref ?? '', settlement)).toMatchObject({
            status: 'NO_SHOW_GUEST',
            origin: 'EVENT',
            costBearer: 'GUEST',
          });
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          const legs = await legsOf(tx, settlement);
          await refund(
            tx,
            w7,
            settlement,
            Object.fromEntries(legs.map((l) => [l.leg, -l.variation])) as unknown as Legs,
          );
          await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
        });

        // sans pièce (T08) : même sous-motif, aucune preuve stockée
        const w8 = await world(worker, PA, 'T08', 'TJ01', { checkinOpen: true });
        const r8 = await act(api, await staffOf(api, PA), 'CANCEL_TRIP_HOST', w8, {
          input: { subReason: 'INVALID_LICENSE' },
        });
        expect(r8.outcome).toBe('DONE');
        await asWorker(worker, w8, async (tx) => {
          const f = await begin(tx, r8.domain_ref ?? '');
          expect(f?.evidence_validated).toBe(false);
          const { result, record, settlement } = await settleFully(
            tx,
            w8,
            r8.domain_ref ?? '',
            neg(legsVector('TJ01')),
          );
          expect(result).toMatchObject({
            status: 'CANCELLED_BY_HOST',
            reason: 'HOST_CANCELLED',
            origin: 'REQUALIFIED_NO_EVIDENCE',
            costBearer: 'HOST',
          });
          expect(record.guestRefundMinor).toBe(expected('T08').guestRefundMinor);
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          const s = await tx.query<{ pen: string }>(
            'SELECT host_penalty_minor::text AS pen FROM core.settlement_settlement WHERE id = $1',
            [settlement],
          );
          expect(BigInt(s.rows[0]?.pen ?? '-1')).toBe(expected('T08').hostPenaltyMinor);
        });
      });
    });
  });
});

describe('liaison du règlement à la demande (N-131) : toute version qui ne dit pas les faits de la base est refusée', () => {
  const MISMATCHES: readonly (readonly [
    string,
    (f: Facts) => { readonly event?: Partial<CancellationEvent>; readonly startShiftMs?: number },
  ])[] = [
    [
      'instant de la demande décalé d’une minute',
      (f) => ({ event: { requestedAtMs: Number(f.requested_at_ms) + MINUTE } }),
    ],
    ['motif demandé changé', () => ({ event: { reason: 'HOST_CANCELLED' } })],
    ['check-in déclaré', () => ({ event: { checkinValidated: true } })],
    ['départ décalé d’une minute', () => ({ startShiftMs: MINUTE })],
  ];
  it.each(MISMATCHES)(
    'PA : %s ⇒ trip_cancellation_settlement_mismatch, rien d’écrit',
    async (_l, over) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          const w = await world(worker, PA, 'T03', 'TJ01');
          const r = await act(api, await staffOf(api, PA), 'CANCEL_TRIP_GUEST', w);
          await asWorker(worker, w, async (tx) => {
            const f = await begin(tx, r.domain_ref ?? '');
            if (f === undefined) throw new Error('demande non ouverte');
            const record = proposal(w, f, over(f));
            const settlement = await recordAsSettlementWorker(
              tx,
              { tripId: w.trip, version: 1, tripRowVersion: f.trip_row_version },
              record,
            );
            const e = await caught(tx, () => settle(tx, r.domain_ref ?? '', settlement));
            expect(constraintOf(e)).toBe('trip_cancellation_settlement_mismatch');
            expect(translateDbError(e).code).toBe('INVARIANT_VIOLATION');
            expect(await cancellationRow(tx, r.domain_ref ?? '')).toMatchObject({
              status: 'PENDING',
            });
          });
        });
      });
    },
  );

  it('PA : paramètres du pays changés après le calcul (no_show_grace_minutes) ⇒ refus', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await world(worker, PA, 'T03', 'TJ01');
        const r = await act(api, await staffOf(api, PA), 'CANCEL_TRIP_GUEST', w);
        await asWorker(worker, w, async (tx) => {
          const f = await begin(tx, r.domain_ref ?? '');
          if (f === undefined) throw new Error('demande non ouverte');
          const base = tripOfVector('T03');
          const record = buildSettlementRecord(
            { ...base, startAtMs: Number(f.start_at_ms), bookedAtMs: Number(f.booked_at_ms) },
            eventOf(f),
            testParams(base.currency, { noShowGraceMinutes: 45 }),
          );
          const settlement = await recordAsSettlementWorker(
            tx,
            { tripId: w.trip, version: 1, tripRowVersion: f.trip_row_version },
            record,
          );
          const e = await caught(tx, () => settle(tx, r.domain_ref ?? '', settlement));
          expect(constraintOf(e)).toBe('trip_cancellation_settlement_mismatch');
        });
      });
    });
  });

  it('PA : règlement sans remboursement, ou remboursé d’une unité de moins ⇒ trip_cancellation_unrefunded à la validation', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await world(worker, PA, 'T03', 'TJ01');
        const r = await act(api, await staffOf(api, PA), 'CANCEL_TRIP_GUEST', w);
        for (const short of [null, 1n] as const) {
          await asWorker(worker, w, async (tx) => {
            const f = await begin(tx, r.domain_ref ?? '');
            if (f === undefined) throw new Error('demande non ouverte');
            const record = proposal(w, f);
            const settlement = await recordAsSettlementWorker(
              tx,
              { tripId: w.trip, version: 1, tripRowVersion: f.trip_row_version },
              record,
            );
            await settle(tx, r.domain_ref ?? '', settlement);
            if (short !== null) {
              const legs = neg(legsVector('TJ02b'));
              await refund(tx, w, settlement, { ...legs, HOST: legs.HOST - short });
            }
            const e = await caught(tx, () => tx.query('SET CONSTRAINTS ALL IMMEDIATE'));
            expect(constraintOf(e), String(short)).toBe('trip_cancellation_unrefunded');
          });
        }
      });
    });
  });

  it('PA : rejeu du même règlement ⇒ issue d’origine (replayed) ; autre règlement ⇒ CANCELLATION_NOT_PENDING', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await world(worker, PA, 'T03', 'TJ01');
        const r = await act(api, await staffOf(api, PA), 'CANCEL_TRIP_GUEST', w);
        await asWorker(worker, w, async (tx) => {
          const { settlement } = await settleFully(tx, w, r.domain_ref ?? '', legsVector('TJ02b'));
          expect(await settle(tx, r.domain_ref ?? '', settlement)).toMatchObject({
            settlementId: settlement,
            costBearer: 'GUEST',
            replayed: true,
          });
          const e = await caught(tx, () => settle(tx, r.domain_ref ?? '', uuid()));
          expect(constraintOf(e)).toBe('trip_cancellation_closed');
          expect(translateDbError(e).code).toBe('CANCELLATION_NOT_PENDING');
          // une demande réglée n'est plus ouverte
          expect(await begin(tx, r.domain_ref ?? '')).toBeUndefined();
        });
      });
    });
  });
});

describe('console : une demande vivante par trip, état du trip, rôles', () => {
  it('PA : seconde demande pendant la première ⇒ CANCELLATION_PENDING ; trip commencé ⇒ TRIP_TRANSITION_FORBIDDEN ; FINANCE ⇒ FORBIDDEN', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await world(worker, PA, 'T03', 'TJ01');
        const ops = await staffOf(api, PA);
        expect((await act(api, ops, 'CANCEL_TRIP_GUEST', w)).outcome).toBe('DONE');
        expect(await act(api, ops, 'CANCEL_TRIP_HOST', w)).toMatchObject({
          outcome: 'REFUSED',
          detail: 'CANCELLATION_PENDING',
        });
        const started = await world(worker, PA, 'T03', 'TJ01', { status: 'IN_PROGRESS' });
        expect(await act(api, ops, 'CANCEL_TRIP_GUEST', started)).toMatchObject({
          outcome: 'REFUSED',
          detail: 'TRIP_TRANSITION_FORBIDDEN',
        });
        const finance = await staffOf(api, PA, 'FINANCE');
        for (const a of ['CANCEL_TRIP_GUEST', 'CANCEL_TRIP_HOST', 'CANCEL_TRIP_PLATFORM']) {
          expect((await act(api, finance, a, w)).outcome, a).toBe('FORBIDDEN');
        }
      });
    });
  });

  it('PA : demande garée (FAILED) ⇒ trip inchangé, nouvelle demande admise ; commandes du travailleur refusées hors trip_lifecycle et sous app_api', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await world(worker, PA, 'T03', 'TJ01');
        const ops = await staffOf(api, PA);
        const r = await act(api, ops, 'CANCEL_TRIP_GUEST', w);
        await withTestTransaction(
          worker,
          { virtualNow: iso(w.requestedAtMs + MINUTE), commit: true },
          async (tx) => {
            await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
            const p = await tx.query<{ r: string }>(
              `SELECT core.booking_cmd_trip_cancel_park($1, 'FAILED', 'QUOTE_UNAVAILABLE') AS r`,
              [r.domain_ref],
            );
            expect(p.rows[0]?.r).toBe('PARKED');
            expect(await cancellationRow(tx, r.domain_ref ?? '')).toMatchObject({
              status: 'FAILED',
              outcome_code: 'QUOTE_UNAVAILABLE',
              settlement_id: null,
            });
            const again = await tx.query<{ r: string }>(
              `SELECT core.booking_cmd_trip_cancel_park($1, 'FAILED', 'QUOTE_UNAVAILABLE') AS r`,
              [r.domain_ref],
            );
            expect(again.rows[0]?.r).toBe('NOT_PENDING');
          },
        );
        expect((await act(api, ops, 'CANCEL_TRIP_GUEST', w)).outcome).toBe('DONE');

        await asWorker(worker, w, async (tx) => {
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          for (const sql of [
            'SELECT * FROM core.booking_trip_cancellations_pending(10)',
            `SELECT * FROM core.booking_trip_cancellation_begin('${uuid()}')`,
          ]) {
            const e = await caught(tx, () => tx.query(sql));
            expect(constraintOf(e), sql).toBe('trip_command_forbidden');
          }
        });
        for (const sql of [
          'SELECT * FROM core.booking_trip_cancellations_pending(10)',
          `SELECT core.booking_cmd_trip_cancel_settle('${uuid()}', '${uuid()}')`,
          `SELECT core.booking_cmd_trip_cancel_park('${uuid()}', 'FAILED', 'X_CODE')`,
        ]) {
          await expect(api.query(sql), sql).rejects.toMatchObject({ code: '42501' });
        }
      });
    });
  });
});
