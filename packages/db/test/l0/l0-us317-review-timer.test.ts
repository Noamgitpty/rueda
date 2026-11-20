/**
 * US-317 (migration 0170, ADR-190) — publication à l'échéance de la fenêtre et courses à deux
 * connexions (une connexion par client, libérée) :
 *
 * - critère 1 de 19 US-317 : « Given un trip terminé et `review_window_days` = 10, When un seul des
 *   deux a noté à J+9, Then aucun avis n'est publié ; à J+10, l'avis donné est publié » : le
 *   travailleur `review_publisher` ne publie rien avant l'échéance (J+9, puis une seconde avant
 *   J+10), publie à l'échéance exacte, et son rejeu ne publie rien de plus (agrégat incrémenté une
 *   fois) ; l'autre partie ne peut plus noter ;
 * - deux travailleurs sur le même trip échu : le second attend le verrou consultatif du trip
 *   (observé dans `pg_locks`) puis ne publie rien ; une publication, un agrégat ;
 * - les deux parties notent EN MÊME TEMPS à J+3 : le second enregistrement attend le verrou du
 *   premier, puis publie les deux avis au même instant (jamais deux scellés restés en attente
 *   jusqu'à J+10).
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête), au Panama (USD) et au
 * Paraguay (PYG). Trips, sessions et avis VALIDÉS (transactions commitées) : fichier isolé
 * (`vitest.l0.config.ts`) ; les lectures et les essais refusés sont annulés. La durée de la fenêtre
 * est lue dans les DONNÉES de configuration (params.json). Aucun interrupteur n'est écrit.
 */
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import { openSession, setVirtualNow } from '../support/iam.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const SUBMIT = 'SELECT * FROM core.review_cmd_submit($1, $2::uuid, $3, $4::jsonb, $5)';
const READ = 'SELECT * FROM core.review_trip_read($1, $2::uuid)';
const PUBLISH = 'SELECT core.review_worker_publish_due($1) AS n';
const BATCH = 10_000;
const DAY_MS = 86_400_000;
const plusDays = (iso: string, days: number, seconds = 0): string =>
  new Date(Date.parse(iso) + days * DAY_MS + seconds * 1000).toISOString();

interface ParamData {
  readonly key: string;
  readonly values: Readonly<Record<string, number | boolean>>;
}
const PARAMS = (
  JSON.parse(
    readFileSync(
      new URL('../../../../apps/api/src/modules/cfg/data/params.json', import.meta.url),
      'utf8',
    ),
  ) as { params: ParamData[] }
).params;
const windowDays = (country: string): number => {
  const v = PARAMS.find((p) => p.key === 'review_window_days')?.values[country];
  if (typeof v !== 'number') throw new Error(`review_window_days sans valeur (${country})`);
  return v;
};

interface World {
  readonly trip: string;
  readonly vehicle: string;
  readonly guest: Buffer;
  readonly host: Buffer;
  readonly returnedAt: string;
}

/**
 * Trip VALIDÉ, rendu à `returnedAt` (fin effective, ligne RETURNED), sessions du voyageur et de
 * l'hôte ouvertes à cette heure. Années distinctes par appel : aucun créneau partagé.
 */
async function committedWorld(api: Tx, c: CountryCase, year: number): Promise<World> {
  const start = `${year}-03-10T15:00:00.000Z`;
  const end = `${year}-03-13T15:00:00.000Z`;
  const returnedAt = `${year}-03-13T14:00:00.000Z`;
  const guestId = uuid();
  return withTestTransaction(
    api,
    { commit: true, virtualNow: `${year}-02-01T09:00:00.000Z` },
    async (tx) => {
      const t = (
        await tx.query<{ trip_id: string; vehicle_id: string; holder_id: string }>(
          'SELECT * FROM test_fixture.us317_trip($1, NULL, $2::uuid, $3, $4)',
          [c.country, guestId, start, end],
        )
      ).rows[0]!;
      await setVirtualNow(tx, returnedAt);
      await tx.query('SELECT test_fixture.us317_return($1)', [t.trip_id]);
      const g = await openSession(tx, guestId);
      const h = await openSession(tx, t.holder_id);
      return { trip: t.trip_id, vehicle: t.vehicle_id, guest: g.hash, host: h.hash, returnedAt };
    },
  );
}

