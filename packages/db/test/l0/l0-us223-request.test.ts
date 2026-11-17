/**
 * US-223 (partie 223c) — cycle d'une demande de réservation (hold REQUEST) : autorisation à l'envoi,
 * attente de l'hôte, acceptation (capture par jambes), refus et expiration (VOID total), IDOR et
 * concurrence (migration 0122, ADR-146 ; 17 §2.5 « Hold de demande REQUEST », deltas SQL,
 * exigences de sécurité 1 à 4 et d'argent a à c ; 19 US-223 critères US-060, US-219 critères 4 à 6).
 *
 * Données COMMITÉES (deux sessions, travailleurs, expiration sur toute la base) : ce fichier tourne
 * seul, après les autres (projet l0-concurrence de vitest.l0.config.ts), dans sa propre période
 * d'horloge virtuelle (2044). Aucun interrupteur ni paramètre n'est touché : le hold REQUEST est posé
 * par la VRAIE pose (fixture 9957, qui appelle core.booking_place_hold_kind dans le contexte du
 * voyageur), le devis engagé par la fixture 9969 (le checkout réel d'une annonce sur demande est
 * prouvé dans une transaction annulée, l0-us223-request-checkout) ; tout le reste par les VRAIES
 * commandes, sous les rôles de production (assertion L0-05 par connectAs) : hôte (US-107, US-126),
 * T1, T2 (app_api), webhooks signés (webhook_ingest), preuve (booking_conversion), commandes de
 * l'hôte par jeton (app_api), expiration (hold_expiry).
 *
 * Attendus : jambes des vecteurs TJ01 (USD) et TJ09a (PYG) de l'export des oracles (08 E7 règle 2 :
 * jambes de la capture = jambes du devis) ; booking_request_expiry_hours = 4 (17 §7.2, PROPOSÉ) ;
 * 19 US-219 : « demande envoyée à 10:00, acceptée à 12:30 ⇒ capturée par jambes, trip BOOKED » ;
 * « refusée ⇒ VOID, créneau libéré, rien n'est débité » ; « sans réponse à 14:00 (4 h) ⇒ expirée,
 * autorisation annulée, une acceptation tardive renvoie REQUEST_EXPIRED » ; 17 §2.5 : « acceptation
 * concurrente de l'expiration (une seule issue) », « FORBIDDEN sans révéler l'état », « tentative
 * d'écriture directe de request_respond_by » refusée.
 */
import { randomBytes } from 'node:crypto';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commandCallSql } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { at, COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase, Worker } from '../support/avl.ts';
import {
  backendPid,
  ensureParties,
  registerVehicles,
  waitUntilBlocked,
} from '../support/concurrency.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { legsJson } from '../support/pay.ts';

const LONG = 120_000;
const EXPIRY_H = 4;
const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';

const set = loadGoldenVectors();
const CAPTURE = Object.fromEntries(
  [legVector(set, 'TJ01'), legVector(set, 'TJ09a')].map((v) => [v.currency, v]),
);
const captureOf = (c: CountryCase) => CAPTURE[c.currency]!;
const legsText = (c: CountryCase): Record<string, string> =>
  Object.fromEntries(
    Object.entries(captureOf(c).legsMinor).map(([leg, amount]) => [leg, amount.toString()]),
  );

const ERA0 = Date.parse('2044-04-04T10:00:00.000Z');
const era = (n: number): string => new Date(ERA0 + n * 3 * 86_400_000).toISOString();
const atSec = (base: string, s: number): string =>
  new Date(Date.parse(base) + s * 1000).toISOString();

type Json = Record<string, unknown>;

let api: pg.Client;
let worker: pg.Client;

beforeEach(async () => {
  api = await connectAs('app_api');
  worker = await connectAs('app_worker');
});

afterEach(async () => {
  await releaseClient(worker);
  await releaseClient(api);
});

interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
}

interface World {
  readonly host: Host;
  readonly vehicle: string;
  readonly guest: string;
  readonly account: string;
}

