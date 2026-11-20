/**
 * US-307 (migration 0171, ADR-191) — no-show et refus du véhicule déclarés par l'hôte, le
 * voyageur ou l'ops, réglés par le moteur unique (`cxl-beta/2`) dans la transaction de la
 * transition (invariant 4 de SM-1, 0124), remboursés par les ordres bornés d'US-224, pénalité de
 * l'hôte au `host_ledger` (0129), en USD (PA) et en PYG sans décimale (PY).
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête) : app_api pour les parties
 * (session de l'hôte titulaire ou du voyageur, vraies commandes) et la console (staff élevé par la
 * fixture 9650), app_worker pour le travailleur (trip_lifecycle, settlement, payment_command dans
 * UNE transaction). Préparation (trip, capture) et déclarations VALIDÉES sur des trips neufs ; la
 * transaction du travailleur est ANNULÉE après `SET CONSTRAINTS ALL IMMEDIATE` (contrôles différés
 * exécutés). Fichier isolé (`vitest.l0.config.ts`) : compte PSP FAKE ACTIVE du pays partagé
 * (fixture 9800), comme US-215. Une connexion par client, libérée (`withRole`, `releaseClient`).
 *
 * Attendus (jamais le code testé ; le moteur ne sert qu'à construire la version proposée, que la
 * base rejoue — 0054, vérificateur cxl-beta/2 — et LIE à la demande) :
 *   - PA (trip A) : export des oracles (`golden_vectors.json`) — T05 / TJ04b (138,22, hôte 75,00),
 *     T39 / TJ05a / TJ05b (hôte inéligible, 18,53 réaffectés à PLATFORM ; 112,72 + 25,50 au
 *     remboursement : note de TJ05b dans 08 E7), T07 (= T05), T08 / TJ06 (requalifié, 50,00),
 *     T26 (no-show de l'hôte : 256,66, pénalité 150,00) ; refus pour propreté ou sécurité : TJ06,
 *     pénalité 50,00 (08 table de décision n° 8, BR-CSP-03 ; oracle indépendant) ;
 *   - PY (trip D) : T41 de l'export (no-show, message tracé) et, pour les autres motifs, l'oracle
 *     indépendant `docs/specs/tools/independent_settlement_check.py` (`compute(D, …)`) et
 *     `docs/specs/tools/check_legs.py` (`capture_and(D, …)`), `python -I -X utf8`, 2026-11-20 :
 *       no-show, hôte inéligible : remboursement 587 683, variation HOST −787 500, INSURER
 *         −105 000, TAX 0, PLATFORM +304 817 (réaffectés de HOST : 787 500 − 304 817 = 482 683
 *         au remboursement, avec les 105 000 de l'assureur) ;
 *       motif FULL (refus, no-show de l'hôte, requalification) : remboursement 1 438 050,
 *         variation HOST −787 500, INSURER −105 000, TAX 0, PLATFORM −545 550 ; pénalités du
 *         barème de test de 08 : cleanliness 400 000, cxlLate 400 000, hostNoShow 1 200 000 ;
 *   - délais : 19 US-307 critère 1 (T+50, grâce 60 ⇒ NO_SHOW_TOO_EARLY), 08 BR-CXL-13 (30 min),
 *     BR-CXL-08 (fenêtre de 72 h, message + 15 min) ; pré-mortem L3-PM-18 (T+59 refusé, T+60
 *     accepté).
 */
import { buildSettlementRecord, type CancellationEvent, type SettlementRecord } from '@rueda/money';
import { legVector, settlementVector } from '@rueda/money/golden-vectors';
import { testParams } from '@rueda/money/testing';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { backendPid } from '../support/concurrency.ts';
import { newHash } from '../support/golive.ts';
import { openSession } from '../support/iam.ts';
import {
  applySignedStatus,
  caught,
  legsJson,
  recordOperation,
  uuid,
  type Legs,
} from '../support/pay.ts';
import { golden, legsOf, recordAsSettlementWorker, tripOfVector } from '../support/settlement.ts';
import { createStaff } from '../support/staff.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const REASON = 'Déclaration du support, motif de test';
const ACT =
  'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])';
const REPORT = 'SELECT * FROM core.trip_cmd_report_no_show($1, $2::uuid, $3::uuid)';
const VIEW = 'SELECT core.trip_no_show_view($1, $2::uuid) AS v';

const PA = COUNTRIES.find((c) => c.currency === 'USD');
const PY = COUNTRIES.find((c) => c.currency === 'PYG');
if (PA === undefined || PY === undefined) throw new Error('pays PA / PY attendus (avl.ts)');

const iso = (ms: number): string => new Date(ms).toISOString();
const vec = (id: string): Legs => ({ ...legVector(golden, id).legsMinor }) as Legs;
const neg = (l: Legs): Legs => Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
const legs = (h: bigint, i: bigint, t: bigint, p: bigint): Legs =>
  ({ HOST: h, INSURER: i, TAX_THIRD_PARTY: t, PLATFORM: p }) as Legs;

