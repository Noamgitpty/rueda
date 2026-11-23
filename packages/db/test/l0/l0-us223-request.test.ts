/**
 * US-223 (partie 223c) — cycle d'une demande de réservation (hold REQUEST) : autorisation à l'envoi,
 * attente de l'hôte, acceptation (capture par jambes), refus et expiration (VOID total), IDOR et
 * concurrence (migration 0126, ADR-146 ; 17 §2.5 « Hold de demande REQUEST », deltas SQL,
 * exigences de sécurité 1 à 4 et d'argent a à c ; 19 US-223 critères US-060, US-219 critères 4 à 6).
 *
 * Données COMMITÉES (deux sessions, travailleurs, expiration sur toute la base) : ce fichier tourne
 * seul, après les autres (projet l0-concurrence de vitest.l0.config.ts), dans sa propre période
 * d'horloge virtuelle (2044). Aucun interrupteur ni paramètre n'est touché : le hold REQUEST est posé
 * par la VRAIE pose (fixture 9959, qui appelle core.booking_place_hold_kind dans le contexte du
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
import { connectAs, releaseClient, signedOpenParams } from '../../src/testing/index.ts';
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
  /** Empreinte de la session du voyageur (lecture de sa demande). */
  readonly guestHash: Buffer;
  readonly account: string;
}

