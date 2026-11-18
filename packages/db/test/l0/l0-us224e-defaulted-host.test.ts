/**
 * US-224 (partie 224e, migration 0138, ADR-163) — hôte défaillant (19 US-224 critère 5 : « Given un
 * hôte défaillant (BR-TRUST-09), When ses trips futurs sont annulés, Then chaque voyageur est
 * remboursé intégralement sans attendre l'hôte » ; BOARD N-236 ; 08 BR-TRUST-09, BR-CXL-14,
 * table de décision n° 13), en USD (PA) et en PYG sans décimale (PY).
 *
 * Parcours : un compte d'hôte a deux trips à venir encaissés (jambes TJ01 / TJ08a) ; l'ops ne peut
 * pas annuler ses trips tant qu'il n'est pas suspendu (HOST_NOT_RESTRICTED, rien d'écrit) ; elle le
 * restreint (RESTRICT_ACCOUNT, vraie action), puis `CANCEL_HOST_TRIPS` écrit UNE demande PENDING
 * par trip à venir de ce compte (motif dérivé HOST_ACCOUNT_CLOSED, initiateur PLATFORM), aucune pour
 * le trip d'un autre hôte ; rejeu ⇒ DUPLICATE ; nouvelle demande ⇒ NO_TRIP_TO_CANCEL. Chaque demande
 * est réglée par le travailleur comme toute annulation (0124) : remboursement intégral = total payé,
 * variation négative de TOUTES les jambes (TJ06), aucune pénalité ni gain de l'hôte, instance de
 * remboursement PLANNED sans avance de Kmino (la jambe HOST n'a jamais été versée : rien n'attend
 * l'hôte), aucune écriture au host_ledger.
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête) : app_api pour la console,
 * app_worker pour le travailleur. Préparation, restriction et actions de la console VALIDÉES sur des
 * trips, des comptes et des véhicules neufs ; la transaction du travailleur est ANNULÉE après
 * `SET CONSTRAINTS ALL IMMEDIATE` (comme l0-us709a-host-ledger). Fichier isolé
 * (`vitest.l0.config.ts`) : compte PSP FAKE ACTIVE du pays partagé (fixture 9800).
 *
 * Attendus : export des oracles (`docs/specs/tools/golden_vectors.json`) — T22 (A,
 * `HOST_ACCOUNT_CLOSED` : remboursement 256,66, aucun gain, aucune pénalité) ; au PY, aucun vecteur
 * `HOST_ACCOUNT_CLOSED` n'est exporté : motif FULL (08 table n° 13, 100 % remboursé) sur le trip D de
 * T48, attendu = total payé TJ08a (1 438 050 ; `independent_settlement_check.py`,
 * `compute(D, HOST_ACCOUNT_CLOSED)` rend 1 438 050, gain 0, pénalité 0). Jamais le code testé : le
 * moteur ne sert qu'à construire la version proposée, que la base rejoue (0054) et lie (0124).
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
import { applySignedStatus, legsJson, recordOperation, uuid } from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { golden, recordAsSettlementWorker, tripOfVector } from '../support/settlement.ts';
import { newHash } from '../support/golive.ts';
import { createStaff } from '../support/staff.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const MINUTE = 60_000;
const REASON = 'Hôte défaillant, trips à venir annulés (test US-224e)';
const ACT =
  'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])';

const PA = COUNTRIES.find((c) => c.currency === 'USD');
const PY = COUNTRIES.find((c) => c.currency === 'PYG');
if (PA === undefined || PY === undefined) throw new Error('pays PA / PY attendus (avl.ts)');

const legsVector = (id: string): Legs => ({ ...legVector(golden, id).legsMinor }) as Legs;
const neg = (l: Legs): Legs => Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const iso = (ms: number): string => new Date(ms).toISOString();

/** Instant des actions de la console : fenêtre virtuelle lointaine (2031), minute ronde. */
const ACTED_AT_MS = Date.UTC(2031, 4, 20, 12, 0, 0);
/** Départ des trips : 10 h après l'action (T22 : demande à T−10 h). */
const LEAD_MINUTES = 600;

