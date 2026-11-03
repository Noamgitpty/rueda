/**
 * US-008 — outbox transactionnelle, consommation idempotente et lettres mortes, sous les rôles de
 * production (CLAUDE.md point 6 ; assertion L0-05 en tête de chaque test par withRole / connectAs).
 *
 * Attendus (17 §4.2, 19 US-008) :
 * - « Given une transaction annulée, When elle publie un événement, Then aucun événement n'est
 *   émis » : l'événement s'écrit dans la transaction du changement d'état ; ROLLBACK ⇒ le relais
 *   ne le voit jamais ;
 * - relais `WHERE published_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED` : deux relais
 *   simultanés se partagent les événements sans doublon ; published_at posé une fois ;
 * - « Given un événement rejoué, When il est reçu, Then inbox_receipt empêche le double
 *   traitement » : PK (consumer, event_id) ;
 * - « après N échecs, il passe en dead_letter » : N = 5 tentatives, attente exponentielle ;
 * - cloisonnement : un travailleur ne voit que sa file et ses reçus ; un producteur n'a ni lecture
 *   ni modification ; sans contexte, rien (fail-closed).
 * Chaque cas tourne en USD (PA) et en PYG sans décimale (PY).
 */
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import {
  claimJobs,
  enqueue,
  EVENT_COUNTRIES,
  failJob,
  failure,
  insertEvent,
  outboxTx,
  SPEC_MAX_ATTEMPTS,
  uuid,
  workerName,
} from '../support/outbox.ts';

const RELAY = 'outbox_relay';
const T0 = '2031-07-01T08:00:00.000Z';
const at = (base: string, seconds: number): string =>
  new Date(Date.parse(base) + seconds * 1000).toISOString();

