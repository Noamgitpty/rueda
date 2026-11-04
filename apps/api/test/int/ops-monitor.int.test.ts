/**
 * US-004 — critère « Given un webhook en échec 3 fois, When il échoue, Then une alerte part »
 * (19 US-004, 16 ADM-032), de bout en bout sur PostgreSQL réel sous `app_worker` (CLAUDE.md
 * point 6 : `connectAs` exécute l'assertion L0-05) :
 *   le VRAI magasin du travailleur webhook_ingest (`PgWebhookWorkStore.mark`) compte chaque
 *   passage en échec ; le VRAI moniteur (`OpsMonitor`, travailleur ops_monitor) lit
 *   `core.ops_monitor_metrics` et envoie l'alerte sur le port `AlertChannel` ; ici un canal
 *   enregistreur qui applique le même contrôle que la production (comptes et codes seulement).
 * Deux échecs : aucune alerte pour ce fournisseur ; le troisième : une alerte P1, et une seule tant
 * que rien ne change. Transaction toujours ANNULÉE ; fournisseur unique au test.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { connectAs, releaseClient } from '@rueda/db/testing';
import { assertSafeAlert, OpsMonitor } from '../../src/modules/bus/index.js';
import type { AlertChannel, OpsAlert, SqlClient } from '../../src/modules/bus/index.js';
import { PgWebhookWorkStore } from '../../src/modules/pay/index.js';

const opened: pg.Client[] = [];
afterAll(async () => {
  for (const c of opened.splice(0)) await releaseClient(c);
});

class RecordingChannel implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  send(alert: OpsAlert): Promise<void> {
    assertSafeAlert(alert);
    this.sent.push(alert);
    return Promise.resolve();
  }
}

const sqlOf = (client: pg.Client): SqlClient => ({
  query: async <R>(text: string, params?: readonly unknown[]) => {
    const r = await client.query(text, params as unknown[] | undefined);
    return { rows: r.rows as R[], rowCount: r.rowCount };
  },
});

async function asWorker(client: pg.Client, worker: string): Promise<void> {
  await client.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', $1, true)`,
    [worker],
  );
}

describe('US-004 — webhook en échec 3 fois => une alerte part', () => {
  it('magasin webhook_ingest réel + moniteur ops_monitor réel, sous app_worker', async () => {
    const client = await connectAs('app_worker');
    opened.push(client);
    const provider = `MON_${randomBytes(5).toString('hex').toUpperCase()}`;
    const channel = new RecordingChannel();
    const monitor = new OpsMonitor(channel);
    const mine = () =>
      channel.sent.filter(
        (a) => a.code === 'OPS_WEBHOOK_FAILING' && a.labels?.provider === provider,
      );
    await client.query('BEGIN');
    try {
      await asWorker(client, 'webhook_ingest');
      const inboxId = randomUUID();
      await client.query(
        `INSERT INTO core.payment_webhook_inbox
                (id, provider, provider_event_id, dedup_key, signature_valid, processing_status)
         VALUES ($1, $2, $3, $4, true, 'RECEIVED')`,
        [inboxId, provider, `evt_${randomBytes(6).toString('hex')}`, randomBytes(32)],
      );
      const store = new PgWebhookWorkStore(client);
      const fail = async (): Promise<void> => {
        await asWorker(client, 'webhook_ingest');
        await store.mark(inboxId, 'QUARANTINED', 'OPERATION_NOT_FOUND');
      };
      const pass = async (): Promise<void> => {
        await asWorker(client, 'ops_monitor');
        await monitor.run(sqlOf(client));
      };

      await fail();
      await fail();
      await pass();
      expect(mine()).toEqual([]); // deux échecs : pas encore d'alerte

      await fail();
      await pass();
      expect(mine()).toEqual([
        {
          code: 'OPS_WEBHOOK_FAILING',
          severity: 'P1',
          counts: { value: 1 },
          labels: { provider },
        },
      ]);

      await pass(); // rien n'a changé : pas de nouvelle alerte avant le rappel (30 min)
      expect(mine()).toHaveLength(1);

      const { rows } = await client.query<{ processing_attempts: number }>(
        'SELECT processing_attempts FROM core.payment_webhook_inbox WHERE id = $1',
        [inboxId],
      );
      expect(rows).toEqual([{ processing_attempts: 3 }]);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