/** Attendus par pays (voir l'en-tête : export pour PA et T41, oracle indépendant pour PY). */
interface Expect {
  readonly vector: string;
  readonly capture: string;
  readonly noShowRefund: bigint;
  readonly noShowHost: bigint;
  readonly noShowTraced: Legs;
  readonly noShowUntraced: Legs;
  /** Réaffectation de l'hôte inéligible (HOST → PLATFORM), puis remboursement par jambe. */
  readonly reallocation: Legs;
  readonly untracedRefund: Legs;
  readonly fullRefund: bigint;
  readonly full: Legs;
  readonly cleanliness: bigint;
  readonly cxlLate: bigint;
  readonly hostNoShow: bigint;
}

const EXPECT: Readonly<Record<string, Expect>> = {
  USD: {
    vector: 'T05',
    capture: 'TJ01',
    noShowRefund: settlementVector(golden, 'T05').expected.guestRefundMinor,
    noShowHost: settlementVector(golden, 'T05').expected.hostEarningsMinor,
    noShowTraced: vec('TJ04b'),
    noShowUntraced: vec('TJ05b'),
    // 08 E7, TJ05b : 18,53 réaffectés de HOST à PLATFORM ; 112,72 (HOST) + 25,50 (INSURER)
    reallocation: legs(-1853n, 0n, 0n, 1853n),
    untracedRefund: legs(11272n, 2550n, 0n, 0n),
    fullRefund: settlementVector(golden, 'T14').expected.guestRefundMinor,
    full: vec('TJ06'),
    cleanliness: 5_000n,
    cxlLate: settlementVector(golden, 'T08').expected.hostPenaltyMinor,
    hostNoShow: settlementVector(golden, 'T26').expected.hostPenaltyMinor,
  },
  PYG: {
    vector: 'T41',
    capture: 'TJ08a',
    noShowRefund: settlementVector(golden, 'T41').expected.guestRefundMinor,
    noShowHost: settlementVector(golden, 'T41').expected.hostEarningsMinor,
    // check_legs.capture_and(D, 'NO_SHOW', 2, eligible=True)
    noShowTraced: legs(-268_750n, -105_000n, 0n, -213_933n),
    // check_legs.capture_and(D, 'NO_SHOW', 2, eligible=False)
    noShowUntraced: legs(-787_500n, -105_000n, 0n, 304_817n),
    reallocation: legs(-304_817n, 0n, 0n, 304_817n),
    untracedRefund: legs(482_683n, 105_000n, 0n, 0n),
    // T48 (D, motif FULL) : remboursement intégral = total payé de D
    fullRefund: settlementVector(golden, 'T48').expected.guestRefundMinor,
    full: legs(-787_500n, -105_000n, 0n, -545_550n),
    cleanliness: 400_000n,
    cxlLate: 400_000n,
    hostNoShow: 1_200_000n,
  },
};
const expectOf = (c: CountryCase): Expect => {
  const e = EXPECT[c.currency];
  if (e === undefined) throw new Error(`aucun attendu en ${c.currency}`);
  return e;
};

/** Départ des trips : fenêtre virtuelle lointaine (2033), distincte des autres preuves. */
const START_MS = Date.UTC(2033, 3, 14, 10, 0, 0);

interface World {
  readonly c: CountryCase;
  readonly e: Expect;
  readonly trip: string;
  readonly account: string;
  readonly capture: string;
  readonly guest: string;
  readonly holder: string;
}

/** Trip neuf du vecteur du pays, capturé (webhook signé, report), remise ouverte. VALIDÉ. */
async function world(worker: Tx, c: CountryCase, open = true): Promise<World> {
  const e = expectOf(c);
  const v = settlementVector(golden, e.vector);
  const bookedAtMs = START_MS + v.trip.bookedAtMinutes * MINUTE;
  const trip = uuid();
  const guest = uuid();
  const capLegs = vec(e.capture);
  const total = LEGS.reduce((s, k) => s + capLegs[k], 0n);
  let account = '';
  let capture = '';
  let holder = '';
  await withTestTransaction(worker, { virtualNow: iso(bookedAtMs), commit: true }, async (tx) => {
    await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
    await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      trip,
      guest,
      uuid(),
      uuid(),
      c.country,
      c.currency,
      c.timezone,
      iso(START_MS),
      iso(START_MS + v.trip.days * 24 * HOUR),
    ]);
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
    capture = op.operation_id;
    expect(await applySignedStatus(tx, op.operation_id, 'SUCCEEDED')).toBe('APPLIED');
    await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [op.operation_id]);
    if (open) {
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
      await tx.query(
        `SELECT core.booking_cmd_trip_transition($1, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED', NULL)`,
        [trip],
      );
    }
    const h = await tx.query<{ id: string }>('SELECT test_fixture.us307_holder($1) AS id', [trip]);
    holder = h.rows[0]?.id ?? '';
  });
  return { c, e, trip, account, capture, guest, holder };
}

/** Transaction de l'API à l'instant `ms` (commit ou annulation), avec la session d'une partie. */
async function asParty<T>(
  api: Tx,
  w: World,
  who: 'HOST' | 'GUEST',
  ms: number,
  commit: boolean,
  fn: (tx: Tx, hash: Buffer) => Promise<T>,
): Promise<T> {
  return withTestTransaction(api, { virtualNow: iso(ms), commit }, async (tx) => {
    const s = await openSession(tx, who === 'HOST' ? w.holder : w.guest);
    return fn(tx, s.hash);
  });
}

