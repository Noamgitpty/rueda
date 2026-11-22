/**
 * US-706 — courses à deux connexions sur les frais annexes (migration 0177, ADR-197 ; fixture 9907 ;
 * revue qa n° 6). Rôles de PRODUCTION seulement (`withRole`, assertion L0-05), au Panama (USD) et au
 * Paraguay (PYG sans décimale).
 *
 * Chaque course : le pid de la seconde session est lu AVANT son appel ; `lock_timeout` et
 * `statement_timeout` bornés ; l'attente est observée par une troisième session (`pg_locks`, puis
 * `pg_blocking_pids` : la seconde attend bien la première) ; `finally` annule toute transaction restée
 * ouverte. Attendus tirés de 19 US-706 (payer ou contester avant l'échéance, décision de l'ops après
 * contestation, débit par Kmino), de 16 CLM-021 et de 08 BR-REIMB-02 (un seul débit par frais, jamais
 * un frais contesté avant la décision), jamais du code testé : tout écrivain d'une demande prend
 * d'abord le verrou du trip, la seconde session relit donc l'état validé par la première.
 *
 * Années virtuelles 2097 (libres). Données du monde VALIDÉES (deux rôles : app_api pour les parties
 * et la console, app_worker pour le débit) ; aucun compte PSP ACTIVE ; aucun paramètre ni
 * interrupteur écrit.
 */
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { elevated, staff, uuid } from '../support/claims.ts';
import type { Staff } from '../support/claims.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import {
  ACCEPT,
  amountsOf,
  at,
  CHARGE,
  charges,
  DECIDE,
  DISPUTE,
  DISPUTE_REASON,
  DUE,
  HOUR,
  invoices,
  J0,
  MINUTE,
  now,
  RATIONALE,
  session,
  START,
  submit,
  world,
} from '../support/incidental.ts';
import type { Row, Tx, World } from '../support/incidental.ts';

/** Transaction ouverte à la main, bornée, à l'heure virtuelle donnée. */
async function begin(client: Tx, iso: string): Promise<void> {
  await client.query('BEGIN');
  await now(client, iso);
  await client.query(`SET LOCAL lock_timeout = '15s'`);
  await client.query(`SET LOCAL statement_timeout = '30s'`);
}

async function worker(client: Tx, iso: string): Promise<void> {
  await begin(client, iso);
  await client.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', 'payment_command', true)`,
  );
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
  readonly admin: Staff;
  readonly ops: Staff;
  /** Fenêtre ouverte : payée pendant le débit, contestée pendant le débit (deux sens). */
  readonly paid: Invoice;
  readonly late: Invoice;
  readonly disputed: Invoice;
  /** Contestées avant l'échéance : décision de l'ops pendant le débit (deux sens). */
  readonly toCharge: Invoice;
  readonly toReject: Invoice;
}

async function setup(c: CountryCase): Promise<Setup> {
  const a = amountsOf(c);
  return withRole('app_api', (api) =>
    withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
      const admin = await staff(tx, 'ADMIN', [c.country]);
      const ops = await staff(tx, 'OPS_AGENT', [c.country]);
      const worlds = [];
      for (let n = 0; n < 5; n += 1) worlds.push(await world(tx, c));
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
      const [paid, late, disputed, toCharge, toReject] = out as [
        Invoice,
        Invoice,
        Invoice,
        Invoice,
        Invoice,
      ];
      await now(tx, at(J0, HOUR));
      for (const x of [toCharge, toReject]) {
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
      return { admin, ops, paid, late, disputed, toCharge, toReject };
    }),
  );
}