/** Personne inscrite, session ouverte, compte d'hôte ACTIVE, CGU de l'hôte acceptées (US-107, US-126). */
async function newHost(c: CountryCase, when: string): Promise<Host> {
  return inTx(api, { virtualNow: when, commit: true }, async (tx) => {
    const userId = uuid();
    const r = await tx.query<{ ok: boolean }>(
      `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400,
                                                  NULL, $6, $7::jsonb, false) AS ok`,
      [
        userId,
        `us223c-${userId}@example.test`,
        phcArgon2id(),
        uuid(),
        randomBytes(32),
        c.country,
        DOCS,
      ],
    );
    if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
    await tx.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
    const t = newToken();
    await tx.query(
      `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
      [uuid(), userId, t.hash, SESSION_TTL_S],
    );
    const { rows } = await tx.query<{ outcome: string; org_id: string | null }>(
      'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
      [t.hash, c.country, 'INDIVIDUAL'],
    );
    if (rows[0]?.outcome !== 'DONE' || !rows[0].org_id) throw new Error('compte d’hôte refusé');
    await tx.query('SELECT test_fixture.us115_set_org_status($1, $2)', [rows[0].org_id, 'ACTIVE']);
    // CGU de l'hôte dans la version exigée en vigueur (N-66 : l'acceptation d'une demande l'exige)
    const current = await tx.query<{ outcome: string; version: number | null }>(
      'SELECT outcome, version FROM core.ctr_host_terms($1, $2, $3)',
      [t.hash, rows[0].org_id, 'es'],
    );
    const terms = await tx.query<{ outcome: string }>(
      'SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, $3, $4)',
      [t.hash, rows[0].org_id, current.rows[0]?.version ?? 1, 'es'],
    );
    if (terms.rows[0]?.outcome !== 'DONE') {
      throw new Error(`CGU de l’hôte : ${terms.rows[0]?.outcome}`);
    }
    return { userId, hash: t.hash, org: rows[0].org_id };
  });
}

/** Hôte, véhicule, voyageur au conducteur approuvé, compte FAKE, capacités validées. */
async function world(c: CountryCase, from: string): Promise<World> {
  const host = await newHost(c, from);
  const vehicle = uuid();
  const guest = uuid();
  const account = await inTx(api, { virtualNow: from, commit: true }, async (tx) => {
    await ensureParties(tx, [guest], host.org, c);
    await registerVehicles(tx, [vehicle], host.org, c);
    await tx.query('SELECT test_fixture.us209_driver($1, $2, $3::date, $4::date, $5)', [
      guest,
      c.country,
      '1990-01-01',
      '2060-12-31',
      c.country,
    ]);
    const { rows } = await tx.query<{ capability: string; kind: string }>(
      `SELECT capability, kind FROM core.payment_psp_capability_catalog WHERE blocking <> 'NO'`,
    );
    const caps: [string, unknown][] = rows.map((r) => [
      r.capability,
      r.kind === 'bool' ? true : r.kind === 'int' ? 1 : 'FAKE_HMAC_SHA256',
    ]);
    // 17 §2.5 « Moyens de paiement » d'une demande : pré-autorisation et annulation validées
    caps.push(['SUPPORTS_PREAUTH', true], ['SUPPORTS_VOID', true]);
    for (const [capability, value] of caps) {
      await tx.query(
        `SELECT test_fixture.us024_set_capability('FAKE', $1, '*', $2, $3::jsonb,
                                                  'VALIDATED_SANDBOX', $4::timestamptz)`,
        [c.country, capability, JSON.stringify(value), at(from, -60)],
      );
    }
    const a = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
      c.country,
    ]);
    return a.rows[0]!.id;
  });
  return { host, vehicle, guest, account };
}

async function guestCall<T>(
  guest: string,
  fn: string,
  args: { value: unknown; type: string }[],
  when: string,
): Promise<T> {
  return inTx(api, { virtualNow: when, commit: true }, async (tx) => {
    const { text, values } = commandCallSql({ kind: 'GUEST', actorId: guest }, fn, args);
    return (await tx.query<{ result: T }>(text, values)).rows[0]?.result as T;
  });
}

async function workerSql<T extends pg.QueryResultRow>(
  name: Worker,
  when: string | undefined,
  sql: string,
  params: unknown[],
  client: pg.Client = worker,
): Promise<T[]> {
  return inTx(
    client,
    { worker: name, ...(when !== undefined ? { virtualNow: when } : {}), commit: true },
    async (tx) => (await tx.query<T>(sql, params)).rows,
  );
}

const hostCall = async (
  fn: 'accept' | 'decline',
  h: Host,
  holdId: string,
  when: string,
  org: string = h.org,
): Promise<Json> =>
  inTx(api, { virtualNow: when, commit: true }, async (tx) => {
    const sql =
      fn === 'accept'
        ? 'SELECT core.booking_cmd_accept_booking_request($1, $2, $3) AS r'
        : 'SELECT core.booking_cmd_decline_booking_request($1, $2, $3) AS r';
    return (await tx.query<{ r: Json }>(sql, [h.hash, org, holdId])).rows[0]!.r;
  });

const recordCapture = async (h: Host, holdId: string, op: string, ref: string, when: string) =>
  inTx(api, { virtualNow: when, commit: true }, async (tx) =>
    String(
      (
        await tx.query<{ r: string }>(
          'SELECT core.booking_cmd_request_record_capture($1, $2, $3, $4, $5) AS r',
          [h.hash, h.org, holdId, op, ref],
        )
      ).rows[0]!.r,
    ),
  );

const webhook = async (op: string, status: string, when: string): Promise<string> =>
  (
    await workerSql<{ o: string }>(
      'webhook_ingest',
      when,
      `SELECT core.payment_cmd_apply_operation_status($1, $2, 'WEBHOOK',
                test_fixture.us049_signed_webhook($1, $2), NULL) AS o`,
      [op, status],
    )
  )[0]!.o;

const convert = async (op: string, when: string): Promise<Json> =>
  (
    await workerSql<{ r: Json }>(
      'booking_conversion',
      when,
      'SELECT core.booking_convert_payment($1) AS r',
      [op],
    )
  )[0]!.r;

const fail = async (op: string, when: string): Promise<Json> =>
  (
    await workerSql<{ r: Json }>(
      'booking_conversion',
      when,
      'SELECT core.booking_record_payment_failure($1) AS r',
      [op],
    )
  )[0]!.r;

const due = async (when: string): Promise<{ operation_id: string; action: string }[]> =>
  workerSql<{ operation_id: string; action: string }>(
    'booking_conversion',
    when,
    'SELECT operation_id, action FROM core.booking_conversion_due(10000)',
    [],
  );

const expireRequests = async (when: string): Promise<number> =>
  Number(
    (
      await workerSql<{ n: number }>(
        'hold_expiry',
        when,
        'SELECT core.booking_cmd_expire_booking_requests(10000) AS n',
        [],
      )
    )[0]!.n,
  );

interface HoldRow {
  status: string;
  kind: string;
  request_respond_by: Date | null;
  expires_at: Date;
  release_reason: string | null;
  converted_trip_id: string | null;
  occupancy_active: boolean;
}

async function hold(holdId: string): Promise<HoldRow> {
  return (
    await workerSql<HoldRow>(
      'booking_conversion',
      undefined,
      `SELECT h.status, h.kind, h.request_respond_by, h.expires_at, h.release_reason,
              h.converted_trip_id, o.active AS occupancy_active
         FROM core.booking_checkout_hold AS h
         JOIN core.booking_vehicle_occupancy AS o ON o.id = h.occupancy_id
        WHERE h.id = $1`,
      [holdId],
    )
  )[0]!;
}

interface OpRow {
  id: string;
  kind: string;
  status: string;
  amount_minor: string;
  idem_plain: string;
  legs: Record<string, string> | null;
}

async function ops(holdId: string): Promise<OpRow[]> {
  return workerSql<OpRow>(
    'booking_conversion',
    undefined,
    `SELECT o.id, o.kind, o.status, o.amount_minor::text AS amount_minor, o.idem_plain,
            (SELECT pg_catalog.jsonb_object_agg(l.leg, l.amount_minor::text)
               FROM core.payment_payment_operation_leg AS l WHERE l.operation_id = o.id) AS legs
       FROM core.payment_payment_operation AS o
      WHERE o.hold_id = $1
      ORDER BY o.created_at, o.kind`,
    [holdId],
  );
}

async function commands(
  holdId: string,
): Promise<{ operation_kind: string; idem_plain: string; operation_id: string; status: string }[]> {
  return workerSql(
    'payment_command',
    undefined,
    `SELECT operation_kind, idem_plain, operation_id, status FROM core.payment_payment_command
      WHERE hold_id = $1 ORDER BY created_at`,
    [holdId],
  );
}

async function events(holdId: string): Promise<string[]> {
  const rows = await workerSql<{ type: string }>(
    'outbox_relay',
    undefined,
    `SELECT type FROM core.outbox_outbox_event
      WHERE aggregate_type = 'checkout_hold' AND aggregate_id = $1 ORDER BY created_at, type`,
    [holdId],
  );
  return rows.map((r) => r.type);
}

/**
 * Demande envoyée : hold REQUEST posé par la vraie pose, devis engagé (fixture 9969), T1 (AUTH en
 * capture MANUAL), T2, webhook signé de l'autorisation, preuve (booking_conversion) ⇒ AWAITING_HOST.
 */
async function sentRequest(
  c: CountryCase,
  w: World,
  t0: string,
  start: string,
  end: string,
): Promise<{ holdId: string; auth: string; ref: string; sentAt: string }> {
  const holdId = await guestCall<string>(
    w.guest,
    'test_fixture.us223c_place_request_hold',
    [
      { value: w.vehicle, type: 'uuid' },
      { value: start, type: 'timestamptz' },
      { value: end, type: 'timestamptz' },
    ],
    t0,
  );
  const v = captureOf(c);
  await inTx(api, { virtualNow: t0, commit: true }, async (tx) => {
    await tx.query(
      `SELECT test_fixture.us223_checkout_acceptance($1, $2::bigint, $3, $4::jsonb,
                                                     $5::timestamptz, $6::timestamptz)`,
      [holdId, v.totalMinor.toString(), v.currency, legsJson(v.legsMinor), start, end],
    );
  });
  const t1 = await guestCall<Json>(
    w.guest,
    'core.booking_cmd_start_payment',
    [
      { value: holdId, type: 'uuid' },
      { value: w.account, type: 'uuid' },
      { value: 'CARD', type: 'text' },
    ],
    at(t0, 1),
  );
  expect(t1).toMatchObject({
    outcome: 'NEW_ORDER',
    captureMode: 'MANUAL',
    amountMinor: v.totalMinor.toString(),
    currency: v.currency,
    legs: legsText(c),
  });
  expect(t1['idemSent']).toBe(`hold:${holdId}:AUTH:a1`);
  const auth = t1['operationId'] as string;
  const ref = `fake-${uuid()}`;
  const t2 = await guestCall<string>(
    w.guest,
    'core.booking_cmd_record_order',
    [
      { value: holdId, type: 'uuid' },
      { value: auth, type: 'uuid' },
      { value: ref, type: 'text' },
      { value: at(t0, 6), type: 'timestamptz' },
    ],
    at(t0, 1),
  );
  expect(t2).toBe('RECORDED');
  const sentAt = at(t0, 2);
  expect(await webhook(auth, 'SUCCEEDED', sentAt)).toBe('APPLIED');
  expect(await due(sentAt)).toContainEqual({ operation_id: auth, action: 'CONVERT' });
  const r = await convert(auth, sentAt);
  expect(r['outcome']).toBe('AWAITING_HOST');
  return { holdId, auth, ref, sentAt };
}

describe.each(COUNTRIES)('US-223c — demande de réservation ($country, $currency)', (c) => {
  const idx = COUNTRIES.indexOf(c) * 10;

  it(
    'envoi (17 §2.5) : autorisation AUTH prouvée ⇒ AWAITING_HOST, heure limite = preuve + 4 h, aucune capture ni trip ni disposition ; l’autorisation n’est plus due ni réparée',
    async () => {
      const T0 = era(idx);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, at(start, 2 * 24 * 60));
      const h = await hold(r.holdId);
      expect(h).toMatchObject({ status: 'AWAITING_HOST', kind: 'REQUEST', occupancy_active: true });
      const respondBy = new Date(Date.parse(r.sentAt) + EXPIRY_H * 3_600_000).toISOString();
      expect(h.request_respond_by?.toISOString()).toBe(respondBy);
      expect(h.expires_at.toISOString()).toBe(respondBy);
      const list = await ops(r.holdId);
      expect(list.map((o) => [o.kind, o.status])).toEqual([['AUTH', 'SUCCEEDED']]);
      expect(list[0]!.legs).toEqual(legsText(c));
      expect(h.converted_trip_id).toBeNull();
      // réglée : jamais convertie de nouveau, jamais réparée par le balayage des dispositions
      expect(await due(at(r.sentAt, 30))).not.toContainEqual(
        expect.objectContaining({ operation_id: r.auth }),
      );
      const candidates = await workerSql<{ operation_id: string }>(
        'disposition_sweeper',
        at(r.sentAt, 120),
        'SELECT operation_id FROM core.booking_disposition_candidates(10000)',
        [],
      );
      expect(candidates.map((x) => x.operation_id)).not.toContain(r.auth);
      expect(await convert(r.auth, at(r.sentAt, 1))).toMatchObject({ outcome: 'REPLAY' });
      expect(await events(r.holdId)).toContain('booking.request.received');
      // 17 §2.5 exigence 3 : request_respond_by gardée, jamais prolongée (écriture directe refusée)
      await expect(
        workerSql(
          'booking_conversion',
          undefined,
          `UPDATE core.booking_checkout_hold SET request_respond_by = request_respond_by + interval '1 hour'
            WHERE id = $1`,
          [r.holdId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    },
    LONG,
  );

  it(
    'US-219 critère 4 : demande envoyée, acceptée 2 h 30 après ⇒ capture par jambes (Σ jambes = total = AUTH), affinage, preuve signée ⇒ trip BOOKED ; rejeu ⇒ ACCEPTED',
    async () => {
      const T0 = era(idx + 1);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, at(start, 2 * 24 * 60));
      const v = captureOf(c);
      const acceptAt = at(r.sentAt, 150);
      const a = await hostCall('accept', w.host, r.holdId, acceptAt);
      expect(a).toMatchObject({
        outcome: 'CAPTURE_ORDER',
        amountMinor: v.totalMinor.toString(),
        currency: v.currency,
        legs: legsText(c),
        authorizationReference: r.ref,
        provider: 'FAKE',
        method: 'CARD',
      });
      expect(a['idemSent']).toBe(`hold:${r.holdId}:CAPTURE:a1`);
      const sum = Object.values(v.legsMinor).reduce((s, x) => s + x, 0n);
      expect(sum).toBe(v.totalMinor);
      expect((await hold(r.holdId)).status).toBe('PAYMENT_IN_FLIGHT');
      const cap = a['operationId'] as string;
      // rejeu pendant la capture : jamais une seconde capture
      expect(await hostCall('accept', w.host, r.holdId, at(acceptAt, 1))).toMatchObject({
        outcome: 'RETRY_SAME_KEY',
        operationId: cap,
        idemSent: `hold:${r.holdId}:CAPTURE:a1`,
      });
      expect(
        await recordCapture(w.host, r.holdId, cap, `fake-cap-${uuid()}`, at(acceptAt, 1)),
      ).toBe('RECORDED');
      expect(await hostCall('accept', w.host, r.holdId, at(acceptAt, 1))).toEqual({
        outcome: 'CAPTURING',
      });
      const list = await ops(r.holdId);
      const capture = list.find((o) => o.kind === 'CAPTURE');
      const authorization = list.find((o) => o.kind === 'AUTH');
      expect(capture).toMatchObject({ status: 'SUBMITTED', amount_minor: v.totalMinor.toString() });
      expect(capture!.legs).toEqual(legsText(c));
      expect(BigInt(capture!.amount_minor) <= BigInt(authorization!.amount_minor)).toBe(true);
      expect(await webhook(cap, 'SUCCEEDED', at(acceptAt, 2))).toBe('APPLIED');
      expect(await convert(cap, at(acceptAt, 2))).toMatchObject({ outcome: 'CONVERTED' });
      const h = await hold(r.holdId);
      expect(h.status).toBe('CONVERTED');
      expect(h.converted_trip_id).not.toBeNull();
      expect(await hostCall('accept', w.host, r.holdId, at(acceptAt, 3))).toEqual({
        outcome: 'ACCEPTED',
      });
      expect(await events(r.holdId)).toEqual(
        expect.arrayContaining(['booking.request.accepted', 'booking.hold.converted']),
      );
      // aucun VOID : l'autorisation a été capturée
      expect(await commands(r.holdId)).toEqual([]);
    },
    LONG,
  );

  it(
    'US-219 critère 5 : refus ⇒ RELEASED (REQUEST_DECLINED), créneau libéré, VOID total (aucune jambe) dans la boîte d’envoi, aucun débit ; rejeu ⇒ DECLINED ; acceptation ensuite ⇒ INVALID_TRANSITION',
    async () => {
      const T0 = era(idx + 2);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const end = at(start, 2 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, end);
      const declineAt = at(r.sentAt, 60);
      expect(await hostCall('decline', w.host, r.holdId, declineAt)).toEqual({
        outcome: 'DECLINED',
      });
      const h = await hold(r.holdId);
      expect(h).toMatchObject({
        status: 'RELEASED',
        release_reason: 'REQUEST_DECLINED',
        occupancy_active: false,
      });
      const list = await ops(r.holdId);
      expect(list.map((o) => o.kind).sort()).toEqual(['AUTH', 'VOID']);
      const voidOp = list.find((o) => o.kind === 'VOID')!;
      // VOID total : montant de l'autorisation, aucune jambe (≠ VOID du reliquat, TJ03)
      expect(voidOp).toMatchObject({
        status: 'PENDING',
        amount_minor: captureOf(c).totalMinor.toString(),
        legs: null,
        idem_plain: `hold:${r.holdId}:VOID:a1`,
      });
      expect(await commands(r.holdId)).toEqual([
        {
          operation_kind: 'VOID',
          idem_plain: `hold:${r.holdId}:VOID:${voidOp.id}:a1`,
          operation_id: voidOp.id,
          status: 'PENDING',
        },
      ]);
      expect(list.some((o) => o.kind === 'CAPTURE')).toBe(false);
      expect(await hostCall('decline', w.host, r.holdId, at(declineAt, 1))).toEqual({
        outcome: 'DECLINED',
      });
      expect(await commands(r.holdId)).toHaveLength(1);
      expect(await hostCall('accept', w.host, r.holdId, at(declineAt, 2))).toEqual({
        outcome: 'INVALID_TRANSITION',
      });
      expect(await events(r.holdId)).toContain('booking.request.declined');
      // créneau libéré : un autre voyageur pose un hold sur les mêmes dates
      const other = uuid();
      await inTx(api, { virtualNow: declineAt, commit: true }, (tx) =>
        ensureParties(tx, [other], w.host.org, c),
      );
      const again = await guestCall<string>(
        other,
        'core.booking_cmd_place_hold',
        [
          { value: w.vehicle, type: 'uuid' },
          { value: start, type: 'timestamptz' },
          { value: end, type: 'timestamptz' },
          { value: false, type: 'boolean' },
        ],
        at(declineAt, 3),
      );
      expect(again).toMatch(/^[0-9a-f-]{36}$/);
    },
    LONG,
  );

  it(
    'US-219 critère 6 : sans réponse à l’heure limite (4 h) ⇒ EXPIRED par la tâche, VOID, créneau libéré ; une acceptation tardive renvoie REQUEST_EXPIRED',
    async () => {
      const T0 = era(idx + 3);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, at(start, 2 * 24 * 60));
      const limit = new Date(Date.parse(r.sentAt) + EXPIRY_H * 3_600_000).toISOString();
      // une seconde avant l'heure limite : la demande n'expire pas (la tâche porte sur toute la base :
      // seules les demandes échues des autres preuves de ce fichier peuvent être comptées)
      await expireRequests(atSec(limit, -1));
      expect((await hold(r.holdId)).status).toBe('AWAITING_HOST');
      // heure limite atteinte, tâche pas encore passée : l'acceptation est refusée quand même
      expect(await hostCall('accept', w.host, r.holdId, limit)).toEqual({
        outcome: 'REQUEST_EXPIRED',
      });
      expect(await hostCall('decline', w.host, r.holdId, limit)).toEqual({
        outcome: 'REQUEST_EXPIRED',
      });
      expect(await expireRequests(limit)).toBeGreaterThanOrEqual(1);
      const h = await hold(r.holdId);
      expect(h).toMatchObject({ status: 'EXPIRED', occupancy_active: false });
      const list = await ops(r.holdId);
      expect(list.map((o) => o.kind).sort()).toEqual(['AUTH', 'VOID']);
      expect((await commands(r.holdId)).map((x) => x.operation_kind)).toEqual(['VOID']);
      expect(await hostCall('accept', w.host, r.holdId, at(limit, 1))).toEqual({
        outcome: 'REQUEST_EXPIRED',
      });
      expect(await events(r.holdId)).toContain('booking.request.expired');
      // rejeu de la tâche : rien de plus pour cette demande
      await expireRequests(at(limit, 2));
      expect(await commands(r.holdId)).toHaveLength(1);
      expect((await hold(r.holdId)).status).toBe('EXPIRED');
    },
    LONG,
  );

  it(
    '17 §2.5 exigence 2 (IDOR) : un autre hôte, un compte qui n’est pas le sien, un voyageur ou un hold inconnu ⇒ FORBIDDEN sans état, rien n’est modifié, refus journalisé',
    async () => {
      const T0 = era(idx + 4);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, at(start, 2 * 24 * 60));
      const intruder = await newHost(c, T0);
      const t = at(r.sentAt, 10);
      for (const fn of ['accept', 'decline'] as const) {
        // le compte de l'hôte A avec la session de l'hôte B
        expect(await hostCall(fn, intruder, r.holdId, t, w.host.org)).toEqual({
          outcome: 'FORBIDDEN',
        });
        // son propre compte, mais la demande d'un autre
        expect(await hostCall(fn, intruder, r.holdId, t, intruder.org)).toEqual({
          outcome: 'FORBIDDEN',
        });
        expect(await hostCall(fn, w.host, uuid(), t)).toEqual({ outcome: 'FORBIDDEN' });
      }
      expect(
        await inTx(api, { virtualNow: t, commit: true }, async (tx) =>
          String(
            (
              await tx.query<{ r: string }>(
                'SELECT core.booking_cmd_request_record_capture($1, $2, $3, $4, $5) AS r',
                [intruder.hash, intruder.org, r.holdId, r.auth, 'fake-x'],
              )
            ).rows[0]!.r,
          ),
        ),
      ).toBe('FORBIDDEN');
      // la même réponse pour une demande expirée d'un autre compte (aucun état révélé)
      expect(await hostCall('accept', intruder, r.holdId, at(r.sentAt, 5 * 60))).toEqual({
        outcome: 'FORBIDDEN',
      });
      expect((await hold(r.holdId)).status).toBe('AWAITING_HOST');
      expect(await ops(r.holdId)).toHaveLength(1);
      expect(await events(r.holdId)).toContain('booking.request.access_denied');
      // lecture des demandes : le compte d'un autre ⇒ FORBIDDEN ; le sien : sa demande, sans jambe
      // autre que HOST
      const rows = await inTx(api, { virtualNow: t, commit: true }, async (tx) => ({
        intruder: (
          await tx.query<Json>('SELECT * FROM core.booking_host_requests($1, $2, NULL, 10)', [
            intruder.hash,
            w.host.org,
          ])
        ).rows,
        own: (
          await tx.query<Json>('SELECT * FROM core.booking_host_requests($1, $2, NULL, 10)', [
            w.host.hash,
            w.host.org,
          ])
        ).rows,
      }));
      expect(rows.intruder).toEqual([
        expect.objectContaining({ outcome: 'FORBIDDEN', hold_id: null }),
      ]);
      expect(rows.own).toEqual([
        expect.objectContaining({
          outcome: 'DONE',
          hold_id: r.holdId,
          status: 'AWAITING_HOST',
          currency: c.currency,
          host_leg_minor: captureOf(c).legsMinor.HOST?.toString(),
        }),
      ]);
    },
    LONG,
  );

  it(
    '17 §2.5 « Capture refusée à l’acceptation » : refus reçu de la capture ⇒ RELEASED (PAYMENT_DECLINED), créneau libéré, VOID de l’autorisation, aucun trip',
    async () => {
      const T0 = era(idx + 5);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, at(start, 2 * 24 * 60));
      const acceptAt = at(r.sentAt, 30);
      const a = await hostCall('accept', w.host, r.holdId, acceptAt);
      const cap = a['operationId'] as string;
      expect(await recordCapture(w.host, r.holdId, cap, `fake-cap-${uuid()}`, acceptAt)).toBe(
        'RECORDED',
      );
      expect(await webhook(cap, 'FAILED', at(acceptAt, 1))).toBe('APPLIED');
      expect(await due(at(acceptAt, 1))).toContainEqual({ operation_id: cap, action: 'FAIL' });
      expect(await fail(cap, at(acceptAt, 1))).toMatchObject({
        outcome: 'RELEASED',
        request: true,
      });
      const h = await hold(r.holdId);
      expect(h).toMatchObject({
        status: 'RELEASED',
        release_reason: 'PAYMENT_DECLINED',
        occupancy_active: false,
        converted_trip_id: null,
      });
      expect((await commands(r.holdId)).map((x) => x.operation_kind)).toEqual(['VOID']);
    },
    LONG,
  );

  it(
    '17 §2.5 : acceptation concurrente de l’expiration (deux sessions) ⇒ une seule issue : la tâche verrouille d’abord, l’acceptation lit EXPIRED, aucune capture',
    async () => {
      const T0 = era(idx + 6);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, at(start, 2 * 24 * 60));
      const limit = new Date(Date.parse(r.sentAt) + EXPIRY_H * 3_600_000).toISOString();
      const api2 = await connectAs('app_api');
      try {
        const pid2 = await backendPid(api2);
        const outcome = await inTx(
          worker,
          { worker: 'hold_expiry', virtualNow: limit, commit: true },
          async (tx) => {
            const n = await tx.query<{ n: number }>(
              'SELECT core.booking_cmd_expire_booking_requests(10000) AS n',
            );
            expect(Number(n.rows[0]!.n)).toBeGreaterThanOrEqual(1);
            // acceptation une minute avant l'heure limite (horloge de sa transaction) : elle attend
            // la ligne verrouillée par l'expiration
            const accept = inTx(
              api2,
              { virtualNow: at(limit, -1), commit: true },
              async (tx2) =>
                (
                  await tx2.query<{ r: Json }>(
                    'SELECT core.booking_cmd_accept_booking_request($1, $2, $3) AS r',
                    [w.host.hash, w.host.org, r.holdId],
                  )
                ).rows[0]!.r,
            );
            await waitUntilBlocked(api, pid2, 'transactionid');
            // promesse emballée : la transaction de l'expiration valide AVANT d'attendre l'issue
            return { accept };
          },
        );
        expect(await outcome.accept).toEqual({ outcome: 'REQUEST_EXPIRED' });
      } finally {
        await releaseClient(api2);
      }
      expect((await hold(r.holdId)).status).toBe('EXPIRED');
      expect((await ops(r.holdId)).some((o) => o.kind === 'CAPTURE')).toBe(false);
      expect((await commands(r.holdId)).map((x) => x.operation_kind)).toEqual(['VOID']);
    },
    LONG,
  );
});