/** Message d'une partie dans le fil du trip, à l'heure serveur `ms` (fixture 9919). */
async function message(tx: Tx, w: World, who: 'HOST' | 'GUEST', ms: number): Promise<void> {
  await tx.query('SELECT test_fixture.us316_seed_message($1, $2, $3, $4, $5::timestamptz)', [
    w.trip,
    who === 'HOST' ? w.holder : w.guest,
    who,
    who === 'HOST' ? 'Estoy en el punto de entrega' : 'Ya llegué, ¿dónde estás?',
    iso(ms),
  ]);
}

async function report(tx: Tx, hash: Buffer, trip: string, id: string): Promise<Row> {
  return (await tx.query<Row>(REPORT, [hash, trip, id])).rows[0] ?? {};
}

async function view(tx: Tx, hash: Buffer, trip: string): Promise<Row> {
  return (await tx.query<{ v: Row }>(VIEW, [hash, trip])).rows[0]?.v ?? {};
}

interface Outcome {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}

/** Action de console sous le contexte STAFF, à l'instant `ms`. VALIDÉE. */
async function act(
  api: Tx,
  w: World,
  action: string,
  ms: number,
  input: Record<string, unknown>,
  evidence: readonly string[] = [],
): Promise<Outcome> {
  const staff = await createStaff(api, 'OPS_AGENT', [w.c.country], { withFactor: false });
  return withTestTransaction(api, { virtualNow: iso(ms), commit: true }, async (tx) => {
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
      uuid(),
      action,
      w.trip,
      REASON,
      input,
      evidence,
    ]);
    return rows[0] ?? { outcome: '', action_id: null, domain_ref: null, detail: null };
  });
}

async function evidenceFile(api: Tx): Promise<string> {
  const id = uuid();
  await api.query('SELECT test_fixture.us101_insert_file($1, $2)', [id, 'PRIVATE_EVIDENCE']);
  return id;
}

async function cancellation(tx: Tx, id: string): Promise<Row | undefined> {
  return (await tx.query<Row>('SELECT * FROM test_fixture.us307_cancellation($1)', [id])).rows[0];
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
  readonly host_message_traced: boolean | null;
}

/** Faits lus par le travailleur (0124 + drapeaux de 0171). */
async function begin(tx: Tx, id: string): Promise<Facts> {
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
  const { rows } = await tx.query<Omit<Facts, 'host_message_traced'>>(
    `SELECT trip_row_version, start_at_ms::text AS start_at_ms, booked_at_ms::text AS booked_at_ms,
            requested_reason, sub_reason, evidence_validated, checkin_validated,
            requested_at_ms::text AS requested_at_ms
       FROM core.booking_trip_cancellation_begin($1)`,
    [id],
  );
  const f = rows[0];
  if (f === undefined) throw new Error('demande non ouverte');
  const flags = await tx.query<{ host_message_traced: boolean | null }>(
    'SELECT host_message_traced FROM core.booking_trip_cancellation_flags($1)',
    [id],
  );
  return { ...f, host_message_traced: flags.rows[0]?.host_message_traced ?? null };
}

/** Événement des faits de la base, dans la forme que la base contrôle (0124, 0171). */
function eventOf(f: Facts): CancellationEvent {
  return {
    reason: f.requested_reason,
    requestedAtMs: Number(f.requested_at_ms),
    ...(f.sub_reason === null ? {} : { subReason: f.sub_reason }),
    ...(f.requested_reason === 'HOST_CANCELLED_DUE_TO_GUEST'
      ? { evidenceValidated: f.evidence_validated }
      : {}),
    checkinValidated: f.checkin_validated,
    ...(f.requested_reason === 'GUEST_NO_SHOW' && f.host_message_traced !== null
      ? { hostMessageTraced: f.host_message_traced }
      : {}),
  };
}

function proposal(w: World, f: Facts): SettlementRecord {
  const base = tripOfVector(w.e.vector);
  const trip = { ...base, startAtMs: Number(f.start_at_ms), bookedAtMs: Number(f.booked_at_ms) };
  return buildSettlementRecord(trip, eventOf(f), testParams(base.currency));
}

/** SUPPORTS_PAYOUT_ADJUSTMENT du moyen CARD, dans la transaction ANNULÉE du travailleur. */
async function capability(tx: Tx, w: World, atMs: number, status: string): Promise<void> {
  await tx.query(
    `SELECT test_fixture.us024_set_capability('FAKE', $1, 'CARD', 'SUPPORTS_PAYOUT_ADJUSTMENT',
                                              'true'::jsonb, $2, $3::timestamptz)`,
    [w.c.country, status, iso(atMs - MINUTE - Math.floor(Math.random() * 30_000))],
  );
}

/**
 * Règlement complet (transaction du travailleur) : faits, version proposée, liaison et transition,
 * puis ordres (réaffectation gardée par la capacité, remboursement), contrôles différés.
 */