describe.each(COUNTRIES)('US-706 — courses à deux connexions ($country, $currency)', (c) => {
  it('le voyageur paie ou conteste pendant que le travailleur débite : payé à J+3 09:59 ⇒ le débit attend puis part avec l’accord (GUEST_ACCEPTED) ; débit sans réponse à J+3 10:00 ⇒ la contestation attend puis voit le frais débité (INCIDENTAL_NOT_OPEN) ; contesté à 1 ms de l’échéance ⇒ le débit attend puis s’abstient (INCIDENTAL_DISPUTED) ; un seul débit par frais', async () => {
    const s = await setup(c);
    const a = amountsOf(c);
    await withRole('app_worker', (observer) =>
      withRole('app_api', (guest) =>
        withRole('app_worker', async (pay) => {
          // (1) le voyageur paie (verrou du trip), le travailleur attend puis débite avec l'accord
          try {
            await begin(guest, at(DUE, -MINUTE));
            const g = await session(guest, s.paid.w.guest);
            expect((await guest.query<{ r: string }>(ACCEPT, [g, s.paid.id])).rows[0]!.r).toBe(
              'ACCEPTED',
            );
            const holder = await backendPid(guest);
            const pid = await backendPid(pay);
            await worker(pay, DUE);
            const pending = pay.query<Row>(CHARGE, [s.paid.id, uuid()]);
            // attente en échec : la promesse est toujours traitée (aucun rejet orphelin)
            void pending.catch(() => undefined);
            await blockedBy(observer, pid, holder);
            await guest.query('COMMIT');
            expect((await pending).rows[0]).toEqual({ outcome: 'CHARGED', code: 'GUEST_ACCEPTED' });
            await pay.query('COMMIT');
          } finally {
            await rollback(guest, pay);
          }
          // (2) le travailleur débite sans réponse, la contestation attend puis voit le débit
          try {
            await worker(pay, DUE);
            expect((await pay.query<Row>(CHARGE, [s.late.id, uuid()])).rows[0]).toEqual({
              outcome: 'CHARGED',
              code: 'NO_RESPONSE',
            });
            const holder = await backendPid(pay);
            const pid = await backendPid(guest);
            await begin(guest, at(DUE, -1));
            const g = await session(guest, s.late.w.guest);
            const pending = guest.query<{ r: string }>(DISPUTE, [
              g,
              s.late.id,
              DISPUTE_REASON,
              [s.late.w.guestInner],
            ]);
            // attente en échec : la promesse est toujours traitée (aucun rejet orphelin)
            void pending.catch(() => undefined);
            await blockedBy(observer, pid, holder);
            await pay.query('COMMIT');
            expect((await pending).rows[0]!.r).toBe('INCIDENTAL_NOT_OPEN');
            await guest.query('COMMIT');
          } finally {
            await rollback(guest, pay);
          }
          // (3) contestation à 1 ms de l'échéance, le débit attend puis s'abstient
          try {
            await begin(guest, at(DUE, -1));
            const g = await session(guest, s.disputed.w.guest);
            expect(
              (
                await guest.query<{ r: string }>(DISPUTE, [
                  g,
                  s.disputed.id,
                  DISPUTE_REASON,
                  [s.disputed.w.guestInner],
                ])
              ).rows[0]!.r,
            ).toBe('DISPUTED');
            const holder = await backendPid(guest);
            const pid = await backendPid(pay);
            await worker(pay, DUE);
            const pending = pay.query<Row>(CHARGE, [s.disputed.id, uuid()]);
            // attente en échec : la promesse est toujours traitée (aucun rejet orphelin)
            void pending.catch(() => undefined);
            await blockedBy(observer, pid, holder);
            await guest.query('COMMIT');
            expect((await pending).rows[0]).toEqual({
              outcome: 'NOT_DUE',
              code: 'INCIDENTAL_DISPUTED',
            });
            await pay.query('COMMIT');
          } finally {
            await rollback(guest, pay);
          }
          const status = async (x: Invoice): Promise<unknown> =>
            (await invoices(observer, x.w.trip))[0]!['status'];
          expect(await charges(observer, s.paid.id)).toEqual([
            expect.objectContaining({
              purpose: 'INCIDENTAL',
              amount_minor: a['cleaning']!.toString(),
              leg_host_minor: a['cleaning']!.toString(),
              guest_agreed: true,
            }),
          ]);
          expect(await charges(observer, s.late.id)).toEqual([
            expect.objectContaining({ purpose: 'INCIDENTAL', guest_agreed: false }),
          ]);
          expect(await charges(observer, s.disputed.id)).toEqual([]);
          expect([await status(s.paid), await status(s.late), await status(s.disputed)]).toEqual([
            'CHARGED',
            'CHARGED',
            'DISPUTED',
          ]);
        }),
      ),
    );
  }, 120_000);

  it('l’ops décide pendant le débit : décision de débiter (ADMIN) ⇒ le débit attend puis part (OPS_DECISION) ; débit en cours sur un frais contesté (INCIDENTAL_DISPUTED) ⇒ le rejet attend puis s’applique, plus aucun débit (REJECTED)', async () => {
    const s = await setup(c);
    const RACE_AT = at(DUE, HOUR);
    await withRole('app_worker', (observer) =>
      withRole('app_api', (staffSide) =>
        withRole('app_worker', async (pay) => {
          // (1) l'ADMIN décide de débiter (verrou du trip), le travailleur attend puis débite
          try {
            await begin(staffSide, RACE_AT);
            const h = await elevated(staffSide, s.admin);
            expect(
              (await staffSide.query<Row>(DECIDE, [h, uuid(), s.toCharge.id, 'CHARGE', RATIONALE]))
                .rows[0]!['outcome'],
            ).toBe('DECIDED');
            const holder = await backendPid(staffSide);
            const pid = await backendPid(pay);
            await worker(pay, RACE_AT);
            const pending = pay.query<Row>(CHARGE, [s.toCharge.id, uuid()]);
            // attente en échec : la promesse est toujours traitée (aucun rejet orphelin)
            void pending.catch(() => undefined);
            await blockedBy(observer, pid, holder);
            await staffSide.query('COMMIT');
            expect((await pending).rows[0]).toEqual({ outcome: 'CHARGED', code: 'OPS_DECISION' });
            await pay.query('COMMIT');
          } finally {
            await rollback(staffSide, pay);
          }
          // (2) le travailleur tient le verrou du trip, le rejet de l'ops attend puis s'applique
          try {
            await worker(pay, RACE_AT);
            expect((await pay.query<Row>(CHARGE, [s.toReject.id, uuid()])).rows[0]).toEqual({
              outcome: 'NOT_DUE',
              code: 'INCIDENTAL_DISPUTED',
            });
            const holder = await backendPid(pay);
            const pid = await backendPid(staffSide);
            await begin(staffSide, RACE_AT);
            const h = await elevated(staffSide, s.ops);
            const pending = staffSide.query<Row>(DECIDE, [
              h,
              uuid(),
              s.toReject.id,
              'REJECT',
              RATIONALE,
            ]);
            // attente en échec : la promesse est toujours traitée (aucun rejet orphelin)
            void pending.catch(() => undefined);
            await blockedBy(observer, pid, holder);
            await pay.query('COMMIT');
            expect((await pending).rows[0]!['outcome']).toBe('DECIDED');
            await staffSide.query('COMMIT');
          } finally {
            await rollback(staffSide, pay);
          }
          // passe suivante du travailleur : le rejet est vu, rien à débiter
          try {
            await worker(pay, at(RACE_AT, MINUTE));
            expect((await pay.query<Row>(CHARGE, [s.toReject.id, uuid()])).rows[0]).toEqual({
              outcome: 'DONE',
              code: 'REJECTED',
            });
          } finally {
            await rollback(pay);
          }
          expect(await charges(observer, s.toCharge.id)).toEqual([
            expect.objectContaining({ purpose: 'INCIDENTAL', guest_agreed: false }),
          ]);
          expect(await charges(observer, s.toReject.id)).toEqual([]);
          expect((await invoices(observer, s.toCharge.w.trip))[0]).toMatchObject({
            status: 'CHARGED',
            charge_basis: 'OPS_DECISION',
            decided_role: 'ADMIN',
          });
          expect((await invoices(observer, s.toReject.w.trip))[0]).toMatchObject({
            status: 'REJECTED',
            decided_role: 'OPS_AGENT',
            charge_id: null,
          });
        }),
      ),
    );
  }, 120_000);
});