/** Personne inscrite, session ouverte, compte d'hôte ACTIVE, CGU de l'hôte acceptées (US-107, US-126). */
async function newHost(c: CountryCase, when: string, acceptTerms = true): Promise<Host> {
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
      `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest', $5, $6) AS expires_at`,
      await signedOpenParams(tx, [uuid(), userId, t.hash, SESSION_TTL_S]),
    );
    const { rows } = await tx.query<{ outcome: string; org_id: string | null }>(
      'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
      [t.hash, c.country, 'INDIVIDUAL'],
    );
    if (rows[0]?.outcome !== 'DONE' || !rows[0].org_id) throw new Error('compte d’hôte refusé');
    await tx.query('SELECT test_fixture.us115_set_org_status($1, $2)', [rows[0].org_id, 'ACTIVE']);
    // CGU de l'hôte dans la version exigée en vigueur (N-66 : l'acceptation d'une demande l'exige)
    if (!acceptTerms) return { userId, hash: t.hash, org: rows[0].org_id };
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
async function world(c: CountryCase, from: string, hostTerms = true): Promise<World> {
  const host = await newHost(c, from, hostTerms);
  const vehicle = uuid();
  const guest = uuid();
  const guestToken = newToken();
  const account = await inTx(api, { virtualNow: from, commit: true }, async (tx) => {
    await ensureParties(tx, [guest], host.org, c);
    await tx.query(
      `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest', $5, $6) AS expires_at`,
      await signedOpenParams(tx, [uuid(), guest, guestToken.hash, SESSION_TTL_S]),
    );
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
  return { host, vehicle, guest, guestHash: guestToken.hash, account };
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
  payment_in_flight_until: Date | null;
}

async function hold(holdId: string): Promise<HoldRow> {
  return (
    await workerSql<HoldRow>(
      'booking_conversion',
      undefined,
      `SELECT h.status, h.kind, h.request_respond_by, h.expires_at, h.release_reason,
              h.converted_trip_id, o.active AS occupancy_active, h.payment_in_flight_until
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

/** Lecture de la demande par le voyageur (core.booking_checkout_request, app_api). */
async function readRequest(w: World, holdId: string, when: string): Promise<Json> {
  return inTx(
    api,
    { virtualNow: when, commit: false },
    async (tx) =>
      (
        await tx.query<Json>('SELECT * FROM core.booking_checkout_request($1, $2)', [
          w.guestHash,
          holdId,
        ])
      ).rows[0]!,
  );
}

/** Pose, devis engagé, T1 (AUTH MANUAL) et T2 : demande en cours d'autorisation. */
async function authorizing(
  c: CountryCase,
  w: World,
  t0: string,
  start: string,
  end: string,
): Promise<{ holdId: string; auth: string; ref: string }> {
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
  expect(t1).toMatchObject({ outcome: 'NEW_ORDER', captureMode: 'MANUAL' });
  const auth = t1['operationId'] as string;
  const ref = `fake-${uuid()}`;
  expect(
    await guestCall<string>(
      w.guest,
      'core.booking_cmd_record_order',
      [
        { value: holdId, type: 'uuid' },
        { value: auth, type: 'uuid' },
        { value: ref, type: 'text' },
        { value: at(t0, 6), type: 'timestamptz' },
      ],
      at(t0, 1),
    ),
  ).toBe('RECORDED');
  return { holdId, auth, ref };
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
  // lecture du voyageur : autorisation pas encore prouvée
  expect(await readRequest(w, holdId, at(t0, 1))).toMatchObject({
    outcome: 'DONE',
    hold_kind: 'REQUEST',
    request_status: 'AUTHORIZING',
    request_respond_by: null,
  });
  expect(await webhook(auth, 'SUCCEEDED', sentAt)).toBe('APPLIED');
  expect(await due(sentAt)).toContainEqual({ operation_id: auth, action: 'CONVERT' });
  const r = await convert(auth, sentAt);
  expect(r['outcome']).toBe('AWAITING_HOST');
  expect((await readRequest(w, holdId, sentAt))['request_status']).toBe('AWAITING_HOST');
  return { holdId, auth, ref, sentAt };
}

/**
 * US-213 (0133, ADR-157) : parties du hold lues par le travailleur des notifications. Assertions
 * AJOUTÉES aux issues « capture refusée » et « capture jamais confirmée » (aucune assertion
 * existante modifiée) : la règle NTF de la capture refusée lit ces faits en base.
 */
async function notificationParties(holdId: string, when: string): Promise<Json | null> {
  return inTx(worker, { worker: 'ntf_dispatcher', virtualNow: when }, async (tx) => {
    const { rows } = await tx.query<{ p: Json | null }>(
      'SELECT core.booking_notification_parties($1, $2::uuid) AS p',
      ['HOLD', holdId],
    );
    return rows[0]?.p ?? null;
  });
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
      expect((await readRequest(w, r.holdId, at(acceptAt, 1)))['request_status']).toBe('CAPTURING');
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
      expect((await readRequest(w, r.holdId, at(acceptAt, 3)))['request_status']).toBe('ACCEPTED');
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
      expect((await readRequest(w, r.holdId, declineAt))['request_status']).toBe('DECLINED');
      // escalade (exigence d'argent c) : VOID non confirmé compté après 30 min, par pays, pas avant
      const pending = async (when: string): Promise<number> => {
        const rows = await workerSql<{
          metric: string;
          country_code: string | null;
          value: string;
        }>(
          'ops_monitor' as Worker,
          when,
          `SELECT metric, country_code, value::text AS value
             FROM core.ops_monitor_metrics($1::timestamptz, 3)`,
          [at(when, -1)],
        );
        const row = rows.find(
          (x) => x.metric === 'request_void_pending_30m' && x.country_code === c.country,
        );
        return row === undefined ? 0 : Number(row.value);
      };
      expect((await pending(at(declineAt, 31))) - (await pending(at(declineAt, 29)))).toBe(1);
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
      expect((await readRequest(w, r.holdId, limit))['request_status']).toBe('EXPIRED');
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
      expect((await readRequest(w, r.holdId, at(acceptAt, 1)))['request_status']).toBe(
        'CAPTURE_FAILED',
      );
      // US-213 : voyageur et titulaire du compte d'hôte prévenus (faits de la règle NTF)
      expect(await notificationParties(r.holdId, at(acceptAt, 1))).toEqual({
        guestUserId: w.guest,
        hostUserId: w.host.userId,
        holdKind: 'REQUEST',
        holdStatus: 'RELEASED',
        releaseReason: 'PAYMENT_DECLINED',
        requestAuthorized: true,
      });
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
  it(
    'autorisation prouvée après la sortie du hold (expiration 2a pendant un ordre UNKNOWN) ⇒ VOID (LATE_AUTHORIZATION), jamais d’attente de l’hôte ; lecture ENDED',
    async () => {
      const T0 = era(idx + 7);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await authorizing(c, w, T0, start, at(start, 2 * 24 * 60));
      // réponse d'API sans issue : l'ordre reste UNKNOWN ; au-delà de la borne et de la grâce, 2a
      // expire le hold (hold_max_total_minutes 20, sweep_grace_s 60 : 17 §7.2)
      await workerSql(
        'payment_command',
        at(T0, 2),
        `SELECT core.payment_cmd_apply_operation_status($1, 'UNKNOWN', 'API_RESPONSE', NULL, NULL)`,
        [r.auth],
      );
      await workerSql('hold_expiry', at(T0, 30), 'SELECT core.booking_expire_due_holds(10000)', []);
      expect((await hold(r.holdId)).status).toBe('EXPIRED');
      expect(await webhook(r.auth, 'SUCCEEDED', at(T0, 31))).toBe('APPLIED');
      expect(await due(at(T0, 31))).toContainEqual({ operation_id: r.auth, action: 'CONVERT' });
      expect(await convert(r.auth, at(T0, 31))).toEqual({ outcome: 'VOID_REQUESTED' });
      const h = await hold(r.holdId);
      expect(h).toMatchObject({ status: 'EXPIRED', request_respond_by: null });
      expect((await commands(r.holdId)).map((x) => x.operation_kind)).toContain('VOID');
      expect(await due(at(T0, 32))).not.toContainEqual(
        expect.objectContaining({ operation_id: r.auth }),
      );
      expect(await events(r.holdId)).toContain('booking.request.void_requested');
      expect((await readRequest(w, r.holdId, at(T0, 32)))['request_status']).toBe('ENDED');
    },
    LONG,
  );

  it(
    'abandon du voyageur pendant l’autorisation (libération différée) ⇒ à la preuve : RELEASED (GUEST_ABANDON), créneau libéré, VOID ; la demande n’est jamais ouverte à l’hôte',
    async () => {
      const T0 = era(idx + 8);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await authorizing(c, w, T0, start, at(start, 2 * 24 * 60));
      const released = await guestCall<string>(
        w.guest,
        'core.booking_cmd_release_own_hold',
        [{ value: r.holdId, type: 'uuid' }],
        at(T0, 2),
      );
      expect(released).toBe('DEFERRED');
      expect(await webhook(r.auth, 'SUCCEEDED', at(T0, 3))).toBe('APPLIED');
      expect(await convert(r.auth, at(T0, 3))).toEqual({
        outcome: 'VOID_REQUESTED',
        reason: 'GUEST_ABANDON',
      });
      expect(await hold(r.holdId)).toMatchObject({
        status: 'RELEASED',
        release_reason: 'GUEST_ABANDON',
        occupancy_active: false,
        request_respond_by: null,
      });
      expect((await commands(r.holdId)).map((x) => x.operation_kind)).toContain('VOID');
      expect(await hostCall('accept', w.host, r.holdId, at(T0, 4))).toEqual({
        outcome: 'INVALID_TRANSITION',
      });
      expect((await readRequest(w, r.holdId, at(T0, 4)))['request_status']).toBe('ENDED');
    },
    LONG,
  );

  it(
    'N-66 : CGU de l’hôte non acceptées ⇒ TERMS_REACCEPT_REQUIRED, aucune capture, la demande reste en attente',
    async () => {
      const T0 = era(idx + 9);
      const w = await world(c, T0, false);
      const start = at(T0, 3 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, at(start, 2 * 24 * 60));
      expect(await hostCall('accept', w.host, r.holdId, at(r.sentAt, 10))).toEqual({
        outcome: 'TERMS_REACCEPT_REQUIRED',
      });
      expect((await hold(r.holdId)).status).toBe('AWAITING_HOST');
      expect((await ops(r.holdId)).map((o) => o.kind)).toEqual(['AUTH']);
    },
    LONG,
  );

  it(
    'voyageur devenu inéligible : avant l’acceptation ⇒ GUEST_NOT_ELIGIBLE, aucune capture ; après la capture ⇒ la conversion compense (COMPENSATED), jamais un trip',
    async () => {
      const T0 = era(idx + 10);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, at(start, 2 * 24 * 60));
      // second monde une minute après : capacités datées autrement (clé unique de la capacité)
      const other = await world(c, at(T0, 1));
      const r2 = await sentRequest(c, other, T0, start, at(start, 2 * 24 * 60));
      // r2 : capture acceptée d'abord, restriction ensuite
      const a2 = await hostCall('accept', other.host, r2.holdId, at(r2.sentAt, 5));
      expect(a2['outcome']).toBe('CAPTURE_ORDER');
      const cap = a2['operationId'] as string;
      expect(
        await recordCapture(other.host, r2.holdId, cap, `fake-cap-${uuid()}`, at(r2.sentAt, 5)),
      ).toBe('RECORDED');
      await inTx(api, { virtualNow: at(r.sentAt, 6), commit: true }, async (tx) => {
        await tx.query('SELECT test_fixture.us209_restrict($1)', [w.guest]);
        await tx.query('SELECT test_fixture.us209_restrict($1)', [other.guest]);
      });
      expect(await hostCall('accept', w.host, r.holdId, at(r.sentAt, 7))).toEqual({
        outcome: 'GUEST_NOT_ELIGIBLE',
      });
      expect((await hold(r.holdId)).status).toBe('AWAITING_HOST');
      expect((await ops(r.holdId)).map((o) => o.kind)).toEqual(['AUTH']);
      expect(await webhook(cap, 'SUCCEEDED', at(r2.sentAt, 8))).toBe('APPLIED');
      expect(await convert(cap, at(r2.sentAt, 8))).toMatchObject({ outcome: 'COMPENSATED' });
      const h2 = await hold(r2.holdId);
      expect(h2).toMatchObject({ status: 'COMPENSATED', converted_trip_id: null });
      expect((await readRequest(other, r2.holdId, at(r2.sentAt, 8)))['request_status']).toBe(
        'COMPENSATED',
      );
    },
    LONG,
  );

  it(
    'exigence d’argent a, côté base : total du devis > autorisation ⇒ LEG_SUM_MISMATCH avant toute transition, aucune capture',
    async () => {
      const T0 = era(idx + 11);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, at(start, 2 * 24 * 60));
      await workerSql(
        'booking_conversion',
        at(r.sentAt, 1),
        'SELECT test_fixture.us223c_shrink_authorization($1)',
        [r.auth],
      );
      expect(await hostCall('accept', w.host, r.holdId, at(r.sentAt, 5))).toEqual({
        outcome: 'LEG_SUM_MISMATCH',
      });
      expect((await hold(r.holdId)).status).toBe('AWAITING_HOST');
      expect((await ops(r.holdId)).map((o) => o.kind)).toEqual(['AUTH']);
    },
    LONG,
  );

  it(
    'ADR-146 §6 bis : capture de l’acceptation jamais confirmée (aucune référence) ⇒ après sa borne + grâce, RELEASED (CAPTURE_UNCONFIRMED), créneau libéré, VOID, alerte P1 ; pas avant',
    async () => {
      const T0 = era(idx + 12);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, at(start, 2 * 24 * 60));
      const a = await hostCall('accept', w.host, r.holdId, at(r.sentAt, 5));
      expect(a['outcome']).toBe('CAPTURE_ORDER');
      const bound = (await hold(r.holdId)).payment_in_flight_until!.toISOString();
      await expireRequests(bound);
      expect((await hold(r.holdId)).status).toBe('PAYMENT_IN_FLIGHT');
      // borne + sweep_grace_s (60 s, 17 §7.2)
      await expireRequests(atSec(bound, 61));
      expect(await hold(r.holdId)).toMatchObject({
        status: 'RELEASED',
        release_reason: 'CAPTURE_UNCONFIRMED',
        occupancy_active: false,
      });
      expect((await commands(r.holdId)).map((x) => x.operation_kind)).toEqual(['VOID']);
      expect(await events(r.holdId)).toContain('booking.request.capture_unconfirmed');
      expect((await readRequest(w, r.holdId, atSec(bound, 61)))['request_status']).toBe(
        'CAPTURE_FAILED',
      );
      // US-213 : parties du hold pour la notification de la capture jamais confirmée
      expect(await notificationParties(r.holdId, atSec(bound, 61))).toEqual({
        guestUserId: w.guest,
        hostUserId: w.host.userId,
        holdKind: 'REQUEST',
        holdStatus: 'RELEASED',
        releaseReason: 'CAPTURE_UNCONFIRMED',
        requestAuthorized: true,
      });
    },
    LONG,
  );

  it(
    'deux sessions : double acceptation ⇒ une seule capture ; acceptation contre refus ⇒ le refus lit INVALID_TRANSITION, aucun VOID',
    async () => {
      const T0 = era(idx + 13);
      const w = await world(c, T0);
      const start = at(T0, 3 * 24 * 60);
      const r = await sentRequest(c, w, T0, start, at(start, 2 * 24 * 60));
      // second monde une minute après : capacités datées autrement (clé unique de la capacité)
      const w2 = await world(c, at(T0, 1));
      const r2 = await sentRequest(c, w2, T0, start, at(start, 2 * 24 * 60));
      const api2 = await connectAs('app_api');
      try {
        const pid2 = await backendPid(api2);
        const race = async (
          host: Host,
          holdId: string,
          second: 'accept' | 'decline',
          when: string,
        ): Promise<{ first: Json; second: Promise<Json> }> =>
          inTx(api, { virtualNow: when, commit: true }, async (tx) => {
            const first = (
              await tx.query<{ r: Json }>(
                'SELECT core.booking_cmd_accept_booking_request($1, $2, $3) AS r',
                [host.hash, host.org, holdId],
              )
            ).rows[0]!.r;
            const sql =
              second === 'accept'
                ? 'SELECT core.booking_cmd_accept_booking_request($1, $2, $3) AS r'
                : 'SELECT core.booking_cmd_decline_booking_request($1, $2, $3) AS r';
            const other = inTx(
              api2,
              { virtualNow: when, commit: true },
              async (tx2) =>
                (await tx2.query<{ r: Json }>(sql, [host.hash, host.org, holdId])).rows[0]!.r,
            );
            await waitUntilBlocked(worker, pid2, 'advisory');
            // promesse emballée : la première transaction valide avant l'issue de la seconde
            return { first, second: other };
          });
        const one = await race(w.host, r.holdId, 'accept', at(r.sentAt, 5));
        expect(one.first['outcome']).toBe('CAPTURE_ORDER');
        const again = await one.second;
        expect(again['outcome']).not.toBe('CAPTURE_ORDER');
        expect((await ops(r.holdId)).filter((o) => o.kind === 'CAPTURE')).toHaveLength(1);
        const two = await race(w2.host, r2.holdId, 'decline', at(r2.sentAt, 5));
        expect(two.first['outcome']).toBe('CAPTURE_ORDER');
        expect(await two.second).toEqual({ outcome: 'INVALID_TRANSITION' });
        expect((await hold(r2.holdId)).status).toBe('PAYMENT_IN_FLIGHT');
        expect(await commands(r2.holdId)).toEqual([]);
      } finally {
        await releaseClient(api2);
      }
    },
    LONG,
  );
});
