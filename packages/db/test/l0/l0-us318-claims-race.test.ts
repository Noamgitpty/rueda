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
import { elevated, staff } from '../support/claims.ts';
import type { Staff } from '../support/claims.ts';
import { openSession, setVirtualNow } from '../support/iam.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;
const uuid = (): string => randomUUID();
const HOUR = 3_600_000;
const plus = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

/** Années virtuelles propres au fichier (2059). */
const START = '2059-03-03T10:00:00.000Z';
const END = '2059-03-06T10:00:00.000Z';
/**
 * Courses à fin effective + 50 h : après l'échéance du voyageur (déclaration à fin + 1 h,
 * `traffic_guest_response_h` = 48 h, 08 BR-TT-02 ; 0181) ; la refacturation est due sans réponse.
 */
const DECLARED_AT = plus(END, HOUR);
const RACE_AT = plus(END, 50 * HOUR);
/** Saisie de l'hôte (unités mineures de la devise du pays). */
const AMOUNT: Readonly<Record<string, string>> = { USD: '1230', PYG: '25010' };
const RENT: Readonly<Record<string, string>> = { USD: '30000', PYG: '2000000' };

const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                              $7, $8::bigint, $9, $10::timestamptz)`;
const DECLARE = `SELECT outcome, charge_id::text AS charge_id
  FROM core.claim_cmd_declare_traffic_charge($1, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::bigint,
                                             $7::uuid, false, $8)`;
const EXECUTE = 'SELECT outcome, code FROM core.claim_cmd_execute_traffic_charge($1, $2)';
const ACCEPT = 'SELECT core.claim_cmd_accept_traffic_charge($1, $2::uuid) AS r';
const DISPUTE = 'SELECT core.claim_cmd_dispute_traffic_charge($1, $2::uuid, $3, $4::uuid[]) AS r';
const DECIDE = `SELECT outcome FROM core.support_staff_decide_traffic_charge($1, $2::uuid, $3::uuid, $4,
                                                                         $5)`;
/** Échéance du voyageur : déclaration (fin + 1 h) + 48 h (08 BR-TT-02 ; 0181). */
const GUEST_DUE = plus(END, 49 * HOUR);
const REASON = 'Je ne conduisais pas sur cette route ce jour-là, voir le relevé.';
const RATIONALE =
  'Avis officiel relu : plaque différente du véhicule du trip, refacturation rejetée.';

async function begin(client: Tx, at: string = RACE_AT): Promise<void> {
  await client.query('BEGIN');
  await setVirtualNow(client, at);
  await client.query(`SET LOCAL lock_timeout = '15s'`);
  await client.query(`SET LOCAL statement_timeout = '30s'`);
}

async function worker(client: Tx, at: string = RACE_AT): Promise<void> {
  await begin(client, at);
  await setSessionContext(client, { kind: 'WORKER', workerName: 'payment_command' });
}

/** La session `pid` attend un verrou tenu par `holder` (pg_locks, puis pg_blocking_pids). */
async function blockedBy(
  observer: Tx,
  pid: number,
  holder: number,
  locktype: 'advisory' | 'transactionid' = 'transactionid',
): Promise<void> {
  await waitUntilBlocked(observer, pid, locktype);
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
  /** Pièces libres de la série TRAFFIC (courses de deux déclarations). */
  readonly freeFile: string;
  readonly freeA: string;
  readonly freeB: string;
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
      await setVirtualNow(tx, DECLARED_AT);
      const keys = new SubjectKeyStore(new FakeKeyWrapper());
      await setActor(tx, { kind: 'GUEST', actorId: w.holder });
      const k = await keys.dekFor(tx, { type: 'USER', id: w.holder }, 'create');
      expect(k.status).toBe('OK');
      const host = (await openSession(tx, w.holder)).hash;
      const used = await photo(tx, host, w.trip, 'DAMAGE_01');
      const freeFile = await photo(tx, host, w.trip, 'DAMAGE_02');
      const freeA = await photo(tx, host, w.trip, 'DAMAGE_03');
      const freeB = await photo(tx, host, w.trip, 'DAMAGE_04');
      const d = (
        await tx.query<Row>(DECLARE, [
          host,
          uuid(),
          w.trip,
          'TOLL',
          START,
          AMOUNT[c.currency],
          used,
          `RT-${uuid().slice(0, 8)}`,
        ])
      ).rows[0]!;
      expect(d['outcome']).toBe('DECLARED');
      // session du titulaire ouverte à l'heure des courses (celle de la déclaration aurait expiré)
      await setVirtualNow(tx, plus(RACE_AT, -60_000));
      const raceHost = (await openSession(tx, w.holder)).hash;
      return {
        host: raceHost,
        trip: w.trip,
        freeFile,
        freeA,
        freeB,
        charge: String(d['charge_id']),
        overdueA: a.trip,
        overdueB: b.trip,
      };
    }),
  );
}

interface Responses {
  /** Session du voyageur ouverte à l'échéance − 60 s. */
  readonly guest: Buffer;
  readonly ops: Staff;
  readonly accept: string;
  readonly execute: string;
  readonly decide: string;
}

/** Trip rendu à END, loyer par carte, trois refacturations déclarées à fin + 1 h (validées). */
async function responses(c: CountryCase): Promise<Responses> {
  return withRole('app_api', (api) =>
    withTestTransaction(api, { virtualNow: plus(END, -HOUR), commit: true }, async (tx) => {
      const ops = await staff(tx, 'OPS_AGENT', [c.country]);
      const trip = uuid();
      const guestId = uuid();
      await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
        trip,
        guestId,
        uuid(),
        uuid(),
        c.country,
        c.currency,
        c.timezone,
        START,
        END,
      ]);
      await tx.query('SELECT test_fixture.us309_set_status($1, $2)', [trip, 'IN_PROGRESS']);
      await setVirtualNow(tx, END);
      await tx.query('SELECT test_fixture.us309_returned($1)', [trip]);
      await tx.query('SELECT test_fixture.us309_card_rent($1, $2)', [trip, RENT[c.currency]]);
      const holder = (
        await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
      ).rows[0]!.h;
      await setVirtualNow(tx, DECLARED_AT);
      const keys = new SubjectKeyStore(new FakeKeyWrapper());
      await setActor(tx, { kind: 'GUEST', actorId: holder });
      expect((await keys.dekFor(tx, { type: 'USER', id: holder }, 'create')).status).toBe('OK');
      const host = (await openSession(tx, holder)).hash;
      const ids: string[] = [];
      for (const slot of ['DAMAGE_01', 'DAMAGE_02', 'DAMAGE_03']) {
        const file = await photo(tx, host, trip, slot);
        const d = (
          await tx.query<Row>(DECLARE, [
            host,
            uuid(),
            trip,
            'FINE',
            START,
            AMOUNT[c.currency],
            file,
            `PV-${uuid().slice(0, 8)}`,
          ])
        ).rows[0]!;
        expect(d['outcome']).toBe('DECLARED');
        ids.push(String(d['charge_id']));
      }
      await setVirtualNow(tx, plus(GUEST_DUE, -60_000));
      await setActor(tx, { kind: 'NONE' });
      const guest = (await openSession(tx, guestId)).hash;
      return { guest, ops, accept: ids[0]!, execute: ids[1]!, decide: ids[2]! };
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
                `PV-${uuid().slice(0, 8)}`,
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
              `PV-${uuid().slice(0, 8)}`,
            ]);
            // déclarations d'un même trip sérialisées par le verrou consultatif du trip (0181)
            await blockedBy(observer, pid, holder, 'advisory');
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

  it('F-L3-SIN-01 (0181) : deux déclarations du MÊME PV (même référence, deux photos distinctes) en même temps : la seconde attend le verrou du trip puis TRAFFIC_DUPLICATE ; une seule refacturation, donc un seul débit possible', async () => {
    const s = await setup(c);
    const ref = `PV ${uuid().slice(0, 8)}`;
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
                s.freeA,
                ref,
              ])
            ).rows[0]!;
            expect(first['outcome']).toBe('DECLARED');
            const pid = await backendPid(two);
            const holder = await backendPid(one);
            await begin(two);
            // même PV : heure + 1 s, montant + 1, autre nature, référence saisie autrement
            const pending = two.query<Row>(DECLARE, [
              s.host,
              uuid(),
              s.trip,
              'TOLL',
              plus(START, 1000),
              String(BigInt(AMOUNT[c.currency]!) + 1n),
              s.freeB,
              ref.toLowerCase().replace(' ', '-'),
            ]);
            await blockedBy(observer, pid, holder, 'advisory');
            await one.query('COMMIT');
            const second = (await pending).rows[0]!;
            expect(second).toMatchObject({ outcome: 'TRAFFIC_DUPLICATE', charge_id: null });
            const rows = (
              await two.query<Row>('SELECT * FROM test_fixture.us318s_charges($1)', [s.trip])
            ).rows.filter((r) => r['reference_key'] === ref.replace(' ', '').toUpperCase());
            expect(rows).toHaveLength(1);
            expect(rows[0]!['id']).toBe(first['charge_id']);
            await two.query('ROLLBACK');
          } finally {
            await rollbackQuietly(one);
            await rollbackQuietly(two);
          }
        }),
      ),
    );
  });

  // réponses du voyageur et décision de l'ops contre l'exécution (0181, revue qa n° 3)
  it('F-L3-SIN-02 (0181) : paiement du voyageur à l’échéance − 1 ms contre exécution à l’échéance — l’exécution tient le verrou du trip puis est annulée ⇒ le paiement passe ACCEPTED ; contestation tenue contre exécution ⇒ NOT_DUE TRAFFIC_DISPUTED, aucun débit', async () => {
    const r = await responses(c);
    await withRole('app_worker', (observer) =>
      withRole('app_worker', (one) =>
        withRole('app_api', async (two) => {
          try {
            await worker(one, GUEST_DUE);
            expect((await one.query<Row>(EXECUTE, [r.accept, uuid()])).rows[0]).toEqual({
              outcome: 'DONE',
              code: null,
            });
            const pid = await backendPid(two);
            const holder = await backendPid(one);
            await begin(two, plus(GUEST_DUE, -1));
            const pending = two.query<{ r: string }>(ACCEPT, [r.guest, r.accept]);
            await blockedBy(observer, pid, holder);
            await one.query('ROLLBACK');
            expect((await pending).rows[0]!.r).toBe('ACCEPTED');
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
        withRole('app_worker', async (two) => {
          try {
            await begin(one, plus(GUEST_DUE, -1));
            expect(
              (await one.query<{ r: string }>(DISPUTE, [r.guest, r.execute, REASON, []])).rows[0]!
                .r,
            ).toBe('DISPUTED');
            const pid = await backendPid(two);
            const holder = await backendPid(one);
            await worker(two, GUEST_DUE);
            const pending = two.query<Row>(EXECUTE, [r.execute, uuid()]);
            await blockedBy(observer, pid, holder);
            await one.query('COMMIT');
            expect((await pending).rows[0]).toEqual({
              outcome: 'NOT_DUE',
              code: 'TRAFFIC_DISPUTED',
            });
            expect(
              (
                await two.query('SELECT * FROM test_fixture.us318_post_trip_charges($1)', [
                  r.execute,
                ])
              ).rows,
            ).toEqual([]);
            await two.query('ROLLBACK');
          } finally {
            await rollbackQuietly(one);
            await rollbackQuietly(two);
          }
        }),
      ),
    );
  });

  it('F-L3-SIN-02 (0181) : décision de l’ops contre contestation tenue — la décision attend le verrou du trip, puis voit la contestation validée ⇒ DECIDED (rejet) ; sans la contestation, elle aurait rendu TRAFFIC_NOT_DISPUTED', async () => {
    const r = await responses(c);
    await withRole('app_worker', (observer) =>
      withRole('app_api', (one) =>
        withRole('app_api', async (two) => {
          try {
            await begin(one, plus(GUEST_DUE, -1));
            expect(
              (await one.query<{ r: string }>(DISPUTE, [r.guest, r.decide, REASON, []])).rows[0]!.r,
            ).toBe('DISPUTED');
            const pid = await backendPid(two);
            const holder = await backendPid(one);
            await begin(two, plus(GUEST_DUE, HOUR));
            const hash = await elevated(two, r.ops);
            const pending = two.query<Row>(DECIDE, [hash, uuid(), r.decide, 'REJECT', RATIONALE]);
            await blockedBy(observer, pid, holder);
            await one.query('COMMIT');
            expect((await pending).rows[0]).toEqual({ outcome: 'DECIDED' });
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
