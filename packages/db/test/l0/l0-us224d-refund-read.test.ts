/**
 * US-224 (partie 224d, migration 0130, ADR-154) — lecture du remboursement (critère 1 : « visible
 * du voyageur, de l'hôte (jambe HOST seulement) et de l'ops ») : `core.booking_trip_refunds`
 * (partie de la session, EXECUTE app_api) et `core.support_staff_trip_refunds` (console : session
 * élevée, ops.platform_cancel ou finance.platform_advance dans le pays du trip, refus journalisés).
 * En USD (PA) et en PYG sans décimale (PY).
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête) : app_worker (payment_command,
 * settlement, webhook_ingest) prépare et VALIDE deux trips par pays par les vraies commandes de
 * 224b / 224c (encaissement, règlement, instance, envoi autorisé, preuve, report) ; app_api lit, dans
 * des transactions ANNULÉES (sessions ouvertes par les vraies commandes). Fichier isolé
 * (`vitest.l0.config.ts`) : compte PSP FAKE ACTIVE du pays partagé (fixture 9800). Aucune instance
 * validée ne reste dans la file de l'ordonnanceur (CONFIRMED reportée, FAILED signalée puis
 * SUPERSEDED).
 *
 * Attendus : vecteurs de l'export des oracles (`@rueda/money/golden-vectors`) : TJ01 / TJ02b / T03
 * (PA) et TJ08a / TJ08b / T27 (PY) ; T08 (version 2 qui remplace la version 1) ; montant remboursé
 * = Σ (−TJ02b) et part HOST = −TJ02b.HOST (08 E7 règle 1) ; états de 08 SM-8. Jamais le code testé.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { signedOpenParams, withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newHash } from '../support/golive.ts';
import { newToken, SESSION_TTL_S } from '../support/iam.ts';
import {
  applySignedStatus,
  applyStatus,
  legsJson,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs, SettlementRef } from '../support/pay.ts';
import {
  eventOfVector,
  golden,
  recordAsSettlementWorker,
  recordOf,
  recordOfVector,
  tripOfVector,
} from '../support/settlement.ts';
import { createStaff } from '../support/staff.ts';

type Tx = pg.ClientBase;
type Json = Record<string, unknown>;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const tj = (id: string): GoldenLegVector => legVector(golden, id);
const legsOf = (v: GoldenLegVector): Legs => ({ ...v.legsMinor });
const negate = (l: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Vecteurs par devise (jamais par pays). */
const REF: Readonly<Record<string, { capture: string; settlement: string; variation: string }>> = {
  USD: { capture: 'TJ01', settlement: 'T03', variation: 'TJ02b' },
  PYG: { capture: 'TJ08a', settlement: 'T27', variation: 'TJ08b' },
};
const refOf = (c: CountryCase) => {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  expect(tj(r.capture).currency).toBe(c.currency);
  return r;
};

const READ = 'SELECT * FROM core.booking_trip_refunds($1, $2::uuid)';
const STAFF_READ = 'SELECT outcome, body FROM core.support_staff_trip_refunds($1, $2, $3)';

async function asWorker(tx: Tx, workerName: string): Promise<void> {
  await setSessionContext(tx, { kind: 'WORKER', workerName });
}

async function applyMovement(tx: Tx, operationId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS outcome',
    [operationId],
  );
  return rows[0]?.outcome ?? '';
}

interface Trip {
  readonly trip: string;
  readonly guest: string;
  readonly instance: string;
}

/**
 * Trip capturé (jambes du vecteur), réglé (v1), remboursement planifié par la vraie commande puis
 * mené par les vraies commandes jusqu'à `CONFIRMED` (reporté) ou `FAILED → SUPERSEDED` (v2 de T08).
 * VALIDÉ ; rien ne reste dans la file de l'ordonnanceur.
 */