interface CaseOf {
  readonly c: CountryCase;
  /** Vecteur qui fournit le trip (A de T22, D de T48) ; le motif vient de la base. */
  readonly vector: string;
  /** Jambes encaissées (TJ01 / TJ08a). */
  readonly capture: string;
  /** Remboursement intégral attendu (oracle). */
  readonly refund: bigint;
}

const CASES: readonly CaseOf[] = [
  {
    c: PA,
    vector: 'T22',
    capture: 'TJ01',
    refund: settlementVector(golden, 'T22').expected.guestRefundMinor,
  },
  { c: PY, vector: 'T48', capture: 'TJ08a', refund: legVector(golden, 'TJ08a').totalMinor },
];

interface Trip {
  readonly trip: string;
  readonly capture: string;
}

/** Trip à venir du compte `org`, capturé par les jambes `capture` (webhook signé, soldes). VALIDÉ. */
async function trip(worker: Tx, k: CaseOf, org: string): Promise<Trip> {
  const v = settlementVector(golden, k.vector);
  const startAtMs = ACTED_AT_MS + LEAD_MINUTES * MINUTE;
  const bookedAtMs = startAtMs + v.trip.bookedAtMinutes * MINUTE;
  const id = uuid();
  const capLegs = legsVector(k.capture);
  let captureId = '';
  await withTestTransaction(worker, { virtualNow: iso(bookedAtMs), commit: true }, async (tx) => {
    await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
    await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      id,
      uuid(),
      org,
      uuid(),
      k.c.country,
      k.c.currency,
      k.c.timezone,
      iso(startAtMs),
      iso(startAtMs + v.trip.days * 24 * 60 * MINUTE),
    ]);
    const a = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
      k.c.country,
    ]);
    const op = await recordOperation(tx, {
      tripId: id,
      accountId: a.rows[0]?.id ?? '',
      kind: 'CAPTURE',
      amountMinor: sum(capLegs),
      currency: k.c.currency,
      idemPlain: `trip:${id}:capture:${uuid()}`,
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
  return { trip: id, capture: captureId };
}

interface Acted {
  readonly outcome: string;
  readonly detail: string | null;
}

/** Action de console d'un agent OPS du pays, à l'instant des actions. VALIDÉE. */
async function act(
  api: Tx,
  k: CaseOf,
  action: string,
  subject: string,
  input: Record<string, string>,
  requestId: string = uuid(),
): Promise<Acted> {
  const ops = await createStaff(api, 'OPS_AGENT', [k.c.country], { withFactor: false });
  return withTestTransaction(api, { virtualNow: iso(ACTED_AT_MS), commit: true }, async (tx) => {
    const hash = newHash();
    await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [ops.userId, hash]);
    await setSessionContext(tx, {
      kind: 'STAFF',
      actorId: ops.userId,
      countryScope: [k.c.country],
      sessionTokenHash: hash.toString('hex'),
    });
    const { rows } = await tx.query<Acted>(ACT, [
      hash,
      requestId,
      action,
      subject,
      REASON,
      input,
      [],
    ]);
    return rows[0] ?? { outcome: '', detail: null };
  });
}

interface Cancellation {
  readonly id: string;
  readonly trip_id: string;
  readonly action_code: string;
  readonly requested_reason: string;
  readonly initiator: string;
  readonly status: string;
}

async function cancellationsOf(tx: Tx, org: string): Promise<Cancellation[]> {
  const { rows } = await tx.query<Cancellation>(
    'SELECT id, trip_id, action_code, requested_reason, initiator, status FROM test_fixture.us224e_cancellations($1)',
    [org],
  );
  return rows;
}

interface Facts {
  readonly trip_row_version: number;
  readonly start_at_ms: string;
  readonly booked_at_ms: string;
  readonly requested_reason: string;
  readonly sub_reason: string | null;
  readonly checkin_validated: boolean;
  readonly requested_at_ms: string;
}