async function asWorker(tx: Tx): Promise<void> {
  await tx.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', 'review_publisher', true)`,
  );
}

/** Transaction du travailleur à `at` ; validée si `commit`. */
const worker = <T>(w: Tx, at: string, commit: boolean, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withTestTransaction(w, { virtualNow: at, commit }, async (tx) => {
    await asWorker(tx);
    return fn(tx);
  });

const reviewsOf = async (tx: Tx, trip: string): Promise<Row[]> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us317_reviews($1)', [trip])).rows;
const aggregateOf = async (tx: Tx, type: string, id: string): Promise<Row[]> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us317_aggregate($1, $2::uuid)', [type, id]))
    .rows;
const submit = async (tx: Tx, hash: Buffer, trip: string, overall: number): Promise<Row> =>
  (await tx.query<Row>(SUBMIT, [hash, trip, overall, null, null])).rows[0]!;
const read = async (tx: Tx, hash: Buffer, trip: string): Promise<Record<string, unknown>> =>
  (await tx.query<{ view: Record<string, unknown> }>(READ, [hash, trip])).rows[0]!.view;

describe.each(COUNTRIES)(
  'US-317 — publication à l’échéance et courses — $country ($currency)',
  (c) => {
    const days = windowDays(c.country);

    it('critère 1 : un seul avis ⇒ rien de publié à J+9 ni une seconde avant J+10 ; publié à J+10 par le travailleur ; rejeu sans effet ; l’autre partie ne note plus', async () => {
      await withRole('app_api', (api) =>
        withRole('app_worker', async (w) => {
          const world = await committedWorld(api, c, 2041);
          await withTestTransaction(
            api,
            { commit: true, virtualNow: plusDays(world.returnedAt, 1) },
            async (tx) => {
              expect(await submit(tx, world.guest, world.trip, 5)).toMatchObject({
                outcome: 'DONE',
                status: 'SUBMITTED',
              });
            },
          );

          // J+9, puis une seconde avant l'échéance : rien de publié, rien de lisible par l'hôte
          for (const at of [plusDays(world.returnedAt, 9), plusDays(world.returnedAt, days, -1)]) {
            await worker(w, at, false, async (tx) => {
              await tx.query(PUBLISH, [BATCH]);
              expect(await reviewsOf(tx, world.trip), at).toEqual([]);
            });
            await withTestTransaction(api, { virtualNow: at }, async (tx) => {
              expect(await read(tx, world.host, world.trip), at).toMatchObject({
                published: [],
                mine: null,
              });
            });
          }

          // J+10 exactement : l'avis donné est publié (sujets VEHICLE et HOST), à cette heure
          const due = plusDays(world.returnedAt, days);
          await worker(w, due, true, async (tx) => {
            const n = (await tx.query<{ n: number }>(PUBLISH, [BATCH])).rows[0]!.n;
            expect(n).toBeGreaterThanOrEqual(1);
            const pub = await reviewsOf(tx, world.trip);
            expect(pub.map((r) => [r['author_role'], r['subject_type'], r['status']])).toEqual([
              ['GUEST', 'HOST', 'PUBLISHED'],
              ['GUEST', 'VEHICLE', 'PUBLISHED'],
            ]);
            for (const r of pub) expect((r['published_at'] as Date).toISOString()).toBe(due);
          });
          // rejeu (minute suivante) : rien de plus, agrégat incrémenté une fois
          await worker(w, plusDays(due, 0, 60), true, async (tx) => {
            await tx.query(PUBLISH, [BATCH]);
            expect(await reviewsOf(tx, world.trip)).toHaveLength(2);
            expect(await aggregateOf(tx, 'VEHICLE', world.vehicle)).toEqual([
              { review_count: 1, overall_sum: 5, avg_overall_x100: 500 },
            ]);
          });
          // l'hôte lit l'avis publié, et ne note plus (fenêtre close, ni prolongation)
          await withTestTransaction(api, { virtualNow: plusDays(due, 0, 120) }, async (tx) => {
            const v = await read(tx, world.host, world.trip);
            expect(v['published']).toEqual([
              expect.objectContaining({ authorRole: 'GUEST', authorName: 'Ana', overall: 5 }),
            ]);
            expect(v['canSubmit']).toBe(false);
            expect((await submit(tx, world.host, world.trip, 4))['outcome']).toBe(
              'REVIEW_WINDOW_CLOSED',
            );
          });
          // hors du travailleur review_publisher : refus
          await withTestTransaction(w, { virtualNow: due }, async (tx) => {
            await tx.query(
              `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                    pg_catalog.set_config('app.worker_name', 'privacy_request', true)`,
            );
            await expect(tx.query(PUBLISH, [BATCH])).rejects.toMatchObject({ code: '42501' });
          });
        }),
      );
    });

    it('deux travailleurs, même trip échu : le second attend le verrou du trip puis ne publie rien ; une publication, un agrégat', async () => {
      await withRole('app_api', (api) =>
        withRole('app_worker', (observer) =>
          withRole('app_worker', (first) =>
            withRole('app_worker', async (second) => {
              const world = await committedWorld(api, c, 2042);
              await withTestTransaction(
                api,
                { commit: true, virtualNow: plusDays(world.returnedAt, 2) },
                async (tx) => {
                  await submit(tx, world.guest, world.trip, 4);
                },
              );
              const due = plusDays(world.returnedAt, days, 30);
              await first.query('BEGIN');
              await second.query('BEGIN');
              try {
                for (const tx of [first, second]) {
                  await setVirtualNow(tx, due);
                  await asWorker(tx);
                }
                await first.query(PUBLISH, [BATCH]);
                expect(await reviewsOf(first, world.trip)).toHaveLength(2);
                const pid = await backendPid(second);
                const pending = second.query(PUBLISH, [BATCH]);
                await waitUntilBlocked(observer, pid, 'advisory');
                await first.query('COMMIT');
                await pending;
                expect(await reviewsOf(second, world.trip)).toHaveLength(2);
                expect(await aggregateOf(second, 'VEHICLE', world.vehicle)).toEqual([
                  { review_count: 1, overall_sum: 4, avg_overall_x100: 400 },
                ]);
              } finally {
                await first.query('ROLLBACK').catch(() => undefined);
                await second.query('ROLLBACK');
              }
            }),
          ),
        ),
      );
    });

    it('les deux parties notent en même temps à J+3 : le second enregistrement attend le verrou du premier et publie les deux avis au même instant', async () => {
      await withRole('app_api', (setup) =>
        withRole('app_api', (first) =>
          withRole('app_api', (second) =>
            withRole('app_worker', async (observer) => {
              const world = await committedWorld(setup, c, 2043);
              const at = plusDays(world.returnedAt, 3);
              await first.query('BEGIN');
              await second.query('BEGIN');
              try {
                await setVirtualNow(first, at);
                await setVirtualNow(second, plusDays(at, 0, 1));
                expect(await submit(first, world.guest, world.trip, 5)).toMatchObject({
                  status: 'SUBMITTED',
                });
                const pid = await backendPid(second);
                const pending = submit(second, world.host, world.trip, 5);
                await waitUntilBlocked(observer, pid, 'advisory');
                await first.query('COMMIT');
                const r = await pending;
                expect(r).toMatchObject({ outcome: 'DONE', status: 'PUBLISHED' });
                const pub = await reviewsOf(second, world.trip);
                expect(pub).toHaveLength(3);
                expect(new Set(pub.map((x) => (x['published_at'] as Date).toISOString()))).toEqual(
                  new Set([(r['published_at'] as Date).toISOString()]),
                );
              } finally {
                await first.query('ROLLBACK').catch(() => undefined);
                await second.query('ROLLBACK');
              }
            }),
          ),
        ),
      );
    });
  },
);