async function settleFully(
  tx: Tx,
  w: World,
  id: string,
  atMs: number,
  orders: { readonly reallocation?: Legs; readonly refund: Legs },
): Promise<{ settlement: string; result: Row; record: SettlementRecord; facts: Facts }> {
  const facts = await begin(tx, id);
  const record = proposal(w, facts);
  const settlement = await recordAsSettlementWorker(
    tx,
    { tripId: w.trip, version: 1, tripRowVersion: facts.trip_row_version },
    record,
  );
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
  const r = await tx.query<{ r: Row }>(
    'SELECT core.booking_cmd_trip_settle_cancellation($1, $2) AS r',
    [id, settlement],
  );
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
  if (orders.reallocation !== undefined) {
    await capability(tx, w, atMs, 'VALIDATED_SANDBOX');
    await tx.query('SELECT core.payment_assert_payout_adjustment($1, $2)', [w.account, 'CARD']);
    const moved = LEGS.reduce(
      (s, k) => (orders.reallocation![k] > 0n ? s + orders.reallocation![k] : s),
      0n,
    );
    await recordOperation(tx, {
      tripId: w.trip,
      accountId: w.account,
      kind: 'LEG_REALLOCATION',
      amountMinor: moved,
      currency: w.c.currency,
      idemPlain: `${w.trip}:realloc:${uuid()}`,
      legs: orders.reallocation,
      settlement: { id: settlement, version: 1 },
    });
  }
  if (record.guestRefundMinor > 0n) {
    const idem = `${w.trip}:refund:${uuid()}`;
    const { rows } = await tx.query<{ status: string }>(
      `SELECT status
         FROM core.payment_cmd_plan_refund($1, $2, $3, $4, 1, 'NATIVE_PARTIAL', $5::jsonb, $6, $6)`,
      [uuid(), uuid(), settlement, w.capture, legsJson(orders.refund), idem],
    );
    expect(rows[0]?.status).toBe('PLANNED');
  }
  await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
  return { settlement, result: r.rows[0]?.r ?? {}, record, facts };
}

async function variationOf(tx: Tx, settlement: string): Promise<Legs> {
  await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
  return Object.fromEntries(
    (await legsOf(tx, settlement)).map((l) => [l.leg, l.variation]),
  ) as unknown as Legs;
}

async function ledgerOf(tx: Tx, trip: string) {
  const { rows } = await tx.query<{ reason: string; amount_minor: string; currency: string }>(
    'SELECT reason, amount_minor::text AS amount_minor, currency FROM test_fixture.us307_host_ledger($1)',
    [trip],
  );
  return rows.map((r) => ({ ...r, amount_minor: BigInt(r.amount_minor) }));
}

/** Transaction ANNULÉE du travailleur à l'instant `ms`. */
function asWorker<T>(worker: Tx, ms: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTestTransaction(worker, { virtualNow: iso(ms) }, fn);
}

const COUNTRY_CASES = [PA, PY] as const;

describe('critère 1 — délais en heure serveur depuis le début prévu (L3-PM-18)', () => {
  it.each(COUNTRY_CASES)(
    '%s : T+50 et T+59 ⇒ NO_SHOW_TOO_EARLY (hôte et console) ; T+72 h + 1 min ⇒ NO_SHOW_WINDOW_CLOSED ; voyageur à T+29 ⇒ trop tôt ; fenêtre lue',
    async (c) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          const w = await world(worker, c);
          for (const minutes of [50, 59]) {
            const r = await asParty(api, w, 'HOST', START_MS + minutes * MINUTE, false, (tx, h) =>
              report(tx, h, w.trip, uuid()),
            );
            expect(r, `T+${minutes}`).toMatchObject({ outcome: 'NO_SHOW_TOO_EARLY' });
          }
          const console50 = await act(api, w, 'DECLARE_NO_SHOW', START_MS + 50 * MINUTE, {
            absentParty: 'GUEST',
          });
          expect(console50).toMatchObject({ outcome: 'REFUSED', detail: 'NO_SHOW_TOO_EARLY' });
          const guest29 = await asParty(api, w, 'GUEST', START_MS + 29 * MINUTE, false, (tx, h) =>
            report(tx, h, w.trip, uuid()),
          );
          expect(guest29).toMatchObject({ outcome: 'NO_SHOW_TOO_EARLY' });
          const late = await asParty(
            api,
            w,
            'HOST',
            START_MS + 72 * HOUR + MINUTE,
            false,
            (tx, h) => report(tx, h, w.trip, uuid()),
          );
          expect(late).toMatchObject({ outcome: 'NO_SHOW_WINDOW_CLOSED' });
          const v = await asParty(api, w, 'HOST', START_MS + 50 * MINUTE, false, (tx, h) =>
            view(tx, h, w.trip),
          );
          expect(v).toMatchObject({
            outcome: 'OK',
            viewerRole: 'HOST',
            absentParty: 'GUEST',
            blocker: 'NO_SHOW_TOO_EARLY',
            messageTraced: false,
            declaration: null,
          });
          // grâce du pays figée à la réservation (no_show_grace_minutes = 60, graine 0009)
          expect(new Date(String(v['declarableFrom'])).getTime()).toBe(START_MS + 60 * MINUTE);
          expect(new Date(String(v['declarableUntil'])).getTime()).toBe(START_MS + 72 * HOUR);
          // aucune demande écrite par ces refus
          const none = await asParty(api, w, 'GUEST', START_MS + 50 * MINUTE, false, (tx, h) =>
            view(tx, h, w.trip),
          );
          expect(none['declaration']).toBeNull();
        });
      });
    },
  );

  it('un trip non ouvert à la remise ou d’une autre personne : CHECKIN_NOT_OPEN, NOT_FOUND', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const booked = await world(worker, PA, false);
        const at = START_MS + 70 * MINUTE;
        await asParty(api, booked, 'HOST', at, false, async (tx, h) => {
          expect(await report(tx, h, booked.trip, uuid())).toMatchObject({
            outcome: 'CHECKIN_NOT_OPEN',
          });
        });
        // l'hôte d'un AUTRE trip (aucun lien avec celui-ci) : même réponse qu'un trip inconnu
        const other = await world(worker, PA);
        await asParty(api, other, 'HOST', at, false, async (tx, h) => {
          expect(await report(tx, h, booked.trip, uuid())).toMatchObject({ outcome: 'NOT_FOUND' });
          expect(await view(tx, h, booked.trip)).toEqual({ outcome: 'NOT_FOUND' });
          expect(await report(tx, h, uuid(), uuid())).toMatchObject({ outcome: 'NOT_FOUND' });
        });
      });
    });
  });
});