/** Version proposée : trip du vecteur aux instants de la base, motif lu de la demande. */
function proposal(k: CaseOf, f: Facts): SettlementRecord {
  const base = tripOfVector(k.vector);
  const t = { ...base, startAtMs: Number(f.start_at_ms), bookedAtMs: Number(f.booked_at_ms) };
  const event: CancellationEvent = {
    reason: f.requested_reason,
    requestedAtMs: Number(f.requested_at_ms),
    ...(f.sub_reason === null ? {} : { subReason: f.sub_reason }),
    checkinValidated: f.checkin_validated,
  };
  return buildSettlementRecord(t, event, testParams(base.currency));
}

describe.each(CASES)('critère 5 d’US-224 — hôte défaillant — $c.country ($c.currency)', (k) => {
  it('suspendu puis CANCEL_HOST_TRIPS : une demande HOST_ACCOUNT_CLOSED par trip à venir ; chaque voyageur remboursé intégralement par le règlement (TJ06), sans avance ni dette de l’hôte', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const org = uuid();
        const other = uuid();
        const trips = [await trip(worker, k, org), await trip(worker, k, org)];
        const foreign = await trip(worker, k, other);
        const { rows: h } = await api.query<{ id: string }>(
          'SELECT test_fixture.us224e_org_holder($1) AS id',
          [org],
        );
        const holder = h[0]?.id ?? '';
        expect(holder).not.toBe('');

        // non suspendu : refusé, rien d'écrit (fail-closed)
        expect(await act(api, k, 'CANCEL_HOST_TRIPS', org, {})).toMatchObject({
          outcome: 'REFUSED',
          detail: 'HOST_NOT_RESTRICTED',
        });
        expect(await cancellationsOf(api, org)).toEqual([]);

        // suspendu (ADR-124 : plus aucune nouvelle réservation), puis ses trips à venir annulés
        expect((await act(api, k, 'RESTRICT_ACCOUNT', holder, { kind: 'TS_HOLD' })).outcome).toBe(
          'DONE',
        );
        const request = uuid();
        expect((await act(api, k, 'CANCEL_HOST_TRIPS', org, {}, request)).outcome).toBe('DONE');
        const pending = await cancellationsOf(api, org);
        expect(pending.map((x) => x.trip_id).sort()).toEqual(trips.map((t) => t.trip).sort());
        for (const x of pending) {
          expect(x).toMatchObject({
            action_code: 'CANCEL_TRIP_PLATFORM',
            requested_reason: 'HOST_ACCOUNT_CLOSED',
            initiator: 'PLATFORM',
            status: 'PENDING',
          });
        }
        // l'autre hôte n'est pas touché
        expect(await cancellationsOf(api, other)).toEqual([]);
        // rejeu de la même demande : DUPLICATE ; nouvelle demande : plus rien à annuler
        expect((await act(api, k, 'CANCEL_HOST_TRIPS', org, {}, request)).outcome).toBe(
          'DUPLICATE',
        );
        expect(await act(api, k, 'CANCEL_HOST_TRIPS', org, {})).toMatchObject({
          outcome: 'REFUSED',
          detail: 'NO_TRIP_TO_CANCEL',
        });
        expect(await cancellationsOf(api, org)).toHaveLength(2);
        expect(foreign.trip).not.toBe('');

        // chaque demande réglée par le travailleur (transaction annulée), comme toute annulation
        const capture = legsVector(k.capture);
        for (const x of pending) {
          const t = trips.find((y) => y.trip === x.trip_id);
          if (t === undefined) throw new Error('trip de la demande inconnu');
          await withTestTransaction(
            worker,
            { virtualNow: iso(ACTED_AT_MS + MINUTE) },
            async (tx) => {
              await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
              const { rows: fr } = await tx.query<Facts>(
                `SELECT trip_row_version, start_at_ms::text AS start_at_ms,
                        booked_at_ms::text AS booked_at_ms, requested_reason, sub_reason,
                        checkin_validated, requested_at_ms::text AS requested_at_ms
                   FROM core.booking_trip_cancellation_begin($1)`,
                [x.id],
              );
              const f = fr[0];
              if (f === undefined) throw new Error('demande non ouverte');
              expect(f.requested_reason).toBe('HOST_ACCOUNT_CLOSED');
              const settlement = await recordAsSettlementWorker(
                tx,
                { tripId: t.trip, version: 1, tripRowVersion: f.trip_row_version },
                proposal(k, f),
              );
              await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
              const settled = await tx.query<{ r: { status?: string } }>(
                'SELECT core.booking_cmd_trip_settle_cancellation($1, $2) AS r',
                [x.id, settlement],
              );
              expect(settled.rows[0]?.r.status).toBe('CANCELLED_BY_PLATFORM');

              // remboursement intégral (FULL) : total payé ; aucune pénalité ni gain de l'hôte
              await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
              const { rows: s } = await tx.query<{
                refund: string;
                pen: string;
                comp: string;
                reason: string;
              }>(
                `SELECT guest_refund_minor::text AS refund, host_penalty_minor::text AS pen,
                        host_compensation_minor::text AS comp, reason
                   FROM core.settlement_settlement WHERE id = $1`,
                [settlement],
              );
              expect(s[0]).toEqual({
                refund: k.refund.toString(),
                pen: '0',
                comp: '0',
                reason: 'HOST_ACCOUNT_CLOSED',
              });
              expect(sum(capture)).toBe(k.refund);
              // variation négative de TOUTES les jambes (08 BR-TRUST-09, TJ06), jamais un prorata
              const { rows: legRows } = await tx.query<{ leg: string; v: string }>(
                `SELECT leg, variation_minor::text AS v FROM core.settlement_settlement_leg
                  WHERE settlement_id = $1`,
                [settlement],
              );
              const variation = Object.fromEntries(
                legRows.map((r) => [r.leg, BigInt(r.v)]),
              ) as unknown as Legs;
              expect(variation).toEqual(neg(capture));
              if (k.c.currency === 'USD') expect(variation).toEqual(legsVector('TJ06'));

              // remboursement de Kmino : instance PLANNED, sans avance (la jambe HOST est encore
              // chez le PSP : rien n'attend l'hôte)
              await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
              const { rows: planned } = await tx.query<{
                status: string;
                advance_id: string | null;
                blocked_reason: string | null;
              }>(
                `SELECT status, advance_id, blocked_reason
                   FROM core.payment_cmd_plan_refund($1, $2, $3, $4, 1, 'NATIVE_PARTIAL', $5::jsonb, $6, $6)`,
                [
                  uuid(),
                  uuid(),
                  settlement,
                  t.capture,
                  legsJson(capture),
                  `${t.trip}:refund:${uuid()}`,
                ],
              );
              expect(planned[0]).toEqual({
                status: 'PLANNED',
                advance_id: null,
                blocked_reason: null,
              });
              // contrôles différés : demande réglée ⇔ remboursements = remboursement du voyageur
              await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
              // aucune dette de l'hôte (pénalité nulle, aucune avance)
              const { rows: ledger } = await tx.query(
                'SELECT * FROM test_fixture.us224e_ledger_entries($1)',
                [t.trip],
              );
              expect(ledger).toEqual([]);
            },
          );
        }
      });
    });
  });

  it('un agent SUPPORT (sans ops.platform_cancel) est refusé ; un compte inconnu n’annule rien', async () => {
    await withRole('app_api', async (api) => {
      const support = await createStaff(api, 'SUPPORT_AGENT', [k.c.country], {
        withFactor: false,
      });
      const r = await withTestTransaction(
        api,
        { virtualNow: iso(ACTED_AT_MS), commit: true },
        async (tx) => {
          const hash = newHash();
          await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [
            support.userId,
            hash,
          ]);
          await setSessionContext(tx, {
            kind: 'STAFF',
            actorId: support.userId,
            countryScope: [k.c.country],
            sessionTokenHash: hash.toString('hex'),
          });
          const { rows } = await tx.query<Acted>(ACT, [
            hash,
            uuid(),
            'CANCEL_HOST_TRIPS',
            uuid(),
            REASON,
            {},
            [],
          ]);
          return rows[0];
        },
      );
      expect(r?.outcome).not.toBe('DONE');
      expect(r?.outcome).not.toBe('RECORDED');
    });
  });
});
