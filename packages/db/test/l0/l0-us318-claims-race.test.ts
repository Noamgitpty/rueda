/**
 * US-318 — courses à deux connexions sur les sinistres entre particuliers (migration 0178,
 * ADR-198 ; fixtures 9906, 9909, 9300 ; revue qa n° 4). Rôles de PRODUCTION seulement (`withRole`,
 * assertion L0-05), au Panama (USD) et au Paraguay (PYG sans décimale).
 *
 * Chaque course : le pid de la seconde session est lu AVANT son appel ; `lock_timeout` et
 * `statement_timeout` bornés ; l'attente est observée par une troisième session (`pg_locks`, puis
 * `pg_blocking_pids` qui doit nommer la première) ; `finally` annule toute transaction restée
 * ouverte. Attendus tirés de 19 US-318 et de 08 (un seul débit séparé par refacturation, une pièce
 * par refacturation, aucun dossier de vol pour un véhicule rendu), jamais du code testé. Données du
 * monde VALIDÉES ; aucun interrupteur écrit.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { SubjectKeyStore } from '../../src/audit/index.ts';
import { FakeKeyWrapper, withRole, withTestTransaction } from '../../src/testing/index.ts';
import { setActor } from '../support/audit.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import { openSession, setVirtualNow } from '../support/iam.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;
const uuid = (): string => randomUUID();
const HOUR = 3_600_000;
const plus = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

/** Années virtuelles propres au fichier (2059). */
const START = '2059-03-03T10:00:00.000Z';
const END = '2059-03-06T10:00:00.000Z';
const RACE_AT = plus(END, 2 * HOUR);
/** Saisie de l'hôte (unités mineures de la devise du pays). */
const AMOUNT: Readonly<Record<string, string>> = { USD: '1230', PYG: '25010' };
const RENT: Readonly<Record<string, string>> = { USD: '30000', PYG: '2000000' };

