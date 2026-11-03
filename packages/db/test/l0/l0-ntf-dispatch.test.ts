/**
 * L0 NTF (US-021, migrations 0028 et 0029 ; 17 §2.3, §3.2.12 ; ADR-061) sous les rôles de
 * PRODUCTION (assertion L0-05 en tête de chaque test, withRole), en USD (PA) et en PYG (PY).
 *
 * - `notification_dispatch` : RLS ENABLE + FORCE ; rien pour app_api ni app_anon ; app_worker
 *   seulement sous `ntf_dispatcher` (création) et `ntf_sender` (avancement, repli) ; unicité
 *   (event_id, destinataire, canal) = aucun doublon (critère 2) ; au plus 3 tentatives ; un code
 *   d'erreur court seulement ; un envoi terminal ne bouge plus.
 * - `core.iam_notification_contact` : SECURITY DEFINER, EXECUTE au seul app_worker, zéro ligne
 *   hors du travailleur `ntf_sender` ; numéro et adresse rendus seulement s'ils sont vérifiés ;
 *   compte fermé ⇒ zéro ligne.
 *
 * Les attentes viennent de 17 §2.13, §3.2.12 et §3.1.4 (C2), jamais du code testé.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { register } from '../support/iam.ts';
import { EVENT_COUNTRIES } from '../support/outbox.ts';

const uuid = (): string => randomUUID();

/** Transaction d'un travailleur nommé (contexte posé en local, comme workerTransactions). */
async function asWorker<T>(
  client: pg.ClientBase,
  worker: string,
  fn: (tx: pg.ClientBase) => Promise<T>,
  commit = false,
): Promise<T> {
  return withTestTransaction(client, { commit }, async (tx) => {
    await tx.query(
      `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
              pg_catalog.set_config('app.worker_name', $1, true)`,
      [worker],
    );
    return fn(tx);
  });
}

/** Compte vérifié (email confirmé, ACTIVE), numéro posé vérifié ou non. */
async function account(phone: { e164: string; verified: boolean } | null): Promise<string> {
  return withRole('app_api', async (api) => {
    const r = await register(api);
    const { rows } = await api.query<{ ok: boolean }>(
      'SELECT core.iam_cmd_verify_email($1) AS ok',
      [r.verification.hash],
    );
    expect(rows[0]?.ok).toBe(true);
    if (phone) {
      await api.query('SELECT test_fixture.ntf_set_phone($1, $2, $3)', [
        r.userId,
        phone.e164,
        phone.verified,
      ]);
    }
    return r.userId;
  });
}

const INSERT = `
  INSERT INTO core.ntf_notification_dispatch
         (event_id, event_type, country_code, correlation_id, recipient_user_id, recipient_role,
          channel, template_key, template_version, variables)
  VALUES ($1, 'booking.trip.booked', $2, $3, $4, 'GUEST', $5, 'EVT_BOOKING_CONFIRMED', 1,
          '{"booking_ref":"ABCD1234"}'::jsonb)
  RETURNING id::text AS id`;

