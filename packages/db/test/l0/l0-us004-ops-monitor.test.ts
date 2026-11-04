/**
 * US-004 — métriques de supervision (migration 0051, core.ops_monitor_metrics) sous app_worker
 * (assertion L0-05 en tête de chaque test par withRole), en PA (USD) et en PY (PYG).
 *
 * Attendus (17 §6.3, 16 ADM-032 « Given un webhook PSP en échec 3 fois, Then une alerte part ») :
 * - `webhook_failing` compte, par fournisseur, les webhooks QUARANTINED / FAILED qui ont au moins
 *   le nombre de passages en échec demandé (3) ; 2 passages ne comptent pas ;
 * - `webhook_signature_rejected` compte les signatures invalides reçues depuis l'instant donné ;
 * - `payment_unknown_30m` compte, par pays, les opérations UNKNOWN depuis plus de 30 min ;
 * - `p1_event` compte, par type et par pays, les alertes P1 écrites dans l'outbox depuis l'instant
 *   donné (charge utile `severity` = P1, plafond SMS) ; un événement ordinaire ne compte pas ;
 * - comptes seulement : aucune colonne d'identifiant ;
 * - réservée au travailleur ops_monitor (42501 ops_monitor_forbidden), jamais à app_api.
 * Tout se passe dans une transaction ANNULÉE (aucune trace dans la base partagée) ; l'horloge
 * virtuelle est propre à ce fichier (2033), les fournisseurs sont uniques à chaque test.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { attempt, uuid } from '../support/audit.ts';
import { COUNTRIES } from '../support/avl.ts';
import { buildWorld } from '../support/rls.ts';
import type { World } from '../support/rls.ts';

const T0 = '2033-04-04T04:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(T0) + seconds * 1000).toISOString();
let world: World;

beforeAll(async () => {
  const api = await connectAs('app_api');
  try {
    world = await buildWorld(api, COUNTRIES);
  } finally {
    await releaseClient(api);
  }
});

async function as(tx: pg.ClientBase, worker: string, now: string): Promise<void> {
  await tx.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', $1, true),
            pg_catalog.set_config('app.virtual_now', $2, true)`,
    [worker, now],
  );
}

async function inbox(
  tx: pg.ClientBase,
  provider: string,
  status: string,
  attempts: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO core.payment_webhook_inbox
            (id, provider, provider_event_id, dedup_key, signature_valid, processing_status,
             processing_attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      uuid(),
      provider,
      `evt_${randomBytes(6).toString('hex')}`,
      randomBytes(32),
      status !== 'REJECTED_SIGNATURE',
      status,
      attempts,
    ],
  );
}

async function event(tx: pg.ClientBase, type: string, country: string, payload: object) {
  await tx.query(
    `INSERT INTO core.outbox_outbox_event
            (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
             actor_role, correlation_id, payload, partition_key)
     VALUES ($1, 1, 'production_oracle', $2, 0, $3, 'SYSTEM', $4, $5::jsonb, 'production_oracle')`,
    [type, uuid(), country, uuid(), JSON.stringify(payload)],
  );
}

type Row = { metric: string; label: string | null; country_code: string | null; value: string };

async function metrics(tx: pg.ClientBase, since: string, failures = 3): Promise<Row[]> {
  const { rows } = await tx.query<Row>(
    `SELECT metric, label, country_code, value::text AS value
       FROM core.ops_monitor_metrics($1::timestamptz, $2)`,
    [since, failures],
  );
  return rows;
}

const value = (rows: Row[], metric: string, label: string | null, country: string | null) =>
  Number(
    rows.find((r) => r.metric === metric && r.label === label && r.country_code === country)
      ?.value ?? 0,
  );

describe.each(COUNTRIES.map((c, i) => ({ ...c, i })))(
  'US-004 — supervision — $country ($currency)',
  ({ country, currency, i }) => {
    it('ADM-032 : un webhook en échec 3 fois est compté (2 fois : non) ; signatures invalides depuis l’instant donné', async () => {
      const provider = `MON_${randomBytes(5).toString('hex').toUpperCase()}`;
      await withRole('app_worker', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          await as(tx, 'webhook_ingest', T0);
          await inbox(tx, provider, 'QUARANTINED', 2);
          await inbox(tx, provider, 'QUARANTINED', 3);
          await inbox(tx, provider, 'FAILED', 5);
          await inbox(tx, provider, 'PROCESSED', 7); // traité : jamais en échec ouvert
          await inbox(tx, provider, 'REJECTED_SIGNATURE', 0);
          await as(tx, 'ops_monitor', at(60));
          const rows = await metrics(tx, at(-1));
          expect(value(rows, 'webhook_failing', provider, null)).toBe(2);
          expect(value(rows, 'webhook_signature_rejected', provider, null)).toBe(1);
          // seuil paramétré : 2 passages => les trois webhooks en échec ouvert
          expect(value(await metrics(tx, at(-1), 2), 'webhook_failing', provider, null)).toBe(3);
          // fenêtre : une signature reçue avant `since` ne compte plus
          expect(
            value(await metrics(tx, at(1)), 'webhook_signature_rejected', provider, null),
          ).toBe(0);
          // comptes seulement : aucune colonne d'identifiant
          const { fields } = await tx.query(
            'SELECT * FROM core.ops_monitor_metrics($1::timestamptz, 3) LIMIT 0',
            [at(-1)],
          );
          expect(fields.map((f) => f.name)).toEqual(['metric', 'label', 'country_code', 'value']);
        });
      });
    });

    it('opérations UNKNOWN depuis plus de 30 min, par pays', async () => {
      const w = world.countries[i];
      if (w === undefined) throw new Error('pays absent du monde');
      await withRole('app_worker', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          await as(tx, 'ops_monitor', at(31 * 60));
          const baseline = value(await metrics(tx, at(0)), 'payment_unknown_30m', null, country);
          await as(tx, 'webhook_ingest', at(0));
          await tx.query(
            `SELECT test_fixture.insert_payment_operation($1, $2, $3, $4, $5::bigint, 'CAPTURE', 'RENT', 'UNKNOWN')`,
            [uuid(), w.holds.h1, country, currency, w.c.rentMinor],
          );
          await as(tx, 'webhook_ingest', at(2 * 60)); // UNKNOWN depuis 29 min seulement
          await tx.query(
            `SELECT test_fixture.insert_payment_operation($1, $2, $3, $4, $5::bigint, 'CAPTURE', 'RENT', 'UNKNOWN')`,
            [uuid(), w.holds.h1, country, currency, w.c.rentMinor],
          );
          await as(tx, 'ops_monitor', at(31 * 60));
          expect(value(await metrics(tx, at(0)), 'payment_unknown_30m', null, country)).toBe(
            baseline + 1,
          );
        });
      });
    });

    it('alertes P1 de l’outbox (oracle C12, plafond SMS) depuis l’instant donné ; événement ordinaire ignoré', async () => {
      await withRole('app_worker', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          await as(tx, 'ops_test_writer', T0);
          await event(tx, 'booking.alert.production_oracle', country, { severity: 'P1' });
          await event(tx, 'booking.alert.production_oracle', country, { severity: 'P1' });
          await event(tx, 'notification.sms_cap.reached', country, { template: 'x' });
          await event(tx, 'booking.trip.booked', country, { severity: 'P2' });
          await as(tx, 'ops_monitor', at(30));
          const rows = await metrics(tx, at(-1));
          const mine = rows.filter((r) => r.metric === 'p1_event' && r.country_code === country);
          expect(mine.map((r) => [r.label, r.value]).sort()).toEqual([
            ['booking.alert.production_oracle', '2'],
            ['notification.sms_cap.reached', '1'],
          ]);
          // l'outbox non publiée a au moins 30 s
          expect(value(rows, 'outbox_oldest_age_s', null, null)).toBeGreaterThanOrEqual(30);
          // depuis un instant postérieur : plus rien
          expect((await metrics(tx, at(1))).filter((r) => r.metric === 'p1_event')).toEqual([]);
        });
      });
    });

    it('réservée au travailleur ops_monitor : autre travailleur 42501, app_api sans droit', async () => {
      await withRole('app_worker', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          for (const worker of ['bus_monitor', 'webhook_ingest', 'booking_oracle']) {
            await as(tx, worker, T0);
            const e = await attempt(
              tx,
              'SELECT * FROM core.ops_monitor_metrics($1::timestamptz, 3)',
              [at(-1)],
            );
            expect(e, worker).toMatchObject({ code: '42501', constraint: 'ops_monitor_forbidden' });
            expect(translateDbError(e)).toMatchObject({ code: 'FORBIDDEN' });
          }
          await as(tx, 'ops_monitor', T0);
          expect(
            await attempt(tx, 'SELECT * FROM core.ops_monitor_metrics($1::timestamptz, 0)', [
              at(-1),
            ]),
          ).toMatchObject({ code: '22023' });
        });
      });
      await withRole('app_api', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          expect(
            await attempt(tx, 'SELECT * FROM core.ops_monitor_metrics($1::timestamptz, 3)', [
              at(-1),
            ]),
          ).toMatchObject({ code: '42501' });
        });
      });
    });
  },
);
