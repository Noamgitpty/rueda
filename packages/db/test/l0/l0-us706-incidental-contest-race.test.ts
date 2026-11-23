/**
 * US-706 suite — courses à deux connexions sur une demande CONTESTÉE (migration 0182, ADR-202,
 * F-L3-FRA-01). Rôles de PRODUCTION seulement (`withRole`, assertion L0-05), au Panama (USD) et au
 * Paraguay (PYG sans décimale).
 *
 * Chaque course : le pid de la seconde session est lu AVANT son appel ; `lock_timeout` et
 * `statement_timeout` bornés ; l'attente est observée par une troisième session (`pg_locks`, puis
 * `pg_blocking_pids` : la seconde attend bien la première) ; `finally` annule toute transaction restée
 * ouverte. Attendus tirés de 08 BR-REIMB-02 (la fenêtre du voyageur ne se rouvre jamais),
 * BR-REIMB-03 (l'ops tranche une contestation), BR-REIMB-05 (doublons) et SM-5 (CANCELLED_BY_HOST
 * et REJECTED sont finals), jamais du code testé : toute commande qui écrit une demande prend
 * d'abord le verrou du trip, la seconde session relit donc l'état validé par la première.
 *
 * Année virtuelle 2064 (libre). Données du monde VALIDÉES (trips, demandes contestées, sessions) ;
 * aucun compte PSP ACTIVE ; aucun paramètre ni interrupteur écrit.
 */
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { elevated, staff, uuid } from '../support/claims.ts';
import type { Staff } from '../support/claims.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import {
  amountsOf,
  at,
  CANCEL,
  DECIDE,
  DISPUTE,
  DISPUTE_REASON,
  HOUR,
  invoices,
  now,
  RATIONALE,
  session,
  SUBMIT,
  submit,
  world,
} from '../support/incidental.ts';
import type { Row, Tx, World } from '../support/incidental.ts';

/** Trip du 7 au 10 mars 2064, rendu à 08:00 ; demande à J0 10:00, contestée à J0 + 1 h. */
const START = '2064-03-07T08:00:00.000Z';
const END = '2064-03-10T08:00:00.000Z';
const J0 = '2064-03-10T10:00:00.000Z';
const RACE_AT = at(J0, 2 * HOUR);

async function begin(client: Tx, iso: string): Promise<void> {
  await client.query('BEGIN');
  await now(client, iso);
  await client.query(`SET LOCAL lock_timeout = '15s'`);
  await client.query(`SET LOCAL statement_timeout = '30s'`);
}

/** La session `pid` attend un verrou, et c'est celui que tient `holder`. */
async function blockedBy(observer: Tx, pid: number, holder: number): Promise<void> {
  await waitUntilBlocked(observer, pid, 'transactionid');
  const r = await observer.query<{ b: boolean }>(
    'SELECT $1::integer = ANY (pg_catalog.pg_blocking_pids($2::integer)) AS b',
    [holder, pid],
  );
  expect(r.rows[0]!.b).toBe(true);
}

async function rollback(...clients: Tx[]): Promise<void> {
  for (const client of clients) await client.query('ROLLBACK').catch(() => undefined);
}

interface Invoice {
  readonly id: string;
  readonly w: World;
}

interface Setup {
  readonly ops: Staff;
  /** Contestées : annulée pendant une redemande, annulée pendant un rejet, rejetée pendant une
   * annulation. */
  readonly resubmit: Invoice;
  readonly cancelFirst: Invoice;
  readonly rejectFirst: Invoice;
}

async function setup(c: CountryCase): Promise<Setup> {
  const a = amountsOf(c);
  return withRole('app_api', (api) =>
    withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
      const ops = await staff(tx, 'OPS_AGENT', [c.country]);
      const worlds: World[] = [];
      for (let n = 0; n < 3; n += 1) worlds.push(await world(tx, c, { start: START, end: END }));
      await now(tx, J0);
      const out: Invoice[] = [];
      for (const w of worlds) {
        const r = await submit(
          tx,
          await session(tx, w.holder),
          w.trip,
          'CLEANING',
          a['cleaning']!,
          [w.inner],
        );
        expect(r['outcome']).toBe('SUBMITTED');
        out.push({ id: String(r['invoice_id']), w });
      }
      await now(tx, at(J0, HOUR));
      for (const x of out) {
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              await session(tx, x.w.guest),
              x.id,
              DISPUTE_REASON,
              [x.w.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('DISPUTED');
      }
      const [resubmit, cancelFirst, rejectFirst] = out as [Invoice, Invoice, Invoice];
      return { ops, resubmit, cancelFirst, rejectFirst };
    }),
  );
}