describe('critère 2 — no-show du voyageur déclaré par l’hôte (T05, T39 ; OQ-BR-45)', () => {
  it.each(COUNTRY_CASES)(
    '%s : message de l’hôte + 15 min tracés (T05 / T41) ⇒ remboursement de l’export, jambes TJ04b, gains de l’hôte',
    async (c) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          const w = await world(worker, c);
          const id = uuid();
          const at = START_MS + 70 * MINUTE;
          const r = await asParty(api, w, 'HOST', at, true, async (tx, h) => {
            await message(tx, w, 'HOST', START_MS + 50 * MINUTE);
            return report(tx, h, w.trip, id);
          });
          expect(r).toMatchObject({ outcome: 'DONE', declaration_id: id });
          await asWorker(worker, at + MINUTE, async (tx) => {
            expect(await cancellation(tx, id)).toMatchObject({
              trip_id: w.trip,
              action_code: 'HOST_DECLARE_NO_SHOW',
              requested_reason: 'GUEST_NO_SHOW',
              initiator: 'HOST',
              status: 'PENDING',
              host_message_traced: true,
              requested_by: w.holder,
            });
            const { settlement, result, record } = await settleFully(tx, w, id, at, {
              refund: neg(w.e.noShowTraced),
            });
            expect(result).toMatchObject({
              status: 'NO_SHOW_GUEST',
              reason: 'GUEST_NO_SHOW',
              origin: 'EVENT',
              costBearer: 'GUEST',
              settlementId: settlement,
            });
            expect(record.engineVersion).toBe('cxl-beta/2');
            expect(record.guestRefundMinor).toBe(w.e.noShowRefund);
            expect(record.hostEarningsMinor).toBe(w.e.noShowHost);
            expect(await variationOf(tx, settlement)).toEqual(w.e.noShowTraced);
            expect(await ledgerOf(tx, w.trip)).toEqual([]);
          });
        });
      });
    },
  );

  it.each(COUNTRY_CASES)(
    '%s : aucun message tracé (T39, hôte inéligible) ⇒ même remboursement, toute la retenue à PLATFORM (TJ05a), HOST réaffectée (TJ05b) après la capacité validée',
    async (c) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          const w = await world(worker, c);
          const id = uuid();
          const at = START_MS + 70 * MINUTE;
          // message de l'hôte, mais le voyageur répond dans les 15 min : aucune attente tracée
          const r = await asParty(api, w, 'HOST', at, true, async (tx, h) => {
            await message(tx, w, 'HOST', START_MS + 50 * MINUTE);
            await message(tx, w, 'GUEST', START_MS + 55 * MINUTE);
            return report(tx, h, w.trip, id);
          });
          expect(r).toMatchObject({ outcome: 'DONE' });
          await asWorker(worker, at + MINUTE, async (tx) => {
            expect(await cancellation(tx, id)).toMatchObject({ host_message_traced: false });
            const { settlement, result, record } = await settleFully(tx, w, id, at, {
              reallocation: w.e.reallocation,
              refund: w.e.untracedRefund,
            });
            expect(result).toMatchObject({ status: 'NO_SHOW_GUEST', costBearer: 'GUEST' });
            expect(record.guestRefundMinor).toBe(w.e.noShowRefund);
            expect(record.hostEarningsMinor).toBe(0n);
            expect(await variationOf(tx, settlement)).toEqual(w.e.noShowUntraced);
            if (c.currency === 'USD') {
              const kept = Object.fromEntries(
                (await legsOf(tx, settlement)).map((l) => [l.leg, l.kept]),
              );
              expect(kept).toEqual(vec('TJ05a'));
            }
          });
        });
      });
    },
  );

  it('capacité SUPPORTS_PAYOUT_ADJUSTMENT inconnue ou non validée ⇒ leg_reallocation_unsupported (FIN_REVIEW_REQUIRED), jamais une réaffectation', async () => {
    await withRole('app_worker', async (worker) => {
      const w = await world(worker, PA);
      await asWorker(worker, START_MS + 2 * HOUR, async (tx) => {
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
        await capability(tx, w, START_MS + 2 * HOUR, 'UNKNOWN');
        const err = await caught(tx, () =>
          tx.query('SELECT core.payment_assert_payout_adjustment($1, $2)', [w.account, 'CARD']),
        );
        expect(err).toMatchObject({ code: '55000', constraint: 'leg_reallocation_unsupported' });
        expect(translateDbError(err).code).toBe('FIN_REVIEW_REQUIRED');
        // compte inconnu : même refus
        expect(
          await caught(tx, () =>
            tx.query('SELECT core.payment_assert_payout_adjustment($1, $2)', [uuid(), 'CARD']),
          ),
        ).toMatchObject({ constraint: 'leg_reallocation_unsupported' });
      });
    });
  });
});