async function prepared(
  worker: Tx,
  c: CountryCase,
  end: 'CONFIRMED' | 'SUPERSEDED',
): Promise<Trip> {
  const r = refOf(c);
  const capture = legsOf(tj(r.capture));
  const refund = negate(legsOf(tj(r.variation)));
  const trip = uuid();
  const guest = uuid();
  let instance = '';
  await payTx(worker, { worker: 'payment_command', commit: true }, async (tx) => {
    await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      trip,
      guest,
      uuid(),
      uuid(),
      c.country,
      c.currency,
      c.timezone,
      '2031-08-01T10:00:00Z',
      '2031-08-04T10:00:00Z',
    ]);
    // compte FAKE ACTIVE du pays partagé (fixture 9800 : un seul compte ACTIVE par pays)
    const account = (
      await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [c.country])
    ).rows[0]!.id;
    const { operation_id: op } = await recordOperation(tx, {
      tripId: trip,
      accountId: account,
      kind: 'CAPTURE',
      amountMinor: sum(capture),
      currency: c.currency,
      idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
      legs: capture,
    });
    expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
    expect(await applyMovement(tx, op)).toBe('APPLIED');
    const r1 = recordOfVector(r.settlement);
    const v1: SettlementRef = {
      id: await recordAsSettlementWorker(tx, { tripId: trip, version: 1 }, r1),
      version: 1,
    };
    await asWorker(tx, 'payment_command');
    const planned = (
      await tx.query<{ instance_id: string; operation_id: string }>(
        `SELECT instance_id, operation_id
           FROM core.payment_cmd_plan_refund($1, $2, $3, $4, 1, 'NATIVE_PARTIAL', $5::jsonb, $6, $6)`,
        [uuid(), uuid(), v1.id, op, legsJson(refund), `trip:${trip}:REFUND:card:i1:a1:${uuid()}`],
      )
    ).rows[0]!;
    instance = planned.instance_id;
    const submitted = await tx.query<{ outcome: string }>(
      'SELECT outcome FROM core.payment_cmd_submit_refund($1)',
      [instance],
    );
    expect(submitted.rows[0]?.outcome).toBe('SUBMITTED');
    if (end === 'CONFIRMED') {
      expect(
        await applyStatus(tx, planned.operation_id, 'SUBMITTED', 'API_RESPONSE', `psp-${uuid()}`),
      ).toBe('APPLIED');
      await asWorker(tx, 'webhook_ingest');
      expect(await applySignedStatus(tx, planned.operation_id, 'SUCCEEDED')).toBe('APPLIED');
      await asWorker(tx, 'payment_command');
      expect(await applyMovement(tx, planned.operation_id)).toBe('APPLIED');
    } else {
      expect(await applySignedStatus(tx, planned.operation_id, 'FAILED')).toBe('APPLIED');
      const alerted = await tx.query<{ changed: boolean }>(
        `SELECT core.payment_cmd_refund_mark_alerted($1, 'FAILED') AS changed`,
        [instance],
      );
      expect(alerted.rows[0]?.changed).toBe(true);
      await recordAsSettlementWorker(
        tx,
        { tripId: trip, version: 2, supersedesId: v1.id },
        recordOf(tripOfVector(r.settlement), eventOfVector('T08'), r1),
      );
    }
  });
  return { trip, guest, instance };
}

/** Session ouverte par la vraie commande (app_api), dans la transaction de lecture (annulée). */
async function session(tx: Tx, userId: string): Promise<Buffer> {
  const t = newToken();
  await tx.query(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest', $5, $6)`,
    await signedOpenParams(tx, [uuid(), userId, t.hash, SESSION_TTL_S]),
  );
  return t.hash;
}

async function holderOf(tx: Tx, trip: string): Promise<string> {
  return (await tx.query<{ h: string }>('SELECT test_fixture.us211_holder($1) AS h', [trip]))
    .rows[0]!.h;
}

