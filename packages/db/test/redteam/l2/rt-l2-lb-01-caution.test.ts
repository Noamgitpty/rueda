/**
 * US-222c — red team du lot 2, ex-porte LB (19 US-222 critère 3), RT-L2-LB01 (côté base) et
 * RT-L2-LB02 : « caution non libérée » et décision de la caution rejouée ou concurrente, contre la
 * décision d'US-702 / US-702b (migrations 0146, 0150, 0153 ; ADR-169, ADR-172), sous les rôles de
 * PRODUCTION (assertion L0-05 par `withRole` / `connectAs`), en USD (PA) et en PYG sans décimale
 * (PY). TESTS SEULEMENT, aucun correctif (L2-PM-39). Rapport : docs/team/redteam/L2-rls-lb.md.
 *
 * Attaques : (1) le voyageur, l'hôte ou un travailleur écrit la caution en direct (libération
 * repoussée, état forcé, ligne effacée) ; (2) `app_api` forge un contexte de travailleur pour lire la
 * file des décisions ou décider lui-même ; (3) un travailleur falsifie la décision de T57 (capture
 * au-delà de la caution, négative, Σ ≠ montant, capture après l'expiration, décision avant l'heure) ;
 * (4) deux décisions CONCURRENTES sur deux connexions (VOID entier contre capture partielle), attente
 * sur le verrou OBSERVÉE. Attendus (08 BR-PAY-06 « jamais suspendue », T57, T58, T73 ; 16 PAY-011
 * « États » ; 17 §3.2.7, §4.5) : refus sans rien écrire ; une seule décision, un seul événement
 * `deposit.decision.executed` ; caution libérée à fin + 70 h. Montants : `support-l2.ts`.
 *
 * Les cautions de la course (4) sont VALIDÉES (fixtures 9934 et 9932), puis toujours menées à un état
 * final : aucune ne reste dans une file. Aucun interrupteur de mise en service n'est écrit.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../../src/testing/index.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { payTx } from '../../support/pay.ts';
import { withRawContext } from '../../support/rls.ts';
import { at, beginWorker, depositOf, failure, waitUntilLocked, withThree } from './support-l2.ts';
import type { Row, Tx } from './support-l2.ts';

const uuid = (): string => randomUUID();

/** T57 : trip de 72 h, autorisé à début − 24 h (expiration fin + 72 h), décision à fin + 70 h. */
function timeline(start: string) {
  const end = at(start, 72);
  return { start, end, expiry: at(end, 72), release: at(end, 72), decision: at(end, 70) };
}