describe('critère 3 — refus du véhicule validé par l’ops (REFUSE_AT_PICKUP)', () => {
  it.each(COUNTRY_CASES)(
    '%s : propreté ou sécurité ⇒ REFUSED_AT_PICKUP, remboursement intégral (FULL), pénalité cleanliness au host_ledger, porteur HOST',
    async (c) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          for (const motive of ['CLEANLINESS', 'SAFETY']) {
            const w = await world(worker, c);
            const at = START_MS + 10 * MINUTE;
            const r = await act(api, w, 'REFUSE_AT_PICKUP', at, { refusalReason: motive });
            expect(r.outcome, motive).toBe('DONE');
            const id = r.domain_ref ?? '';
            await asWorker(worker, at + MINUTE, async (tx) => {
              expect(await cancellation(tx, id)).toMatchObject({
                requested_reason: 'CLEANLINESS_SAFETY_VALID',
                initiator: 'GUEST',
                sub_reason: motive,
                host_message_traced: null,
              });
              const { settlement, result, record } = await settleFully(tx, w, id, at, {
                refund: neg(w.e.full),
              });
              expect(result).toMatchObject({
                status: 'REFUSED_AT_PICKUP',
                reason: 'CLEANLINESS_SAFETY_VALID',
                costBearer: 'HOST',
              });
              expect(record.guestRefundMinor).toBe(w.e.fullRefund);
              expect(record.hostPenaltyMinor).toBe(w.e.cleanliness);
              expect(await variationOf(tx, settlement)).toEqual(w.e.full);
              // 08 E7 règle 7 : la pénalité est une écriture du host_ledger, jamais une jambe
              expect(await ledgerOf(tx, w.trip)).toEqual([
                {
                  reason: 'HOST_CANCELLATION_PENALTY',
                  amount_minor: -w.e.cleanliness,
                  currency: c.currency,
                },
              ]);
            });
          }
        });
      });
    },
  );

  it.each(COUNTRY_CASES)(
    '%s : permis non conforme ⇒ T07 avec preuve validée (no-show du voyageur), T08 sans (requalifié, remboursement intégral, pénalité cxlLate)',
    async (c) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          const at = START_MS + 10 * MINUTE;
          const withProof = await world(worker, c);
          const r7 = await act(
            api,
            withProof,
            'REFUSE_AT_PICKUP',
            at,
            { refusalReason: 'INVALID_LICENSE' },
            [await evidenceFile(api)],
          );
          expect(r7.outcome).toBe('DONE');
          await asWorker(worker, at + MINUTE, async (tx) => {
            const { settlement, result, record } = await settleFully(
              tx,
              withProof,
              r7.domain_ref ?? '',
              at,
              { refund: neg(withProof.e.noShowTraced) },
            );
            expect(result).toMatchObject({ status: 'NO_SHOW_GUEST', costBearer: 'GUEST' });
            expect(record.guestRefundMinor).toBe(withProof.e.noShowRefund);
            expect(await variationOf(tx, settlement)).toEqual(withProof.e.noShowTraced);
            expect(await ledgerOf(tx, withProof.trip)).toEqual([]);
          });
          const without = await world(worker, c);
          const r8 = await act(api, without, 'REFUSE_AT_PICKUP', at, {
            refusalReason: 'INVALID_LICENSE',
          });
          expect(r8.outcome).toBe('DONE');
          await asWorker(worker, at + MINUTE, async (tx) => {
            const { settlement, result, record } = await settleFully(
              tx,
              without,
              r8.domain_ref ?? '',
              at,
              { refund: neg(without.e.full) },
            );
            expect(result).toMatchObject({
              status: 'CANCELLED_BY_HOST',
              reason: 'HOST_CANCELLED',
              origin: 'REQUALIFIED_NO_EVIDENCE',
              costBearer: 'HOST',
            });
            expect(record.guestRefundMinor).toBe(without.e.fullRefund);
            expect(record.hostPenaltyMinor).toBe(without.e.cxlLate);
            expect(await variationOf(tx, settlement)).toEqual(without.e.full);
            expect(await ledgerOf(tx, without.trip)).toMatchObject([
              { amount_minor: -without.e.cxlLate },
            ]);
          });
        });
      });
    },
  );

  it('après le check-in du voyageur ⇒ REFUSAL_AFTER_CHECKIN ; motif absent ⇒ REFUSAL_REASON_REQUIRED ; rien n’est écrit', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await world(worker, PA);
        const at = START_MS + 10 * MINUTE;
        expect(await act(api, w, 'REFUSE_AT_PICKUP', at, {})).toMatchObject({
          outcome: 'REFUSED',
          detail: 'REFUSAL_REASON_REQUIRED',
        });
        await withTestTransaction(api, { virtualNow: iso(at), commit: true }, async (tx) => {
          await tx.query('SELECT test_fixture.us307_guest_checkin($1)', [w.trip]);
        });
        expect(
          await act(api, w, 'REFUSE_AT_PICKUP', at, { refusalReason: 'CLEANLINESS' }),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'REFUSAL_AFTER_CHECKIN' });
        // le voyageur présent ne peut pas non plus être déclaré absent
        const r = await asParty(api, w, 'HOST', START_MS + 70 * MINUTE, false, (tx, h) =>
          report(tx, h, w.trip, uuid()),
        );
        expect(r).toMatchObject({ outcome: 'NO_SHOW_PARTY_PRESENT' });
      });
    });
  });
});