/** Lecture par la console sous app_api, session élevée (fixture 9650) ; rien n'est validé. */
async function staffRead(
  api: Tx,
  staffId: string,
  c: CountryCase,
  trip: string,
  options: { readonly elevated?: boolean } = {},
): Promise<{ outcome: string; body: Json | null; audits: Json[] }> {
  return withTestTransaction(api, {}, async (tx) => {
    const hash = newHash();
    if (options.elevated !== false) {
      await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [staffId, hash]);
    }
    await setSessionContext(tx, {
      kind: 'STAFF',
      actorId: staffId,
      countryScope: [c.country],
      sessionTokenHash: hash.toString('hex'),
    });
    const requestId = uuid();
    const { rows } = await tx.query<{ outcome: string; body: Json | null }>(STAFF_READ, [
      hash,
      requestId,
      trip,
    ]);
    const audits = await tx.query<Json>(
      `SELECT action_code, after ->> 'reason' AS reason, after ->> 'field_or_file' AS field
         FROM test_fixture.audit_rows_of_actor($1) WHERE request_id = $2`,
      [staffId, requestId],
    );
    return { ...(rows[0] ?? { outcome: '', body: null }), audits: audits.rows };
  });
}

describe.each(COUNTRIES)('US-224d — lecture du remboursement — $country ($currency)', (c) => {
  const r = refOf(c);
  const refund = negate(legsOf(tj(r.variation)));

  it('critère 1 : le voyageur lit son remboursement (montant du règlement, rail, date d’émission) ; l’hôte lit la jambe HOST seulement ; une instance remplacée est cachée aux parties ; toute autre personne, un trip inconnu ou une session inconnue ⇒ la même réponse NOT_FOUND', async () => {
    await withRole('app_worker', async (worker) => {
      const confirmed = await prepared(worker, c, 'CONFIRMED');
      const superseded = await prepared(worker, c, 'SUPERSEDED');
      await withRole('app_api', async (api) => {
        await withTestTransaction(api, {}, async (tx) => {
          const guestHash = await session(tx, confirmed.guest);
          const hostHash = await session(tx, await holderOf(tx, confirmed.trip));
          const strangerHash = await session(tx, superseded.guest);

          const guest = (await tx.query<Json>(READ, [guestHash, confirmed.trip])).rows;
          expect(guest).toHaveLength(1);
          expect(guest[0]).toMatchObject({
            outcome: 'OK',
            viewer_role: 'GUEST',
            currency: c.currency,
            timezone: c.timezone,
          });
          const gItems = guest[0]!['refunds'] as Json[];
          expect(gItems).toHaveLength(1);
          // exactement ces clés : jamais une jambe, un motif de blocage ni une avance
          expect(gItems[0]).toEqual({
            status: 'CONFIRMED',
            currency: c.currency,
            amountMinor: sum(refund).toString(),
            rail: 'NATIVE_PARTIAL',
            plannedAt: expect.stringMatching(ISO_MS),
            issuedAt: expect.stringMatching(ISO_MS),
          });
          expect(String(gItems[0]!['issuedAt']) >= String(gItems[0]!['plannedAt'])).toBe(true);

          const host = (await tx.query<Json>(READ, [hostHash, confirmed.trip])).rows;
          expect(host[0]).toMatchObject({ outcome: 'OK', viewer_role: 'HOST' });
          // jambe HOST seulement : ni le montant du voyageur, ni son rail
          expect(host[0]!['refunds']).toEqual([
            {
              status: 'CONFIRMED',
              currency: c.currency,
              hostLegMinor: refund.HOST.toString(),
              plannedAt: expect.stringMatching(ISO_MS),
              issuedAt: expect.stringMatching(ISO_MS),
            },
          ]);

          // instance FAILED puis SUPERSEDED (version 2) : cachée au voyageur de ce trip
          const own = (await tx.query<Json>(READ, [strangerHash, superseded.trip])).rows;
          expect(own[0]).toMatchObject({ outcome: 'OK', viewer_role: 'GUEST', refunds: [] });

          // aucun oracle : autre personne, trip inconnu, session inconnue
          const notFound = {
            outcome: 'NOT_FOUND',
            viewer_role: null,
            trip_status: null,
            currency: null,
            timezone: null,
            refunds: null,
          };
          for (const [hash, trip] of [
            [strangerHash, confirmed.trip],
            [guestHash, uuid()],
            [newToken().hash, confirmed.trip],
          ] as const) {
            expect((await tx.query<Json>(READ, [hash, trip])).rows).toEqual([notFound]);
          }
        });
        // la vue interne n'est jamais appelable par app_api
        await withTestTransaction(api, {}, async (tx) => {
          await expect(
            tx.query(`SELECT core.payment_trip_refund_view($1, 'STAFF')`, [confirmed.trip]),
          ).rejects.toMatchObject({ code: '42501' });
        });
      });
      // les deux lectures sont fermées aux travailleurs
      await withTestTransaction(worker, {}, async (tx) => {
        await expect(tx.query(READ, [newHash(), confirmed.trip])).rejects.toMatchObject({
          code: '42501',
        });
      });
      await withTestTransaction(worker, {}, async (tx) => {
        await expect(
          tx.query(STAFF_READ, [newHash(), uuid(), confirmed.trip]),
        ).rejects.toMatchObject({ code: '42501' });
      });
    });
  });

  it('console : OPS_AGENT et FINANCE lisent toutes les jambes, l’ordre, l’alerte FIN et l’instance remplacée ; sans permission, hors du pays, trip inconnu ⇒ FORBIDDEN journalisé ; sans session ⇒ AUTH_REQUIRED', async () => {
    await withRole('app_worker', async (worker) => {
      const confirmed = await prepared(worker, c, 'CONFIRMED');
      const superseded = await prepared(worker, c, 'SUPERSEDED');
      await withRole('app_api', async (api) => {
        const other = COUNTRIES.find((x) => x.country !== c.country)!;
        const ops = await createStaff(api, 'OPS_AGENT', [c.country], { withFactor: false });
        const fin = await createStaff(api, 'FINANCE', [c.country], { withFactor: false });
        const none = await createStaff(api, 'SUPPORT_AGENT', [c.country], { withFactor: false });
        const away = await createStaff(api, 'OPS_AGENT', [other.country], { withFactor: false });

        for (const staff of [ops, fin]) {
          const read = await staffRead(api, staff.userId, c, confirmed.trip);
          expect(read.outcome).toBe('OK');
          expect(read.audits).toEqual([]);
          expect(read.body).toEqual({
            tripId: confirmed.trip,
            country: c.country,
            refunds: [
              {
                instanceId: confirmed.instance,
                status: 'CONFIRMED',
                currency: c.currency,
                amountMinor: sum(refund).toString(),
                rail: 'NATIVE_PARTIAL',
                attemptNo: 1,
                settlementVersion: 1,
                requestedLegs: Object.fromEntries(LEGS.map((k) => [k, refund[k].toString()])),
                orderLegs: Object.fromEntries(LEGS.map((k) => [k, refund[k].toString()])),
                orderStatus: 'SUCCEEDED',
                blockedReason: null,
                finAlert: null,
                advance: null,
                plannedAt: expect.stringMatching(ISO_MS),
                issuedAt: expect.stringMatching(ISO_MS),
              },
            ],
          });
        }
        // instance remplacée : visible du staff seulement, date d'émission et alerte conservées
        const replaced = await staffRead(api, fin.userId, c, superseded.trip);
        expect(replaced.body?.['refunds']).toEqual([
          expect.objectContaining({
            instanceId: superseded.instance,
            status: 'SUPERSEDED',
            orderStatus: 'FAILED',
            finAlert: 'FAILED',
            issuedAt: expect.stringMatching(ISO_MS),
          }),
        ]);

        for (const [staff, trip] of [
          [none, confirmed.trip],
          [away, confirmed.trip],
          [ops, uuid()],
        ] as const) {
          const refused = await staffRead(api, staff.userId, c, trip);
          expect(refused).toMatchObject({ outcome: 'FORBIDDEN', body: null });
          expect(refused.audits).toEqual([
            { action_code: 'STAFF_FORBIDDEN', reason: expect.any(String), field: 'trip_refunds' },
          ]);
        }
        // aucune session de staff : AUTH_REQUIRED, rien n'est rendu
        expect(
          await staffRead(api, ops.userId, c, confirmed.trip, { elevated: false }),
        ).toMatchObject({ outcome: 'AUTH_REQUIRED', body: null });
      });
    });
  });
});