describe.each(EVENT_COUNTRIES)('outbox US-008 — $country ($currency)', (country) => {
  it('transaction annulée : aucun événement émis ; transaction validée : visible du relais', async () => {
    await withRole('app_api', async (api) => {
      const rolledBack = await outboxTx(api, { actor: 'GUEST' }, (tx) => insertEvent(tx, country));
      const committed = await outboxTx(api, { actor: 'GUEST', commit: true }, (tx) =>
        insertEvent(tx, country),
      );
      await withRole('app_worker', async (worker) => {
        await outboxTx(worker, { worker: RELAY }, async (tx) => {
          const { rows } = await tx.query<{ id: string; published_at: Date | null }>(
            `SELECT id, published_at FROM core.outbox_outbox_event WHERE id = ANY ($1::uuid[])`,
            [[rolledBack.id, committed.id]],
          );
          expect(rows).toEqual([{ id: committed.id, published_at: null }]);
          // le relais réclame l'événement validé, jamais l'annulé
          const claimed = await tx.query<{ id: string }>(
            `SELECT id FROM core.outbox_relay_claim(1000)`,
          );
          const ids = claimed.rows.map((r) => r.id);
          expect(ids).toContain(committed.id);
          expect(ids).not.toContain(rolledBack.id);
        });
      });
    });
  });

  it('enveloppe 17 §4.1 : occurred_at = heure de la base, UUID fourni conservé, pays et montant en unités mineures', async () => {
    await withRole('app_worker', async (client) => {
      const event = await outboxTx(
        client,
        { worker: 'booking_conversion', virtualNow: T0, commit: true },
        (tx) => insertEvent(tx, country),
      );
      await outboxTx(client, { worker: RELAY }, async (tx) => {
        const { rows } = await tx.query<{
          occurred_at: Date;
          created_at: Date;
          country_code: string;
          payload: { currency: string; amount_minor: string };
          attempts: number;
        }>(
          `SELECT occurred_at, created_at, country_code, payload, attempts
             FROM core.outbox_outbox_event WHERE id = $1`,
          [event.id],
        );
        expect(rows[0]?.occurred_at.toISOString()).toBe(T0);
        expect(rows[0]?.created_at.toISOString()).toBe(T0);
        expect(rows[0]?.country_code).toBe(country.country);
        expect(rows[0]?.payload).toMatchObject({
          currency: country.currency,
          amount_minor: country.amountMinor,
        });
        expect(rows[0]?.attempts).toBe(0);
      });
    });
  });

  it('producteur : ni lecture, ni modification, ni choix de published_at / occurred_at (42501)', async () => {
    await withRole('app_api', async (api) => {
      for (const sql of [
        'SELECT 1 FROM core.outbox_outbox_event LIMIT 1',
        `UPDATE core.outbox_outbox_event SET published_at = NULL`,
        'DELETE FROM core.outbox_outbox_event',
        `INSERT INTO core.outbox_outbox_event (type, schema_version, aggregate_type, aggregate_id,
           aggregate_version, actor_role, correlation_id, payload, published_at)
         VALUES ('booking.trip.booked', 1, 'trip', gen_random_uuid(), 1, 'SYSTEM', gen_random_uuid(), '{}', '2031-01-01')`,
        `INSERT INTO core.outbox_outbox_event (type, schema_version, aggregate_type, aggregate_id,
           aggregate_version, actor_role, correlation_id, payload, occurred_at)
         VALUES ('booking.trip.booked', 1, 'trip', gen_random_uuid(), 1, 'SYSTEM', gen_random_uuid(), '{}', '2031-01-01')`,
        'SELECT 1 FROM core.outbox_inbox_receipt LIMIT 1',
        'SELECT 1 FROM core.outbox_scheduled_job LIMIT 1',
        "SELECT core.outbox_claim_jobs(1, interval '1 minute')",
        'SELECT core.outbox_relay_claim(1)',
      ]) {
        await outboxTx(api, { actor: 'HOST' }, async (tx) => {
          await expect(tx.query(sql), sql).rejects.toMatchObject({ code: '42501' });
        });
      }
    });
  });

  it('sans contexte de session : écriture refusée par la RLS (fail-closed)', async () => {
    await withRole('app_api', async (api) => {
      await outboxTx(api, {}, async (tx) => {
        await expect(insertEvent(tx, country)).rejects.toMatchObject({ code: '42501' });
      });
    });
    await withRole('app_worker', async (worker) => {
      await outboxTx(worker, {}, async (tx) => {
        await expect(insertEvent(tx, country)).rejects.toMatchObject({ code: '42501' });
      });
      await outboxTx(worker, {}, async (tx) => {
        const { rows } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM core.outbox_outbox_event',
        );
        expect(rows[0]?.n).toBe(0);
      });
      // un travailleur qui n'est pas le relais ne lit pas l'outbox
      await outboxTx(worker, { worker: 'booking_conversion' }, async (tx) => {
        const { rows } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM core.outbox_outbox_event',
        );
        expect(rows[0]?.n).toBe(0);
      });
    });
  });

  it('relais : deux relais simultanés (SKIP LOCKED) ne réclament jamais le même événement ; publié une fois', async () => {
    const events = await withRole('app_worker', async (client) =>
      outboxTx(client, { worker: 'booking_conversion', commit: true }, async (tx) => {
        const out = [];
        for (let i = 0; i < 6; i++) out.push(await insertEvent(tx, country));
        return out;
      }),
    );
    const ids = events.map((e) => e.id);
    const a = await connectAs('app_worker');
    const b = await connectAs('app_worker');
    try {
      await a.query('BEGIN');
      await a.query(
        `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                pg_catalog.set_config('app.worker_name', $1, true)`,
        [RELAY],
      );
      const claimedA = await a.query<{ id: string }>(
        'SELECT id FROM core.outbox_relay_claim(1000)',
      );
      const mineA = claimedA.rows.map((r) => r.id).filter((id) => ids.includes(id));
      expect(mineA.length).toBeGreaterThan(0);

      // B ne bloque pas et ne voit aucun des événements verrouillés par A
      const claimedB = await outboxTx(b, { worker: RELAY }, (tx) =>
        tx.query<{ id: string }>('SELECT id FROM core.outbox_relay_claim(1000)'),
      );
      const mineB = claimedB.rows.map((r) => r.id).filter((id) => ids.includes(id));
      expect(mineB.filter((id) => mineA.includes(id))).toEqual([]);

      const marked = await a.query<{ n: number }>(
        'SELECT core.outbox_mark_published($1::uuid[]) AS n',
        [mineA],
      );
      expect(marked.rows[0]?.n).toBe(mineA.length);
      await a.query('COMMIT');

      // seconde publication : 0 ligne (published_at posé une fois, politique USING published_at IS NULL)
      await outboxTx(b, { worker: RELAY }, async (tx) => {
        const again = await tx.query<{ n: number }>(
          'SELECT core.outbox_mark_published($1::uuid[]) AS n',
          [mineA],
        );
        expect(again.rows[0]?.n).toBe(0);
        const reset = await tx.query(
          'UPDATE core.outbox_outbox_event SET published_at = NULL WHERE id = ANY ($1::uuid[])',
          [mineA],
        );
        expect(reset.rowCount).toBe(0);
        const { rows } = await tx.query<{ attempts: number; published: boolean }>(
          `SELECT attempts, published_at IS NOT NULL AS published
             FROM core.outbox_outbox_event WHERE id = ANY ($1::uuid[])`,
          [mineA],
        );
        expect(rows.every((r) => r.published && r.attempts === 1)).toBe(true);
      });
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      await releaseClient(a);
      await releaseClient(b);
    }
  });

  it('événement rejoué : inbox_receipt empêche le double traitement (même consommateur), pas un autre consommateur', async () => {
    const consumer = workerName('ntf_test');
    const other = workerName('rpt_test');
    const eventId = uuid();
    await withRole('app_worker', async (client) => {
      // première livraison
      await outboxTx(client, { worker: RELAY, commit: true }, async (tx) => {
        expect(await enqueue(tx, consumer, { eventId })).toBe(true);
        // fan-out idempotent : même (travailleur, clé) vivant ⇒ rien n'est ajouté
        expect(await enqueue(tx, consumer, { eventId })).toBe(false);
        expect(await enqueue(tx, other, { eventId })).toBe(true);
      });
      const first = await outboxTx(client, { worker: consumer, commit: true }, async (tx) => {
        const jobs = await claimJobs(tx);
        expect(jobs.map((j) => j.event_id)).toEqual([eventId]);
        const { rows } = await tx.query<{ fresh: boolean }>(
          'SELECT core.outbox_begin_receipt($1) AS fresh',
          [eventId],
        );
        const done = await tx.query<{ ok: boolean }>('SELECT core.outbox_complete_job($1) AS ok', [
          jobs[0]?.id,
        ]);
        expect(done.rows[0]?.ok).toBe(true);
        return rows[0]?.fresh;
      });
      expect(first).toBe(true);

      // rejeu : la tâche précédente est terminée, une nouvelle livraison est acceptée…
      await outboxTx(client, { worker: RELAY, commit: true }, async (tx) => {
        expect(await enqueue(tx, consumer, { eventId })).toBe(true);
      });
      // … mais le reçu existe : doublon ignoré, sans erreur
      const replay = await outboxTx(client, { worker: consumer, commit: true }, async (tx) => {
        const jobs = await claimJobs(tx);
        expect(jobs).toHaveLength(1);
        const { rows } = await tx.query<{ fresh: boolean }>(
          'SELECT core.outbox_begin_receipt($1) AS fresh',
          [eventId],
        );
        await tx.query('SELECT core.outbox_complete_job($1)', [jobs[0]?.id]);
        return rows[0]?.fresh;
      });
      expect(replay).toBe(false);

      await outboxTx(client, { worker: consumer }, async (tx) => {
        const { rows } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM core.outbox_inbox_receipt WHERE event_id = $1',
          [eventId],
        );
        expect(rows[0]?.n).toBe(1);
      });
      // l'autre consommateur traite le même événement une fois, avec son propre reçu
      await outboxTx(client, { worker: other }, async (tx) => {
        const { rows } = await tx.query<{ fresh: boolean }>(
          'SELECT core.outbox_begin_receipt($1) AS fresh',
          [eventId],
        );
        expect(rows[0]?.fresh).toBe(true);
        // et ne voit pas les reçus du premier
        const seen = await tx.query<{ consumer: string }>(
          'SELECT consumer FROM core.outbox_inbox_receipt WHERE event_id = $1',
          [eventId],
        );
        expect(seen.rows.map((r) => r.consumer)).toEqual([other]);
      });
    });
  });

  it('livraison concurrente du même événement : le second reçu attend le premier puis est ignoré', async () => {
    const consumer = workerName('ntf_test');
    const eventId = uuid();
    const a = await connectAs('app_worker');
    const b = await connectAs('app_worker');
    try {
      for (const c of [a, b]) {
        await c.query('BEGIN');
        await c.query(
          `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', $1, true)`,
          [consumer],
        );
      }
      const firstA = await a.query<{ fresh: boolean }>(
        'SELECT core.outbox_begin_receipt($1) AS fresh',
        [eventId],
      );
      expect(firstA.rows[0]?.fresh).toBe(true);
      const pendingB = b.query<{ fresh: boolean }>(
        'SELECT core.outbox_begin_receipt($1) AS fresh',
        [eventId],
      );
      await a.query('COMMIT');
      const secondB = await pendingB;
      expect(secondB.rows[0]?.fresh).toBe(false);
      await b.query('COMMIT');
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      await releaseClient(a);
      await releaseClient(b);
    }
  });

  it(`après ${SPEC_MAX_ATTEMPTS} échecs : FAILED et dead_letter dans la même transaction ; attente exponentielle entre les tentatives`, async () => {
    const consumer = workerName('stl_test');
    const eventId = uuid();
    const base = 10; // secondes (paramètre de test ; la valeur de production est PROPOSÉE, ADR-050)
    await withRole('app_worker', async (client) => {
      await outboxTx(client, { worker: RELAY, virtualNow: T0, commit: true }, (tx) =>
        enqueue(tx, consumer, { eventId }),
      );
      let now = T0;
      const outcomes: string[] = [];
      for (let attempt = 1; attempt <= SPEC_MAX_ATTEMPTS; attempt++) {
        // avant l'échéance : rien à réclamer (sauf à la première tentative)
        if (attempt > 1) {
          const early = await outboxTx(
            client,
            { worker: consumer, virtualNow: at(now, -1) },
            (tx) => claimJobs(tx),
          );
          expect(early, `tentative ${attempt} avant échéance`).toEqual([]);
        }
        const outcome = await outboxTx(
          client,
          { worker: consumer, virtualNow: now, commit: true },
          async (tx) => {
            const jobs = await claimJobs(tx);
            expect(
              jobs.map((j) => j.attempts),
              `tentative ${attempt}`,
            ).toEqual([attempt]);
            return failJob(tx, jobs[0]?.id ?? '', `${base} seconds`);
          },
        );
        outcomes.push(outcome);
        // échéance suivante : base × 2^(tentative − 1)
        now = at(now, base * 2 ** (attempt - 1));
      }
      expect(outcomes).toEqual(['RETRY', 'RETRY', 'RETRY', 'RETRY', 'DEAD_LETTER']);

      await outboxTx(client, { worker: consumer, virtualNow: at(now, 3600) }, async (tx) => {
        expect(await claimJobs(tx)).toEqual([]);
        const { rows: jobs } = await tx.query<{ state: string; attempts: number }>(
          'SELECT state, attempts FROM core.outbox_scheduled_job WHERE event_id = $1',
          [eventId],
        );
        expect(jobs).toEqual([{ state: 'FAILED', attempts: SPEC_MAX_ATTEMPTS }]);
        const { rows: dead } = await tx.query<{
          consumer: string;
          event_id: string;
          attempts: number;
          last_error: string;
          replayed_at: Date | null;
        }>(
          `SELECT consumer, event_id, attempts, last_error, replayed_at
             FROM core.outbox_dead_letter WHERE event_id = $1`,
          [eventId],
        );
        expect(dead).toEqual([
          {
            consumer,
            event_id: eventId,
            attempts: SPEC_MAX_ATTEMPTS,
            last_error: 'Error',
            replayed_at: null,
          },
        ]);
        // aucun reçu : l'événement n'a jamais été traité
        const { rows: receipts } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM core.outbox_inbox_receipt WHERE event_id = $1',
          [eventId],
        );
        expect(receipts[0]?.n).toBe(0);
      });
    });
  });

  it('bail expiré : la tâche est réclamée de nouveau (tentative comptée) ; dernière tentative perdue ⇒ dead_letter', async () => {
    const consumer = workerName('trp_test');
    await withRole('app_worker', async (client) => {
      await outboxTx(client, { worker: consumer, virtualNow: T0, commit: true }, (tx) =>
        enqueue(tx, consumer, { singletonKey: 'timer-1', maxAttempts: 2 }),
      );
      const claim = (virtualNow: string) =>
        outboxTx(client, { worker: consumer, virtualNow, commit: true }, (tx) =>
          claimJobs(tx, 10, '60 seconds'),
        );
      expect((await claim(T0)).map((j) => j.attempts)).toEqual([1]);
      expect(await claim(at(T0, 30))).toEqual([]); // bail en cours
      expect((await claim(at(T0, 61))).map((j) => j.attempts)).toEqual([2]); // bail expiré
      expect(await claim(at(T0, 200))).toEqual([]); // plus de tentative
      const reaped = await outboxTx(
        client,
        { worker: consumer, virtualNow: at(T0, 200), commit: true },
        (tx) =>
          tx.query<{
            consumer: string;
            event_id: string | null;
            attempts: number;
            last_error: string;
          }>(
            'SELECT consumer, event_id, attempts, last_error FROM core.outbox_reap_expired_jobs()',
          ),
      );
      expect(reaped.rows).toEqual([
        { consumer, event_id: null, attempts: 2, last_error: 'LEASE_EXPIRED' },
      ]);
    });
  });

  it("cloisonnement des files : un travailleur ne voit, ne réclame ni ne termine la tâche d'un autre", async () => {
    const owner = workerName('ntf_test');
    const intruder = workerName('rpt_test');
    const eventId = uuid();
    await withRole('app_worker', async (client) => {
      await outboxTx(client, { worker: RELAY, commit: true }, (tx) =>
        enqueue(tx, owner, { eventId }),
      );
      await outboxTx(client, { worker: intruder }, async (tx) => {
        expect(await claimJobs(tx)).toEqual([]);
        const { rows } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM core.outbox_scheduled_job WHERE event_id = $1',
          [eventId],
        );
        expect(rows[0]?.n).toBe(0);
        // reçu au nom d'un autre consommateur : refusé par la RLS
        const err = await failure(
          tx.query('INSERT INTO core.outbox_inbox_receipt (consumer, event_id) VALUES ($1, $2)', [
            owner,
            eventId,
          ]),
        );
        expect(err).toMatchObject({ code: '42501' });
      });
      const jobId = await outboxTx(client, { worker: owner }, async (tx) => {
        const jobs = await claimJobs(tx);
        return jobs[0]?.id ?? '';
      });
      expect(jobId).not.toBe('');
      await outboxTx(client, { worker: intruder }, async (tx) => {
        const { rows } = await tx.query<{ ok: boolean }>(
          'SELECT core.outbox_complete_job($1) AS ok',
          [jobId],
        );
        expect(rows[0]?.ok).toBe(false);
        expect(await failJob(tx, jobId)).toBe('NOT_FOUND');
      });
    });
  });

  it("API : programme une tâche (minuterie) dans la transaction d'une commande, sans pouvoir la lire", async () => {
    const timer = workerName('trp_timer');
    await withRole('app_api', async (api) => {
      await outboxTx(api, { actor: 'HOST', virtualNow: T0, commit: true }, async (tx) => {
        expect(
          await enqueue(tx, timer, { singletonKey: `trip-${uuid()}`, delay: '24 hours' }),
        ).toBe(true);
      });
      // l'API ne choisit pas l'état d'une tâche
      await outboxTx(api, { actor: 'HOST' }, async (tx) => {
        const err = await failure(
          tx.query(
            `INSERT INTO core.outbox_scheduled_job (name, payload, state) VALUES ($1, '{}', 'ACTIVE')`,
            [timer],
          ),
        );
        expect(err).toMatchObject({ code: '42501' });
      });
    });
    await withRole('app_worker', async (client) => {
      expect(
        await outboxTx(client, { worker: timer, virtualNow: at(T0, 24 * 3600 - 1) }, (tx) =>
          claimJobs(tx),
        ),
      ).toEqual([]);
      const due = await outboxTx(client, { worker: timer, virtualNow: at(T0, 24 * 3600) }, (tx) =>
        claimJobs(tx),
      );
      expect(due.map((j) => j.run_at.toISOString())).toEqual([at(T0, 24 * 3600)]);
    });
  });

  it('tâche périodique : une occurrence vivante à la fois ; recréée après une lettre morte (la chaîne ne meurt pas)', async () => {
    const sweeper = workerName('sweeper_test');
    const scheduler = 'bus_scheduler';
    await withRole('app_worker', async (client) => {
      const ensure = (virtualNow: string) =>
        outboxTx(client, { worker: scheduler, virtualNow, commit: true }, (tx) =>
          enqueue(tx, sweeper, { singletonKey: 'periodic', maxAttempts: 1, delay: '60 seconds' }),
        );
      expect(await ensure(T0)).toBe(true);
      expect(await ensure(at(T0, 1))).toBe(false); // occurrence vivante : rien
      const outcome = await outboxTx(
        client,
        { worker: sweeper, virtualNow: at(T0, 60), commit: true },
        async (tx) => {
          const jobs = await claimJobs(tx);
          expect(jobs).toHaveLength(1);
          return failJob(tx, jobs[0]?.id ?? '');
        },
      );
      expect(outcome).toBe('DEAD_LETTER');
      // passage suivant du planificateur : nouvelle occurrence malgré la lettre morte
      expect(await ensure(at(T0, 61))).toBe(true);
      const next = await outboxTx(client, { worker: sweeper, virtualNow: at(T0, 121) }, (tx) =>
        claimJobs(tx),
      );
      expect(next.map((j) => j.run_at.toISOString())).toEqual([at(T0, 121)]);
    });
  });

  it("métriques (17 §6.3) : âge de l'outbox et profondeur des files, lisibles par bus_monitor seulement", async () => {
    const queue = workerName('ntf_metrics');
    await withRole('app_worker', async (client) => {
      await outboxTx(client, { worker: 'booking_conversion', virtualNow: T0, commit: true }, (tx) =>
        insertEvent(tx, country),
      );
      await outboxTx(client, { worker: RELAY, virtualNow: T0, commit: true }, async (tx) => {
        await enqueue(tx, queue, { singletonKey: 'a' });
        await enqueue(tx, queue, { singletonKey: 'b' });
        await enqueue(tx, queue, { singletonKey: 'c', delay: '1 hour' });
      });
      type Row = { metric: string; queue: string | null; value: string };
      const read = (worker: string, virtualNow: string) =>
        outboxTx(client, { worker, virtualNow }, async (tx) => {
          const { rows } = await tx.query<Row>(
            'SELECT metric, queue, value::text AS value FROM core.outbox_metrics()',
          );
          return rows;
        });
      const rows = await read('bus_monitor', at(T0, 150));
      const value = (metric: string, q: string | null = null) =>
        Number(rows.find((r) => r.metric === metric && r.queue === q)?.value ?? NaN);
      expect(value('outbox_unpublished')).toBeGreaterThanOrEqual(1);
      expect(value('outbox_oldest_age_s')).toBeGreaterThanOrEqual(150);
      expect(value('queue_ready', queue)).toBe(2);
      expect(value('queue_scheduled', queue)).toBe(1);
      expect(value('queue_oldest_ready_age_s', queue)).toBe(150);

      // un autre travailleur ne voit rien (fail-closed) : zéros, aucune file
      const blind = await read('booking_conversion', at(T0, 150));
      expect(blind.filter((r) => r.queue !== null)).toEqual([]);
      expect(blind.map((r) => [r.metric, r.value])).toEqual([
        ['outbox_unpublished', '0'],
        ['outbox_oldest_age_s', '0'],
      ]);
    });
  });
});