describe.each(COUNTRIES)(
  'US-706 suite — courses sur une demande contestée ($country, $currency)',
  (c) => {
    it('F-L3-FRA-01 : l’hôte annule une demande contestée pendant qu’il la redemande (deux sessions) ⇒ la redemande attend puis est refusée (INCIDENTAL_DUPLICATE), aucune fenêtre neuve ; annulation contre rejet de l’ops, dans les deux sens ⇒ la seconde attend puis voit l’état final (INCIDENTAL_NOT_DISPUTED, INCIDENTAL_NOT_CANCELLABLE), une seule issue par demande', async () => {
      const s = await setup(c);
      const a = amountsOf(c);
      await withRole('app_worker', (observer) =>
        withRole('app_api', (first) =>
          withRole('app_api', async (second) => {
            // (1) annulation (verrou du trip) contre redemande du même frais par l'hôte
            try {
              await begin(first, RACE_AT);
              const h = await session(first, s.resubmit.w.holder);
              expect(
                (await first.query<{ r: string }>(CANCEL, [h, s.resubmit.id])).rows[0]!.r,
              ).toBe('CANCELLED');
              const holder = await backendPid(first);
              const pid = await backendPid(second);
              await begin(second, RACE_AT);
              const h2 = await session(second, s.resubmit.w.holder);
              const pending = second.query<Row>(SUBMIT, [
                h2,
                s.resubmit.w.trip,
                uuid(),
                'CLEANING',
                a['cleaning']!.toString(),
                'Sièges arrière couverts de sable et de boue au retour',
                [s.resubmit.w.inner],
              ]);
              // attente en échec : la promesse est toujours traitée (aucun rejet orphelin)
              void pending.catch(() => undefined);
              await blockedBy(observer, pid, holder);
              await first.query('COMMIT');
              expect((await pending).rows[0]!['outcome']).toBe('INCIDENTAL_DUPLICATE');
              await second.query('COMMIT');
            } finally {
              await rollback(first, second);
            }
            // (2) l'hôte annule (verrou du trip), le rejet de l'ops attend puis ne tranche plus rien
            try {
              await begin(first, RACE_AT);
              const h = await session(first, s.cancelFirst.w.holder);
              expect(
                (await first.query<{ r: string }>(CANCEL, [h, s.cancelFirst.id])).rows[0]!.r,
              ).toBe('CANCELLED');
              const holder = await backendPid(first);
              const pid = await backendPid(second);
              await begin(second, RACE_AT);
              const e = await elevated(second, s.ops);
              const pending = second.query<Row>(DECIDE, [
                e,
                uuid(),
                s.cancelFirst.id,
                'REJECT',
                RATIONALE,
              ]);
              // attente en échec : la promesse est toujours traitée (aucun rejet orphelin)
              void pending.catch(() => undefined);
              await blockedBy(observer, pid, holder);
              await first.query('COMMIT');
              expect((await pending).rows[0]!['outcome']).toBe('INCIDENTAL_NOT_DISPUTED');
              await second.query('COMMIT');
            } finally {
              await rollback(first, second);
            }
            // (3) l'ops rejette (verrou du trip), l'annulation de l'hôte attend puis est refusée
            try {
              await begin(first, RACE_AT);
              const e = await elevated(first, s.ops);
              expect(
                (await first.query<Row>(DECIDE, [e, uuid(), s.rejectFirst.id, 'REJECT', RATIONALE]))
                  .rows[0]!['outcome'],
              ).toBe('DECIDED');
              const holder = await backendPid(first);
              const pid = await backendPid(second);
              await begin(second, RACE_AT);
              const h = await session(second, s.rejectFirst.w.holder);
              const pending = second.query<{ r: string }>(CANCEL, [h, s.rejectFirst.id]);
              // attente en échec : la promesse est toujours traitée (aucun rejet orphelin)
              void pending.catch(() => undefined);
              await blockedBy(observer, pid, holder);
              await first.query('COMMIT');
              expect((await pending).rows[0]!.r).toBe('INCIDENTAL_NOT_CANCELLABLE');
              await second.query('COMMIT');
            } finally {
              await rollback(first, second);
            }
            // état final relu : une seule demande par trip, aucune en attente du voyageur
            const rows = async (x: Invoice) =>
              (await invoices(observer, x.w.trip)).map((r) => [r['status'], r['decided_role']]);
            expect(await rows(s.resubmit)).toEqual([['CANCELLED_BY_HOST', null]]);
            expect(await rows(s.cancelFirst)).toEqual([['CANCELLED_BY_HOST', null]]);
            expect(await rows(s.rejectFirst)).toEqual([['REJECTED', 'OPS_AGENT']]);
          }),
        ),
      );
    }, 120_000);
  },
);