async function seed(tx: Tx, cc: CountryCase, t: ReturnType<typeof timeline>): Promise<Row> {
  const { rows } = await tx.query<Row>(
    `SELECT * FROM test_fixture.us702_converted_deposit($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      cc.country,
      cc.currency,
      cc.timezone,
      t.start,
      t.end,
      depositOf(cc).amount.toString(),
      'PREAUTH_SINGLE',
      t.expiry,
      t.release,
      t.decision,
      `fake-${uuid()}`,
    ],
  );
  return rows[0]!;
}

const DECIDE = 'SELECT core.payment_cmd_deposit_decide($1, $2, $3, $4, $5) AS r';
const decide = async (
  tx: Tx,
  id: unknown,
  status: string,
  captured: bigint,
  released: bigint,
): Promise<string> =>
  (await tx.query<{ r: string }>(DECIDE, [id, 0, status, captured.toString(), released.toString()]))
    .rows[0]!.r;
const dueIds = async (tx: Tx): Promise<unknown[]> =>
  (await tx.query<Row>('SELECT deposit_id FROM core.payment_deposit_decision_due(500)')).rows.map(
    (r) => r['deposit_id'],
  );
const setClock = (tx: Tx, iso: string) =>
  tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);

/** Écritures directes tentées sur la caution (aucune ne doit passer : 42501). */
const DIRECT = [
  `UPDATE core.payment_deposit_hold SET release_at = release_at + interval '30 days' WHERE id = $1`,
  `UPDATE core.payment_deposit_hold SET decision_at = decision_at + interval '30 days' WHERE id = $1`,
  `UPDATE core.payment_deposit_hold SET status = 'PLANNED' WHERE id = $1`,
  `DELETE FROM core.payment_deposit_hold WHERE id = $1`,
];

describe.each(COUNTRIES)('RT-L2-LB02 — caution non libérée ($country, $currency)', (cc) => {
  it('privilèges : ni app_anon, ni app_api, ni app_worker n’insère, ne modifie (aucune colonne), ne supprime ni ne vide payment_deposit_hold', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{ role: string; priv: string; x: boolean }>(
        `SELECT r AS role, p AS priv,
                CASE WHEN p IN ('INSERT', 'UPDATE')
                     THEN pg_catalog.has_any_column_privilege(r, 'core.payment_deposit_hold', p)
                     ELSE pg_catalog.has_table_privilege(r, 'core.payment_deposit_hold', p) END AS x
           FROM unnest(ARRAY['app_anon', 'app_api', 'app_worker']) AS r,
                unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p`,
      );
      expect(rows).toHaveLength(12);
      expect(rows.filter((r) => r.x).map((r) => `${r.role}:${r.priv}`)).toEqual([]);
    });
  });

  it('écritures directes (libération repoussée de 30 jours, décision repoussée, état PLANNED, suppression) : refusées (42501) sous app_worker payment_command et sous app_api (voyageur de la caution, hôte) ; la caution reste due à fin + 70 h', async () => {
    const t = timeline('2033-04-01T10:00:00.000Z');
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: at(t.end, 1) }, async (tx) => {
        const s = await seed(tx, cc, t);
        for (const sql of DIRECT) {
          expect(await failure(tx, sql, [s['deposit_id']]), sql).toMatchObject({ code: '42501' });
        }
        await setClock(tx, t.decision);
        expect(await dueIds(tx)).toContain(s['deposit_id']);
      }),
    );
    // app_api : le voyageur et l'hôte d'une caution (identifiant quelconque : le droit manque avant
    // toute lecture de ligne) ; contexte posé comme la vraie couche d'accès
    await withRole('app_api', async (client) => {
      for (const ctx of [
        { 'app.actor_kind': 'GUEST', 'app.user_id': uuid() },
        { 'app.actor_kind': 'HOST', 'app.user_id': uuid(), 'app.org_id': uuid() },
      ]) {
        await withRawContext(client, ctx, async (tx) => {
          for (const sql of DIRECT) {
            expect(await failure(tx, sql, [uuid()]), sql).toMatchObject({ code: '42501' });
          }
        });
      }
    });
  });

  it('contexte de travailleur forgé sous app_api (WORKER / payment_command) : file des décisions, décision et transition refusées (aucun EXECUTE, 42501) ; témoin : app_worker lit la file', async () => {
    await withRole('app_api', async (client) => {
      await withRawContext(
        client,
        { 'app.actor_kind': 'WORKER', 'app.worker_name': 'payment_command' },
        async (tx) => {
          for (const [sql, params] of [
            ['SELECT * FROM core.payment_deposit_decision_due(10)', []],
            ['SELECT * FROM core.payment_deposit_reauth_due(10)', []],
            [DECIDE, [uuid(), 0, 'VOIDED', '0', '1']],
            [
              `SELECT core.payment_cmd_deposit_transition($1, 'REAUTHORIZED', 0, $2, $2, NULL, NULL)`,
              [uuid(), '2033-01-01T00:00:00Z'],
            ],
          ] as const) {
            expect(await failure(tx, sql, params), sql).toMatchObject({ code: '42501' });
          }
        },
      );
    });
    const t = timeline('2033-05-01T10:00:00.000Z');
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: t.decision }, async (tx) => {
        const s = await seed(tx, cc, t);
        expect(await dueIds(tx)).toContain(s['deposit_id']);
      }),
    );
  });

  it('décision falsifiée par le travailleur (T57) : avant l’heure, capture > caution, capture négative, Σ ≠ montant, capture après l’expiration ⇒ refus, rien d’écrit ; la caution reste due puis est libérée (VOIDED) une seule fois', async () => {
    const t = timeline('2033-06-01T10:00:00.000Z');
    const { amount } = depositOf(cc);
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: at(t.end, 69) }, async (tx) => {
        const s = await seed(tx, cc, t);
        const id = s['deposit_id'];
        // jamais avant l'heure de décision (fin + 70 h)
        expect(await failure(tx, DECIDE, [id, 0, 'VOIDED', '0', amount.toString()])).toMatchObject({
          code: '55000',
          constraint: 'deposit_hold_guarded',
        });
        await setClock(tx, t.decision);
        for (const [status, captured, released] of [
          ['PARTIALLY_CAPTURED', amount + 1n, -1n],
          ['PARTIALLY_CAPTURED', -1n, amount + 1n],
          ['VOIDED', 0n, amount - 1n],
          ['VOIDED', 0n, amount + 1n],
          ['PARTIALLY_CAPTURED', amount, amount],
        ] as const) {
          const e = await failure(tx, DECIDE, [
            id,
            0,
            status,
            captured.toString(),
            released.toString(),
          ]);
          expect(e, `${status} ${String(captured)} ${String(released)}`).not.toBeNull();
          expect(['23514', '55000', '22023', '22003']).toContain(e?.code);
        }
        expect(await dueIds(tx)).toContain(id);
        // après l'expiration : aucune capture (08 BR-PAY-06), seule la libération entière
        await setClock(tx, t.expiry);
        expect(
          await failure(tx, DECIDE, [id, 0, 'PARTIALLY_CAPTURED', '1', (amount - 1n).toString()]),
        ).toMatchObject({ code: '55000', constraint: 'deposit_hold_guarded' });
        await setClock(tx, t.decision);
        expect(await decide(tx, id, 'VOIDED', 0n, amount)).toBe('APPLIED');
        expect(await decide(tx, id, 'VOIDED', 0n, amount)).toBe('STALE');
        expect(await dueIds(tx)).not.toContain(id);
      }),
    );
  });

  it('RT-L2-LB01 (base) : deux décisions concurrentes sur deux connexions (VOID entier contre capture partielle de T57) ⇒ la première APPLIED, la seconde attend le verrou (observé) puis STALE ; un seul événement, état final de la gagnante', async () => {
    const t = timeline('2033-07-01T10:00:00.000Z');
    const { amount, fee } = depositOf(cc);
    // caution VALIDÉE (disposition CONVERSION exigée au COMMIT, contrainte différée de 0006)
    const deposit = await withRole('app_worker', (client) =>
      payTx(
        client,
        { worker: 'payment_command', commit: true, virtualNow: t.decision },
        async (tx) => {
          const s = await seed(tx, cc, t);
          await tx.query('SELECT test_fixture.us702b_conversion_disposition($1)', [s['hold_id']]);
          return String(s['deposit_id']);
        },
      ),
    );
    await withThree('app_worker', async (first, second, observer) => {
      await beginWorker(first, 'payment_command', t.decision);
      const pid = await beginWorker(second, 'payment_command', t.decision);
      expect(await decide(first, deposit, 'VOIDED', 0n, amount)).toBe('APPLIED');
      const racing = decide(second, deposit, 'PARTIALLY_CAPTURED', fee, amount - fee);
      await waitUntilLocked(observer, pid);
      await first.query('COMMIT');
      expect(await racing).toBe('STALE');
      await second.query('COMMIT');
    });
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', virtualNow: t.decision }, async (tx) => {
        expect(await dueIds(tx)).not.toContain(deposit);
        await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'outbox_relay', true)`);
        const ev = await tx.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM core.outbox_outbox_event
            WHERE aggregate_id = $1 AND type = 'deposit.decision.executed'`,
          [deposit],
        );
        expect(ev.rows).toHaveLength(1);
        expect(ev.rows[0]?.payload).toMatchObject({
          status: 'VOIDED',
          captured_minor: '0',
          released_minor: amount.toString(),
          currency: cc.currency,
        });
      }),
    );
  });
});