describe('critère 4 — no-show de l’hôte signalé par le voyageur (T26, BR-CXL-13)', () => {
  it.each(COUNTRY_CASES)(
    '%s : 30 min sans présentation, message du voyageur + 15 min sans réponse ⇒ NO_SHOW_HOST, remboursement intégral, pénalité hostNoShow au host_ledger',
    async (c) => {
      await withRole('app_api', async (api) => {
        await withRole('app_worker', async (worker) => {
          const w = await world(worker, c);
          const id = uuid();
          const at = START_MS + 31 * MINUTE;
          const r = await asParty(api, w, 'GUEST', at, true, async (tx, h) => {
            await message(tx, w, 'GUEST', START_MS + 5 * MINUTE);
            return report(tx, h, w.trip, id);
          });
          expect(r).toMatchObject({ outcome: 'DONE', declaration_id: id });
          await asWorker(worker, at + MINUTE, async (tx) => {
            expect(await cancellation(tx, id)).toMatchObject({
              action_code: 'GUEST_REPORT_HOST_NO_SHOW',
              requested_reason: 'HOST_NO_SHOW',
              initiator: 'GUEST',
              requested_by: w.guest,
              host_message_traced: null,
            });
            const { settlement, result, record } = await settleFully(tx, w, id, at, {
              refund: neg(w.e.full),
            });
            expect(result).toMatchObject({ status: 'NO_SHOW_HOST', costBearer: 'HOST' });
            expect(record.guestRefundMinor).toBe(w.e.fullRefund);
            expect(record.hostPenaltyMinor).toBe(w.e.hostNoShow);
            expect(await variationOf(tx, settlement)).toEqual(w.e.full);
            expect(await ledgerOf(tx, w.trip)).toEqual([
              {
                reason: 'HOST_CANCELLATION_PENALTY',
                amount_minor: -w.e.hostNoShow,
                currency: c.currency,
              },
            ]);
          });
        });
      });
    },
  );

  it('sans preuve (aucun message, ou réponse de l’hôte dans les 15 min) ⇒ NO_SHOW_EVIDENCE_REQUIRED ; hôte présent (permis contrôlé) ⇒ NO_SHOW_PARTY_PRESENT', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await world(worker, PY);
        const at = START_MS + 40 * MINUTE;
        await asParty(api, w, 'GUEST', at, false, async (tx, h) => {
          expect(await report(tx, h, w.trip, uuid())).toMatchObject({
            outcome: 'NO_SHOW_EVIDENCE_REQUIRED',
          });
          await message(tx, w, 'GUEST', START_MS + 5 * MINUTE);
          await message(tx, w, 'HOST', START_MS + 12 * MINUTE);
          expect(await report(tx, h, w.trip, uuid())).toMatchObject({
            outcome: 'NO_SHOW_EVIDENCE_REQUIRED',
          });
          // un message envoyé AVANT le début prévu n'est pas une attente au lieu de remise
          await message(tx, w, 'GUEST', START_MS - 30 * MINUTE);
          expect(await report(tx, h, w.trip, uuid())).toMatchObject({
            outcome: 'NO_SHOW_EVIDENCE_REQUIRED',
          });
          await message(tx, w, 'GUEST', START_MS + 20 * MINUTE);
          await tx.query('SELECT test_fixture.us307_identity_check($1, $2)', [
            w.trip,
            'TRIP_ID_OK',
          ]);
          expect(await report(tx, h, w.trip, uuid())).toMatchObject({
            outcome: 'NO_SHOW_PARTY_PRESENT',
          });
        });
      });
    });
  });

  it('console DECLARE_NO_SHOW (HOST) : sans pièce ni message ⇒ demande garée au règlement (trip_no_show_evidence_missing) ; avec une pièce ⇒ réglée', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const at = START_MS + 45 * MINUTE;
        const bare = await world(worker, PA);
        const r = await act(api, bare, 'DECLARE_NO_SHOW', at, { absentParty: 'HOST' });
        expect(r.outcome).toBe('DONE');
        await asWorker(worker, at + MINUTE, async (tx) => {
          const facts = await begin(tx, r.domain_ref ?? '');
          const settlement = await recordAsSettlementWorker(
            tx,
            { tripId: bare.trip, version: 1, tripRowVersion: facts.trip_row_version },
            proposal(bare, facts),
          );
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
          const err = await caught(tx, () =>
            tx.query('SELECT core.booking_cmd_trip_settle_cancellation($1, $2)', [
              r.domain_ref,
              settlement,
            ]),
          );
          expect(err).toMatchObject({ code: '55000', constraint: 'trip_no_show_evidence_missing' });
        });
        const proved = await world(worker, PA);
        const p = await act(api, proved, 'DECLARE_NO_SHOW', at, { absentParty: 'HOST' }, [
          await evidenceFile(api),
        ]);
        expect(p.outcome).toBe('DONE');
        await asWorker(worker, at + MINUTE, async (tx) => {
          const { result } = await settleFully(tx, proved, p.domain_ref ?? '', at, {
            refund: neg(proved.e.full),
          });
          expect(result).toMatchObject({ status: 'NO_SHOW_HOST', costBearer: 'HOST' });
        });
        // partie absente obligatoire
        expect(await act(api, proved, 'DECLARE_NO_SHOW', at, {})).toMatchObject({
          outcome: 'REFUSED',
        });
      });
    });
  });
});

