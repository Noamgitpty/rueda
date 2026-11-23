/**
 * US-402 (ADR-206 PROPOSÉ ; L4-PM-19) — garde de reprise de la migration 0185, sous les rôles de
 * PRODUCTION (`connectAs` / `withRole` : assertion L0-05 en tête de chaque connexion).
 *
 * - banc vierge : garde inactive, ligne de temps attendue = courante (lisible) ;
 * - garde posée (par un travailleur) ⇒ `core.outbox_claim_jobs` ne rend AUCUNE tâche, même due ;
 *   garde retirée (point de sauvegarde annulé : elle n'a jamais été validée) ⇒ la même tâche est
 *   réclamée, une fois. Tâches propres au test (file au nom unique), transactions ANNULÉES : rien
 *   n'est visible des autres sessions, aucun compte global ;
 * - droits : seul `app_worker` pose une garde ou lit l'état ; aucun rôle applicatif ne la lève ni
 *   ne lit ou n'écrit les tables ; `app_anon` n'exécute rien.
 * Charge utile en USD (PA) et en PYG sans décimale (PY), montants en unités mineures.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../src/testing/index.ts';
import { EVENT_COUNTRIES, outboxTx, workerName } from '../support/outbox.ts';

const ENQUEUE = `SELECT core.outbox_enqueue($1::text, $2::jsonb, $3::text, NULL::uuid,
                        NULL::timestamptz, interval '0 seconds', 5) AS added`;
const CLAIM = `SELECT id FROM core.outbox_claim_jobs(10, interval '30 seconds')`;

async function sqlstate(
  client: pg.ClientBase,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  await client.query('SAVEPOINT refus');
  try {
    await client.query(sql, params);
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code ?? 'INCONNU';
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT refus');
  }
}

describe('US-402 — garde de reprise (0185)', () => {
  it('banc vierge : garde inactive, ligne de temps lisible et attendue', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{
        active: boolean;
        expected_timeline: number | null;
        current_timeline: number | null;
        open_holds: number;
      }>('SELECT * FROM platform.recovery_status()');
      expect(rows).toHaveLength(1);
      const s = rows[0]!;
      expect(s.current_timeline).not.toBeNull();
      expect(s.expected_timeline).toBe(s.current_timeline);
      expect(s.open_holds).toBe(0);
      expect(s.active).toBe(false);
    });
  });

  describe.each(EVENT_COUNTRIES)('$country ($currency)', (c) => {
    it('garde posée ⇒ aucune tâche réclamée ; garde jamais validée ⇒ la tâche est réclamée une fois', async () => {
      await withRole('app_worker', async (client) => {
        const queue = workerName('us402_hold');
        await outboxTx(client, { worker: queue }, async (tx) => {
          const added = await tx.query<{ added: boolean }>(ENQUEUE, [
            queue,
            JSON.stringify({ currency: c.currency, amount_minor: c.amountMinor.toString() }),
            `us402:${queue}`,
          ]);
          expect(added.rows[0]?.added).toBe(true);

          await tx.query('SAVEPOINT garde');
          const hold = await tx.query<{ id: string }>(
            `SELECT platform.recovery_place_hold('US-402 : exercice de garde') AS id`,
          );
          expect(hold.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
          const st = await tx.query<{ active: boolean; open_holds: number }>(
            'SELECT active, open_holds FROM platform.recovery_status()',
          );
          expect(st.rows[0]).toEqual({ active: true, open_holds: 1 });
          expect((await tx.query(CLAIM)).rows).toEqual([]);
          // rejouer la réclamation ne change rien : toujours aucune tâche
          expect((await tx.query(CLAIM)).rows).toEqual([]);
          const waiting = await tx.query<{ state: string; attempts: number }>(
            'SELECT state, attempts FROM core.outbox_scheduled_job WHERE name = $1',
            [queue],
          );
          expect(waiting.rows).toEqual([{ state: 'CREATED', attempts: 0 }]);
          await tx.query('ROLLBACK TO SAVEPOINT garde');

          const claimed = await tx.query<{ id: string }>(CLAIM);
          expect(claimed.rows).toHaveLength(1);
          expect((await tx.query(CLAIM)).rows).toEqual([]);
        });
      });
    });
  });

  it('droits : app_worker pose et lit, ne lève pas ; app_api et app_anon : rien ; tables fermées', async () => {
    await withRole('app_worker', async (client) => {
      await outboxTx(client, { worker: workerName('us402_rights') }, async (tx) => {
        expect(await sqlstate(tx, `SELECT platform.recovery_release('levée interdite')`)).toBe(
          '42501',
        );
        expect(await sqlstate(tx, 'SELECT * FROM platform.recovery_hold')).toBe('42501');
        expect(await sqlstate(tx, 'SELECT * FROM platform.recovery_guard')).toBe('42501');
        expect(await sqlstate(tx, 'UPDATE platform.recovery_guard SET expected_timeline = 1')).toBe(
          '42501',
        );
        expect(await sqlstate(tx, 'SELECT platform.recovery_timeline()')).toBe('42501');
        // motif hors bornes : refusé, rien n'est posé
        expect(await sqlstate(tx, `SELECT platform.recovery_place_hold('x')`)).toBe('22023');
      });
    });
    await withRole('app_api', async (client) => {
      await outboxTx(client, { actor: 'GUEST' }, async (tx) => {
        expect(await sqlstate(tx, 'SELECT platform.recovery_hold_active()')).toBe('OK');
        expect(await sqlstate(tx, `SELECT platform.recovery_place_hold('pose par l''API')`)).toBe(
          '42501',
        );
        expect(await sqlstate(tx, 'SELECT * FROM platform.recovery_status()')).toBe('42501');
        expect(await sqlstate(tx, `SELECT platform.recovery_release('levée interdite')`)).toBe(
          '42501',
        );
      });
    });
    await withRole('app_anon', async (client) => {
      await client.query('BEGIN');
      try {
        for (const sql of [
          'SELECT platform.recovery_hold_active()',
          'SELECT * FROM platform.recovery_status()',
          `SELECT platform.recovery_place_hold('pose anonyme')`,
        ]) {
          expect(await sqlstate(client, sql), sql).toBe('42501');
        }
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});