const failure = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe.each(EVENT_COUNTRIES)('L0 NTF — $country ($currency)', (c) => {
  it('app_api et app_anon : aucun droit sur notification_dispatch ni sur la fonction de contact', async () => {
    const user = await account(null);
    for (const role of ['app_api', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        expect(await failure(client.query('SELECT 1 FROM core.ntf_notification_dispatch'))).toBe(
          '42501',
        );
        expect(
          await failure(client.query('SELECT * FROM core.iam_notification_contact($1)', [user])),
        ).toBe('42501');
      });
    }
  });

  it('critère 2 : (événement, destinataire, canal) unique ; un autre canal est un autre envoi', async () => {
    const user = await account(null);
    const eventId = uuid();
    await withRole('app_worker', async (worker) => {
      await asWorker(worker, 'ntf_dispatcher', async (tx) => {
        const first = await tx.query(INSERT, [eventId, c.country, uuid(), user, 'EMAIL']);
        expect(first.rows).toHaveLength(1);
        await tx.query('SAVEPOINT s');
        expect(await failure(tx.query(INSERT, [eventId, c.country, uuid(), user, 'EMAIL']))).toBe(
          '23505',
        );
        await tx.query('ROLLBACK TO SAVEPOINT s');
        const other = await tx.query(INSERT, [eventId, c.country, uuid(), user, 'SMS']);
        expect(other.rows).toHaveLength(1);
        const { rows } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM core.ntf_notification_dispatch WHERE event_id = $1',
          [eventId],
        );
        expect(rows[0]?.n).toBe(2);
      });
    });
  });

  it('création : seuls ntf_dispatcher et ntf_sender ; ni statut ni tentative choisis ; repli réservé à ntf_sender', async () => {
    const user = await account(null);
    await withRole('app_worker', async (worker) => {
      // un autre travailleur : écriture refusée, lecture vide
      await asWorker(worker, 'outbox_relay', async (tx) => {
        expect(await failure(tx.query(INSERT, [uuid(), c.country, uuid(), user, 'EMAIL']))).toBe(
          '42501',
        );
      });
      await asWorker(worker, 'ntf_dispatcher', async (tx) => {
        const { rows } = await tx.query<{ id: string }>(INSERT, [
          uuid(),
          c.country,
          uuid(),
          user,
          'EMAIL',
        ]);
        const id = rows[0]?.id;
        await tx.query('SAVEPOINT s');
        // colonne non accordée à l'insertion
        expect(
          await failure(
            tx.query(
              `INSERT INTO core.ntf_notification_dispatch
                      (event_id, event_type, correlation_id, recipient_user_id, recipient_role,
                       channel, template_key, template_version, status)
               VALUES ($1, 'booking.trip.booked', $2, $3, 'GUEST', 'EMAIL', 'EVT_BOOKING_CONFIRMED', 1, 'SENT')`,
              [uuid(), uuid(), user],
            ),
          ),
        ).toBe('42501');
        await tx.query('ROLLBACK TO SAVEPOINT s');
        // repli (fallback_of) : réservé à ntf_sender
        expect(
          await failure(
            tx.query(
              `INSERT INTO core.ntf_notification_dispatch
                      (event_id, event_type, correlation_id, recipient_user_id, recipient_role,
                       channel, template_key, template_version, fallback_of)
               VALUES ($1, 'booking.trip.booked', $2, $3, 'GUEST', 'SMS', 'EVT_BOOKING_CONFIRMED', 1, $4)`,
              [uuid(), uuid(), user, id],
            ),
          ),
        ).toBe('42501');
        await tx.query('ROLLBACK TO SAVEPOINT s');
        // le dispatcher ne fait pas avancer un envoi : 0 ligne modifiée
        const upd = await tx.query(
          `UPDATE core.ntf_notification_dispatch SET status = 'FAILED', last_error = 'X' WHERE id = $1`,
          [id],
        );
        expect(upd.rowCount).toBe(0);
      });
      await asWorker(worker, 'outbox_relay', async (tx) => {
        const { rows } = await tx.query('SELECT id FROM core.ntf_notification_dispatch');
        expect(rows).toEqual([]);
      });
    });
  });

  it('avancement par ntf_sender : 3 tentatives au plus, code court, SENT avec preuve, terminal figé', async () => {
    const user = await account(null);
    await withRole('app_worker', async (worker) => {
      const id = await asWorker(
        worker,
        'ntf_dispatcher',
        async (tx) =>
          (await tx.query<{ id: string }>(INSERT, [uuid(), c.country, uuid(), user, 'EMAIL']))
            .rows[0]?.id,
        true,
      );
      await asWorker(worker, 'ntf_sender', async (tx) => {
        const set = (sql: string, params: unknown[] = []) =>
          tx.query(`UPDATE core.ntf_notification_dispatch SET ${sql} WHERE id = $1`, [
            id,
            ...params,
          ]);
        for (const [sql, params] of [
          ['attempts = 4', []],
          ["last_error = 'erreur avec un email a@b.c'", []],
          ["status = 'SENT'", []], // sans identifiant du fournisseur ni empreinte
          ["status = 'INCONNU'", []],
        ] as const) {
          await tx.query('SAVEPOINT s');
          expect(await failure(set(sql, [...params])), sql).toBe('23514');
          await tx.query('ROLLBACK TO SAVEPOINT s');
        }
        // colonne non accordée
        await tx.query('SAVEPOINT s');
        expect(await failure(set(`template_key = 'EVT_KYC_APPROVED'`))).toBe('42501');
        await tx.query('ROLLBACK TO SAVEPOINT s');

        const sent = await set(
          `status = 'SENT', attempts = 1, provider_message_id = 'fk_mail_1',
           rendered_hash = $2::bytea, locale = 'fr'`,
          [Buffer.alloc(32, 7)],
        );
        expect(sent.rowCount).toBe(1);
        // terminal : plus aucune modification
        const again = await set(`status = 'FAILED', last_error = 'LATE'`);
        expect(again.rowCount).toBe(0);
      });
    });
  });

  it('coordonnées : zéro ligne hors de ntf_sender ; numéro et adresse seulement vérifiés ; compte fermé ⇒ rien', async () => {
    const verified = await account({ e164: '+15550000101', verified: true });
    const unverified = await account({ e164: '+15550000102', verified: false });
    const unconfirmed = await withRole('app_api', async (api) => (await register(api)).userId);
    await withRole('app_worker', async (worker) => {
      const contact = (tx: pg.ClientBase, id: string) =>
        tx
          .query<{
            email: string | null;
            phone_e164: string | null;
            preferred_locale: string;
            first_name: string;
          }>('SELECT * FROM core.iam_notification_contact($1)', [id])
          .then((r) => r.rows);
      await asWorker(worker, 'ntf_dispatcher', async (tx) => {
        expect(await contact(tx, verified)).toEqual([]);
      });
      await withTestTransaction(worker, {}, async (tx) => {
        expect(await contact(tx, verified)).toEqual([]); // contexte absent
      });
      await asWorker(worker, 'ntf_sender', async (tx) => {
        const [v] = await contact(tx, verified);
        expect(v?.email).toMatch(/@example\.test$/);
        expect(v?.phone_e164).toBe('+15550000101');
        expect(typeof v?.first_name).toBe('string');
        expect(Object.keys(v ?? {}).sort()).toEqual(
          ['email', 'first_name', 'phone_e164', 'preferred_locale'].sort(),
        );
        const [u] = await contact(tx, unverified);
        expect(u?.phone_e164).toBeNull();
        // compte PENDING_EMAIL : zéro ligne
        expect(await contact(tx, unconfirmed)).toEqual([]);
        expect(await contact(tx, uuid())).toEqual([]);
      });
    });
    await withRole('app_api', async (api) => {
      await api.query(`SELECT test_fixture.iam_set_account_status($1, 'CLOSED')`, [verified]);
    });
    await withRole('app_worker', async (worker) => {
      await asWorker(worker, 'ntf_sender', async (tx) => {
        const { rows } = await tx.query('SELECT * FROM core.iam_notification_contact($1)', [
          verified,
        ]);
        expect(rows).toEqual([]);
      });
    });
  });
});