describe('aucune déclaration ne se rejoue (idempotence, deux connexions)', () => {
  it('même requestId ⇒ l’issue d’origine ; autre requestId ⇒ CANCELLATION_PENDING ; requestId d’un autre trip ⇒ REQUEST_INVALID', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await world(worker, PA);
        const other = await world(worker, PA);
        const id = uuid();
        const at = START_MS + 70 * MINUTE;
        const first = await asParty(api, w, 'HOST', at, true, (tx, h) => report(tx, h, w.trip, id));
        expect(first).toMatchObject({ outcome: 'DONE', declaration_id: id });
        await asParty(api, w, 'HOST', at + 5 * MINUTE, false, async (tx, h) => {
          const again = await report(tx, h, w.trip, id);
          expect(again).toMatchObject({ outcome: 'DONE', declaration_id: id });
          expect((again['requested_at'] as Date).getTime()).toBe(at);
          expect(await report(tx, h, w.trip, uuid())).toMatchObject({
            outcome: 'CANCELLATION_PENDING',
          });
          const v = await view(tx, h, w.trip);
          expect(v['declaration']).toMatchObject({
            id,
            requestedReason: 'GUEST_NO_SHOW',
            status: 'PENDING',
            mine: true,
          });
          expect(v['blocker']).toBe('CANCELLATION_PENDING');
        });
        await asParty(api, other, 'HOST', at, false, async (tx, h) => {
          expect(await report(tx, h, other.trip, id)).toMatchObject({ outcome: 'REQUEST_INVALID' });
        });
        // le voyageur ne rejoue pas la demande de l'hôte
        await asParty(api, w, 'GUEST', at, false, async (tx, h) => {
          expect(await report(tx, h, w.trip, id)).toMatchObject({ outcome: 'REQUEST_INVALID' });
        });
        await parkAll(worker, [id], at);
      });
    });
  });

  it('deux connexions de l’hôte en même temps : la seconde attend le verrou consultatif, puis CANCELLATION_PENDING ; une seule demande', async () => {
    await withRole('app_worker', async (worker) => {
      const w = await world(worker, PY);
      const at = START_MS + 70 * MINUTE;
      const a = await connectAs('app_api');
      const b = await connectAs('app_api');
      try {
        const ha = await withTestTransaction(
          a,
          { virtualNow: iso(at), commit: true },
          async (tx) => (await openSession(tx, w.holder)).hash,
        );
        const hb = await withTestTransaction(
          b,
          { virtualNow: iso(at), commit: true },
          async (tx) => (await openSession(tx, w.holder)).hash,
        );
        const idA = uuid();
        const idB = uuid();
        await a.query('BEGIN');
        await a.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso(at)]);
        expect(await report(a, ha, w.trip, idA)).toMatchObject({ outcome: 'DONE' });
        // pid lu AVANT la déclaration de B : une requête sur b attendrait derrière elle
        const pidB = await backendPid(b);
        await b.query('BEGIN');
        await b.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso(at)]);
        const pending = report(b, hb, w.trip, idB);
        await waitUntilWaiting(worker, pidB);
        await a.query('COMMIT');
        expect(await pending).toMatchObject({ outcome: 'CANCELLATION_PENDING' });
        await b.query('COMMIT');
        await asWorker(worker, at + MINUTE, async (tx) => {
          expect(await cancellation(tx, idA)).toMatchObject({ status: 'PENDING' });
          expect(await cancellation(tx, idB)).toBeUndefined();
        });
        await parkAll(worker, [idA], at);
      } finally {
        await a.query('ROLLBACK').catch(() => undefined);
        await b.query('ROLLBACK').catch(() => undefined);
        await releaseClient(a);
        await releaseClient(b);
      }
    });
  });
});

/** Demandes VALIDÉES de ces preuves garées (FAILED) : aucune demande laissée en attente. */
async function parkAll(worker: Tx, ids: readonly string[], at: number): Promise<void> {
  await withTestTransaction(worker, { virtualNow: iso(at + HOUR), commit: true }, async (tx) => {
    await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
    for (const id of ids) {
      const { rows } = await tx.query<{ r: string }>(
        `SELECT core.booking_cmd_trip_park_cancellation($1, 'FAILED', 'TEST_CLEANUP') AS r`,
        [id],
      );
      expect(rows[0]?.r).toBe('PARKED');
    }
  });
}

/**
 * Attend que la session `pid` attende un verrou, quel qu'il soit (consultatif du voyageur, ou ligne
 * tenue par la première déclaration) : preuve que la seconde déclaration s'exécute APRÈS la première.
 */
async function waitUntilWaiting(observer: Tx, pid: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await observer.query<{ waiting: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_locks WHERE pid = $1 AND NOT granted) AS waiting',
      [pid],
    );
    if (r.rows[0]?.waiting === true) return;
    if (Date.now() > deadline) throw new Error(`la session ${pid} n'attend aucun verrou`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