const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                              $7, $8::bigint, $9, $10::timestamptz)`;
const DECLARE = `SELECT outcome, charge_id::text AS charge_id
  FROM core.claim_cmd_declare_traffic_charge($1, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::bigint,
                                             $7::uuid, false)`;
const EXECUTE = 'SELECT outcome, code FROM core.claim_cmd_execute_traffic_charge($1, $2)';

async function begin(client: Tx): Promise<void> {
  await client.query('BEGIN');
  await setVirtualNow(client, RACE_AT);
  await client.query(`SET LOCAL lock_timeout = '15s'`);
  await client.query(`SET LOCAL statement_timeout = '30s'`);
}

async function worker(client: Tx): Promise<void> {
  await begin(client);
  await setSessionContext(client, { kind: 'WORKER', workerName: 'payment_command' });
}

/** La session `pid` attend un verrou tenu par `holder` (pg_locks, puis pg_blocking_pids). */
async function blockedBy(observer: Tx, pid: number, holder: number): Promise<void> {
  await waitUntilBlocked(observer, pid, 'transactionid');
  const r = await observer.query<{ b: number[] }>('SELECT pg_catalog.pg_blocking_pids($1) AS b', [
    pid,
  ]);
  expect(r.rows[0]?.b).toContain(holder);
}

async function rollbackQuietly(client: Tx): Promise<void> {
  await client.query('ROLLBACK').catch(() => undefined);
}

interface Setup {
  /** Session du titulaire du trip rendu (jeton). */
  readonly host: Buffer;
  readonly trip: string;
  /** Pièce libre de la série TRAFFIC (course de deux déclarations). */
  readonly freeFile: string;
  /** Refacturation PENDING validée (course d'exécution). */
  readonly charge: string;
  /** Trips OVERDUE à l'étape T24H (courses ouverture contre retour, dans les deux ordres). */
  readonly overdueA: string;
  readonly overdueB: string;
}

async function world(
  tx: Tx,
  c: CountryCase,
  status: string,
): Promise<{ trip: string; holder: string }> {
  const trip = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    uuid(),
    uuid(),
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    START,
    END,
  ]);
  await tx.query('SELECT test_fixture.us309_set_status($1, $2)', [trip, status]);
  const holder = (
    await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
  ).rows[0]!.h;
  return { trip, holder };
}

async function photo(tx: Tx, who: Buffer, trip: string, slot: string): Promise<string> {
  const cap = (await tx.query<Row>(CAPTURE, [who, trip, 'TRAFFIC', slot])).rows[0]!;
  expect(cap['outcome'], slot).toBe('DONE');
  const body = randomBytes(64); // octets distincts : empreinte unique (0176)
  const fileId = uuid();
  const r = (
    await tx.query<Row>(ADD, [
      who,
      trip,
      'TRAFFIC',
      cap['capture_id'],
      slot,
      fileId,
      'image/jpeg',
      body.length,
      createHash('sha256').update(body).digest(),
      null,
    ])
  ).rows[0]!;
  expect(r['outcome'], slot).toBe('DONE');
  return fileId;
}

async function setup(c: CountryCase): Promise<Setup> {
  return withRole('app_api', (api) =>
    withTestTransaction(api, { virtualNow: plus(END, -HOUR), commit: true }, async (tx) => {
      const w = await world(tx, c, 'IN_PROGRESS');
      await setVirtualNow(tx, END);
      await tx.query('SELECT test_fixture.us309_returned($1)', [w.trip]);
      await tx.query('SELECT test_fixture.us309_card_rent($1, $2)', [w.trip, RENT[c.currency]]);
      const a = await world(tx, c, 'IN_PROGRESS');
      await tx.query('SELECT test_fixture.us318_overdue_t24h($1)', [a.trip]);
      const b = await world(tx, c, 'IN_PROGRESS');
      await tx.query('SELECT test_fixture.us318_overdue_t24h($1)', [b.trip]);
      await setVirtualNow(tx, plus(RACE_AT, -60_000));
      const keys = new SubjectKeyStore(new FakeKeyWrapper());
      await setActor(tx, { kind: 'GUEST', actorId: w.holder });
      const k = await keys.dekFor(tx, { type: 'USER', id: w.holder }, 'create');
      expect(k.status).toBe('OK');
      const host = (await openSession(tx, w.holder)).hash;
      const used = await photo(tx, host, w.trip, 'DAMAGE_01');
      const freeFile = await photo(tx, host, w.trip, 'DAMAGE_02');
      const d = (
        await tx.query<Row>(DECLARE, [
          host,
          uuid(),
          w.trip,
          'TOLL',
          START,
          AMOUNT[c.currency],
          used,
        ])
      ).rows[0]!;
      expect(d['outcome']).toBe('DECLARED');
      return {
        host,
        trip: w.trip,
        freeFile,
        charge: String(d['charge_id']),
        overdueA: a.trip,
        overdueB: b.trip,
      };
    }),
  );
}

describe.each(COUNTRIES)('US-318 — courses à deux connexions ($country, $currency)', (c) => {
  it('même refacturation exécutée par deux travailleurs : la seconde attend le verrou du trip puis rend DONE sans second débit ; deux déclarations avec la même pièce : la seconde attend la série puis TRAFFIC_EVIDENCE_REQUIRED', async () => {
    const s = await setup(c);
    await withRole('app_worker', (observer) =>
      withRole('app_worker', (one) =>
        withRole('app_worker', async (two) => {
          try {
            await worker(one);
            expect((await one.query<Row>(EXECUTE, [s.charge, uuid()])).rows[0]).toEqual({
              outcome: 'DONE',
              code: null,
            });
            const pid = await backendPid(two);
            const holder = await backendPid(one);
            await worker(two);
            const pending = two.query<Row>(EXECUTE, [s.charge, uuid()]);
            await blockedBy(observer, pid, holder);
            await one.query('COMMIT');
            expect((await pending).rows[0]).toEqual({ outcome: 'DONE', code: null });
            const charges = await two.query(
              'SELECT * FROM test_fixture.us318_post_trip_charges($1)',
              [s.charge],
            );
            expect(charges.rows).toHaveLength(1);
            await two.query('ROLLBACK');
          } finally {
            await rollbackQuietly(one);
            await rollbackQuietly(two);
          }
        }),
      ),
    );
    await withRole('app_worker', (observer) =>
      withRole('app_api', (one) =>
        withRole('app_api', async (two) => {
          try {
            await begin(one);
            const first = (
              await one.query<Row>(DECLARE, [
                s.host,
                uuid(),
                s.trip,
                'FINE',
                START,
                AMOUNT[c.currency],
                s.freeFile,
              ])
            ).rows[0]!;
            expect(first['outcome']).toBe('DECLARED');
            const pid = await backendPid(two);
            const holder = await backendPid(one);
            await begin(two);
            const pending = two.query<Row>(DECLARE, [
              s.host,
              uuid(),
              s.trip,
              'FINE',
              END,
              AMOUNT[c.currency],
              s.freeFile,
            ]);
            await blockedBy(observer, pid, holder);
            await one.query('COMMIT');
            expect((await pending).rows[0]).toMatchObject({
              outcome: 'TRAFFIC_EVIDENCE_REQUIRED',
              charge_id: null,
            });
            await two.query('ROLLBACK');
          } finally {
            await rollbackQuietly(one);
            await rollbackQuietly(two);
          }
        }),
      ),
    );
  });

  it('ouverture du dossier de vol contre retour du véhicule : retour d’abord ⇒ l’ouverture attend le verrou du trip puis NOT_DUE (aucun dossier) ; ouverture d’abord ⇒ le retour attend, puis le dossier est à clore (CLOSE, CLOSED)', async () => {
    const s = await setup(c);
    await withRole('app_worker', (observer) =>
      withRole('app_worker', (one) =>
        withRole('app_worker', async (two) => {
          // (1) retour d'abord : le trip passe COMPLETED dans la transaction de `one`
          try {
            await worker(one);
            await one.query('SELECT test_fixture.us309_returned($1)', [s.overdueA]);
            const pid = await backendPid(two);
            const holder = await backendPid(one);
            await worker(two);
            const pending = two.query<{ r: string }>(
              'SELECT core.claim_cmd_open_theft_case($1) AS r',
              [s.overdueA],
            );
            await blockedBy(observer, pid, holder);
            await one.query('COMMIT');
            expect((await pending).rows[0]!.r).toBe('NOT_DUE');
            expect(
              (await two.query('SELECT * FROM test_fixture.us318_theft_case($1)', [s.overdueA]))
                .rows,
            ).toEqual([]);
            await two.query('ROLLBACK');
          } finally {
            await rollbackQuietly(one);
            await rollbackQuietly(two);
          }
          // (2) ouverture d'abord : le retour attend le verrou du trip, puis le dossier est clos
          try {
            await worker(one);
            expect(
              (
                await one.query<{ r: string }>('SELECT core.claim_cmd_open_theft_case($1) AS r', [
                  s.overdueB,
                ])
              ).rows[0]!.r,
            ).toBe('OPENED');
            const pid = await backendPid(two);
            const holder = await backendPid(one);
            await worker(two);
            const pending = two.query('SELECT test_fixture.us309_returned($1)', [s.overdueB]);
            await blockedBy(observer, pid, holder);
            await one.query('COMMIT');
            await pending;
            await two.query('COMMIT');
            await worker(two);
            // lu par objet (revue qa delta) : le dossier ouvert reste à clore, le trip est rendu
            expect(
              (
                await two.query<Row>('SELECT * FROM test_fixture.us318_theft_case($1)', [
                  s.overdueB,
                ])
              ).rows[0],
            ).toMatchObject({ status: 'THEFT_INVESTIGATION' });
            expect(
              (
                await two.query<{ r: string }>('SELECT core.claim_cmd_close_theft_case($1) AS r', [
                  s.overdueB,
                ])
              ).rows[0]!.r,
            ).toBe('CLOSED');
            await two.query('ROLLBACK');
          } finally {
            await rollbackQuietly(one);
            await rollbackQuietly(two);
          }
        }),
      ),
    );
  });
});
